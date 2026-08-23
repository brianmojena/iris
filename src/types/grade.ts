/**
 * The grading stage: four colour wheels and four tone curves.
 *
 * It lives beside `Adjustments` rather than inside it because everything in that
 * object is a single number — history labelling, presets and the reset check all
 * lean on that. A wheel is three numbers and a curve is a list of points, so they
 * get their own home and `Edit` carries both.
 *
 * Both tools are pure functions of one channel at a time, which is what makes
 * them cheap: the curves collapse into a 256-entry lookup table built once on the
 * CPU, and the wheels collapse into four vec3 uniforms. Neither adds a pass.
 */

// --- curves ----------------------------------------------------------------

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b'

/** A control point in 0..1, with y measured upwards the way a curve is drawn. */
export interface CurvePoint {
  x: number
  y: number
}

/** Sorted by x, always at least the two endpoints. */
export type Curve = CurvePoint[]
export type Curves = Record<CurveChannel, Curve>

export const CURVE_CHANNELS: CurveChannel[] = ['rgb', 'r', 'g', 'b']

/** Resolution of the lookup table handed to the shader. */
export const CURVE_SIZE = 256

export function neutralCurve(): Curve {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]
}

export function isNeutralCurve(curve: Curve): boolean {
  return (
    curve.length === 2 &&
    curve[0].x === 0 &&
    curve[0].y === 0 &&
    curve[1].x === 1 &&
    curve[1].y === 1
  )
}

// --- wheels ----------------------------------------------------------------

export type WheelKey = 'offset' | 'lift' | 'gamma' | 'gain'

/**
 * A wheel is a position on a disc plus the ring around it.
 *
 * Stored as the raw disc coordinates rather than as the RGB balance they encode,
 * so putting the handle back where it was is exact — deriving an angle from a
 * colour and a colour from an angle round-trips through two lossy conversions
 * and the handle creeps.
 */
export interface Wheel {
  /** -1..1, right-handed: x to the right, y upwards. */
  x: number
  y: number
  /** -1..1. Moves all three channels together. */
  master: number
}

export type Wheels = Record<WheelKey, Wheel>

/** Display and iteration order: darkest to brightest, with offset last. */
export const WHEEL_KEYS: WheelKey[] = ['lift', 'gamma', 'gain', 'offset']

export function neutralWheel(): Wheel {
  return { x: 0, y: 0, master: 0 }
}

export function isNeutralWheel(w: Wheel): boolean {
  return w.x === 0 && w.y === 0 && w.master === 0
}

// --- the grade -------------------------------------------------------------

export interface Grade {
  wheels: Wheels
  curves: Curves
}

export function defaultGrade(): Grade {
  return {
    wheels: { offset: neutralWheel(), lift: neutralWheel(), gamma: neutralWheel(), gain: neutralWheel() },
    curves: { rgb: neutralCurve(), r: neutralCurve(), g: neutralCurve(), b: neutralCurve() },
  }
}

export function hasCurves(curves: Curves): boolean {
  return CURVE_CHANNELS.some((channel) => !isNeutralCurve(curves[channel]))
}

export function hasWheels(wheels: Wheels): boolean {
  return WHEEL_KEYS.some((key) => !isNeutralWheel(wheels[key]))
}

export function isNeutralGrade(grade: Grade): boolean {
  return !hasWheels(grade.wheels) && !hasCurves(grade.curves)
}

function sameCurve(a: Curve, b: Curve): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y)
}

export function sameGrade(a: Grade, b: Grade): boolean {
  return (
    WHEEL_KEYS.every(
      (key) =>
        a.wheels[key].x === b.wheels[key].x &&
        a.wheels[key].y === b.wheels[key].y &&
        a.wheels[key].master === b.wheels[key].master,
    ) && CURVE_CHANNELS.every((channel) => sameCurve(a.curves[channel], b.curves[channel]))
  )
}

