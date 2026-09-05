/**
 * Secondaries: a correction that only reaches part of the picture.
 *
 * Each one is a **matte** and a **correction**. The matte is built from a colour
 * qualifier (a range of hue, saturation and luminance), a geometric window, or
 * both multiplied together; the correction is a small set of controls applied
 * through it. That is the whole of what a grading desk calls a secondary, minus
 * the node graph that lets them feed each other.
 *
 * There is a hard limit of four. They run inside the same fragment shader as
 * everything else, as a loop over uniform arrays — no extra pass, no extra
 * texture, and the cost of an unused slot is one comparison.
 */

/** Slots the shader has room for. Raising it means raising it in the shader too. */
export const MAX_SECONDARIES = 4

export type WindowShape = 'none' | 'ellipse' | 'rectangle'

/**
 * A band with soft shoulders. `softness` is how far outside the band the matte
 * takes to fall to zero, in the same units as the band itself.
 */
export interface Band {
  low: number
  high: number
  softness: number
}

export interface HueBand {
  /** Turns around the colour circle, 0..1, wrapping. */
  centre: number
  /** Half-width of the band, also in turns. At 0.5 the whole circle is inside. */
  range: number
  softness: number
}

export interface Qualifier {
  enabled: boolean
  hue: HueBand
  saturation: Band
  luminance: Band
}

/**
 * The window's geometry, in the coordinates of the framed image: `cx`/`cy` run
 * 0..1 across it, while `halfWidth` and `halfHeight` are fractions of its
 * **height** so that the shape stays rigid under rotation instead of shearing
 * with the aspect ratio.
 */
export interface PowerWindow {
  shape: WindowShape
  cx: number
  cy: number
  halfWidth: number
  halfHeight: number
  /** Degrees, clockwise on screen. */
  angle: number
  /** 0 is a hard edge; 1 fades all the way from the centre. */
  feather: number
}

export interface Correction {
  exposure: number // EV stops, -3..3
  contrast: number // -100..100
  temperature: number // -100..100
  tint: number // -100..100
  saturation: number // -100..100
  hue: number // degrees, -180..180
}

export interface Secondary {
  id: string
  enabled: boolean
  qualifier: Qualifier
  window: PowerWindow
  /** Swaps what the matte covers for what it does not. */
  invert: boolean
  correction: Correction
}

export const DEFAULT_CORRECTION: Correction = {
  exposure: 0,
  contrast: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  hue: 0,
}

export type CorrectionKey = keyof Correction

export const CORRECTION_KEYS: CorrectionKey[] = [
  'exposure',
  'contrast',
  'temperature',
  'tint',
  'saturation',
  'hue',
]

export function defaultSecondary(id: string): Secondary {
  return {
    id,
    enabled: true,
    qualifier: {
      enabled: true,
      // Starts on the whole circle so a new secondary covers everything and the
      // picture reacts the moment a slider moves. A key that begins empty leaves
      // the user dragging controls at a photograph that does not change.
      hue: { centre: 0, range: 0.5, softness: 0.05 },
      saturation: { low: 0, high: 1, softness: 0.08 },
      luminance: { low: 0, high: 1, softness: 0.08 },
    },
    window: {
      shape: 'none',
      cx: 0.5,
      cy: 0.5,
      halfWidth: 0.3,
      halfHeight: 0.3,
      angle: 0,
      feather: 0.5,
    },
    invert: false,
    correction: { ...DEFAULT_CORRECTION },
  }
}

export function isNeutralCorrection(c: Correction): boolean {
  return CORRECTION_KEYS.every((key) => c[key] === DEFAULT_CORRECTION[key])
}

/** True when this secondary cannot change a single pixel. */
export function isInert(secondary: Secondary): boolean {
  return !secondary.enabled || isNeutralCorrection(secondary.correction)
}

export function cloneSecondary(s: Secondary): Secondary {
  return {
    ...s,
    qualifier: {
      enabled: s.qualifier.enabled,
      hue: { ...s.qualifier.hue },
      saturation: { ...s.qualifier.saturation },
      luminance: { ...s.qualifier.luminance },
    },
    window: { ...s.window },
    correction: { ...s.correction },
  }
}

function sameBand(a: Band, b: Band): boolean {
  return a.low === b.low && a.high === b.high && a.softness === b.softness
}

export function sameSecondary(a: Secondary, b: Secondary): boolean {
  return (
    a.id === b.id &&
    a.enabled === b.enabled &&
    a.invert === b.invert &&
    a.qualifier.enabled === b.qualifier.enabled &&
    a.qualifier.hue.centre === b.qualifier.hue.centre &&
    a.qualifier.hue.range === b.qualifier.hue.range &&
    a.qualifier.hue.softness === b.qualifier.hue.softness &&
    sameBand(a.qualifier.saturation, b.qualifier.saturation) &&
    sameBand(a.qualifier.luminance, b.qualifier.luminance) &&
    a.window.shape === b.window.shape &&
    a.window.cx === b.window.cx &&
    a.window.cy === b.window.cy &&
    a.window.halfWidth === b.window.halfWidth &&
    a.window.halfHeight === b.window.halfHeight &&
    a.window.angle === b.window.angle &&
    a.window.feather === b.window.feather &&
    CORRECTION_KEYS.every((key) => a.correction[key] === b.correction[key])
  )
}