/** Deep copy, so a preset or a history step can never be edited from elsewhere. */
export function cloneGrade(grade: Grade): Grade {
  return {
    wheels: {
      offset: { ...grade.wheels.offset },
      lift: { ...grade.wheels.lift },
      gamma: { ...grade.wheels.gamma },
      gain: { ...grade.wheels.gain },
    },
    curves: {
      rgb: grade.curves.rgb.map((p) => ({ ...p })),
      r: grade.curves.r.map((p) => ({ ...p })),
      g: grade.curves.g.map((p) => ({ ...p })),
      b: grade.curves.b.map((p) => ({ ...p })),
    },
  }
}

// --- wheel maths -----------------------------------------------------------

/** Fully saturated RGB at `turn` around the hue circle, 0 = red. */
function hueRgb(turn: number): [number, number, number] {
  const h = (turn - Math.floor(turn)) * 6
  const x = 1 - Math.abs((h % 2) - 1)
  if (h < 1) return [1, x, 0]
  if (h < 2) return [x, 1, 0]
  if (h < 3) return [0, 1, x]
  if (h < 4) return [0, x, 1]
  if (h < 5) return [x, 0, 1]
  return [1, 0, x]
}

/**
 * A primary hue mean-removed peaks at 2/3; scaling by this puts the strongest
 * channel at exactly 1 when the handle is on the rim, so the ranges below can be
 * read as "how far a channel moves at full deflection".
 */
const NORMALISE = 1.5

/**
 * Turns a handle position into a per-channel balance in -1..1.
 *
 * The mean is subtracted so a wheel changes the *balance* between channels and
 * leaves overall brightness where it was — that is the ring's job, not the disc's.
 */
export function wheelBalance(wheel: Wheel): [number, number, number] {
  const radius = Math.min(1, Math.hypot(wheel.x, wheel.y))
  if (radius < 1e-6) return [0, 0, 0]
  const base = hueRgb(Math.atan2(wheel.y, wheel.x) / (Math.PI * 2))
  const mean = (base[0] + base[1] + base[2]) / 3
  const scale = radius * NORMALISE
  return [(base[0] - mean) * scale, (base[1] - mean) * scale, (base[2] - mean) * scale]
}

/**
 * How far each wheel travels at full deflection.
 *
 * `balance` is deliberately the smaller of the two everywhere: a colour cast is
 * a difference *between* channels, and a difference of a whole stop between red
 * and blue is already far more than any photograph wants.
 *
 * Gamma and gain are in stops, so equal moves up and down feel equal — a gain of
 * +1 doubles and -1 halves, which a linear multiplier would not give you.
 */
const RANGE: Record<WheelKey, { balance: number; master: number }> = {
  offset: { balance: 0.1, master: 0.15 },
  lift: { balance: 0.2, master: 0.25 },
  gamma: { balance: 0.5, master: 1 },
  gain: { balance: 0.5, master: 1 },
}

export type Triple = [number, number, number]

export interface WheelUniforms {
  /** Added flat. Neutral 0. */
  offset: Triple
  /** Added weighted towards black, pivoting at white. Neutral 0. */
  lift: Triple
  /** Exponent base; above 1 brightens the mid-tones. Neutral 1. */
  gamma: Triple
  /** Multiplier, pivoting at black. Neutral 1. */
  gain: Triple
}

function linear(wheel: Wheel, key: WheelKey): Triple {
  const balance = wheelBalance(wheel)
  const { balance: b, master: m } = RANGE[key]
  return [
    balance[0] * b + wheel.master * m,
    balance[1] * b + wheel.master * m,
    balance[2] * b + wheel.master * m,
  ]
}

function stops(wheel: Wheel, key: WheelKey): Triple {
  const v = linear(wheel, key)
  return [Math.pow(2, v[0]), Math.pow(2, v[1]), Math.pow(2, v[2])]
}

/** Everything the shader needs to apply the wheels, in shader units. */
export function wheelUniforms(wheels: Wheels): WheelUniforms {
  return {
    offset: linear(wheels.offset, 'offset'),
    lift: linear(wheels.lift, 'lift'),
    gamma: stops(wheels.gamma, 'gamma'),
    gain: stops(wheels.gain, 'gain'),
  }
}