export function sameSecondaries(a: Secondary[], b: Secondary[]): boolean {
  return a.length === b.length && a.every((s, i) => sameSecondary(s, b[i]))
}

// --- packing for the shader ------------------------------------------------

/** One vec4 array's worth of data: four floats per slot. */
const STRIDE = 4

export interface SecondaryUniforms {
  count: number
  hue: Float32Array
  saturation: Float32Array
  luminance: Float32Array
  windowA: Float32Array
  windowB: Float32Array
  correctionA: Float32Array
  correctionB: Float32Array
}

const SHAPE_CODE: Record<WindowShape, number> = { none: 0, ellipse: 1, rectangle: 2 }

/**
 * Flattens the list into the vec4 arrays the shader reads.
 *
 * Packed rather than declared as an array of structs because a struct array
 * costs one `getUniformLocation` and one `uniform*` call per member per slot,
 * every frame. Seven `uniform4fv` calls is the whole of it.
 *
 * Every secondary is packed in list order, inert ones included, so that slot `i`
 * here is always secondary `i` in the panel. The matte preview depends on that:
 * a key is dialled *before* its correction exists, so the one you are looking at
 * is exactly the one a "pack only what does something" filter would drop. What
 * an inert secondary loses instead is its `apply` flag, and the shader skips a
 * slot that is neither applied nor being previewed before it evaluates anything.
 */
export function secondaryUniforms(list: Secondary[]): SecondaryUniforms {
  const active = list.slice(0, MAX_SECONDARIES)
  const uniforms: SecondaryUniforms = {
    count: active.length,
    hue: new Float32Array(MAX_SECONDARIES * STRIDE),
    saturation: new Float32Array(MAX_SECONDARIES * STRIDE),
    luminance: new Float32Array(MAX_SECONDARIES * STRIDE),
    windowA: new Float32Array(MAX_SECONDARIES * STRIDE),
    windowB: new Float32Array(MAX_SECONDARIES * STRIDE),
    correctionA: new Float32Array(MAX_SECONDARIES * STRIDE),
    correctionB: new Float32Array(MAX_SECONDARIES * STRIDE),
  }

  active.forEach((s, i) => {
    const at = i * STRIDE
    const q = s.qualifier
    uniforms.hue.set([q.hue.centre, q.hue.range, q.hue.softness, q.enabled ? 1 : 0], at)
    uniforms.saturation.set(
      [q.saturation.low, q.saturation.high, q.saturation.softness, s.invert ? 1 : 0],
      at,
    )
    uniforms.luminance.set(
      [q.luminance.low, q.luminance.high, q.luminance.softness, SHAPE_CODE[s.window.shape]],
      at,
    )
    uniforms.windowA.set([s.window.cx, s.window.cy, s.window.halfWidth, s.window.halfHeight], at)

    const radians = (s.window.angle * Math.PI) / 180
    uniforms.windowB.set([Math.cos(radians), Math.sin(radians), s.window.feather, 0], at)

    const c = s.correction
    uniforms.correctionA.set([c.exposure, c.contrast / 100, c.temperature / 100, c.tint / 100], at)
    uniforms.correctionB.set([c.saturation / 100, c.hue / 360, isInert(s) ? 0 : 1, 0], at)
  })

  return uniforms
}

// --- the eyedropper --------------------------------------------------------

/** Hue in turns and saturation in 0..1, the same units the qualifier stores. */
function hueAndSaturation(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma < 1e-6) return [0, 0]

  const sixth =
    max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  return [sixth / 6, chroma / max]
}

/** Half-widths the picked bands open up to, in their own units. */
const PICK_HUE = 0.06
const PICK_SATURATION = 0.25
const PICK_LUMINANCE = 0.3

/**
 * Builds a key around a colour taken off the photograph.
 *
 * It replaces the previous key rather than narrowing it: picking is how you
 * *start* a selection, and folding it into whatever was there before makes the
 * result depend on history the user cannot see.
 *
 * The bands open generously. A key clamped tight around one sampled pixel finds
 * almost nothing on a real photograph, and widening a selection that already
 * shows something is a far easier thing to judge than opening one that shows
 * nothing at all.
 */
export function qualifierFromColour(
  rgb: [number, number, number],
  luma: [number, number, number],
): Qualifier {
  const r = rgb[0] / 255
  const g = rgb[1] / 255
  const b = rgb[2] / 255
  const [hue, saturation] = hueAndSaturation(r, g, b)
  const brightness = luma[0] * r + luma[1] * g + luma[2] * b

  return {
    enabled: true,
    hue: { centre: Number(hue.toFixed(4)), range: PICK_HUE, softness: 0.05 },
    saturation: {
      low: Math.max(0, Number((saturation - PICK_SATURATION).toFixed(3))),
      high: Math.min(1, Number((saturation + PICK_SATURATION).toFixed(3))),
      softness: 0.08,
    },
    luminance: {
      low: Math.max(0, Number((brightness - PICK_LUMINANCE).toFixed(3))),
      high: Math.min(1, Number((brightness + PICK_LUMINANCE).toFixed(3))),
      softness: 0.1,
    },
  }
}
