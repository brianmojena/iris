import {
  CURVE_SIZE,
  type Curve,
  type CurveChannel,
  type CurvePoint,
  type Curves,
  hasCurves,
} from '../types/grade'

/**
 * Curve evaluation, and the lookup table the shader reads.
 *
 * The interpolation is monotone cubic (Fritsch–Carlson) rather than a plain
 * Catmull-Rom or natural spline. Both of those overshoot: drop a point low and
 * the curve dips *below* it on the way in, which shows up as a dark band across
 * a gradient that the user never asked for and cannot see the cause of. A
 * monotone spline is guaranteed never to reverse direction between two control
 * points, so what you draw is what the photograph gets.
 */

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Sorted, de-duplicated and clamped — everything downstream assumes this. */
export function normaliseCurve(curve: Curve): CurvePoint[] {
  const points = curve
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x)
    .filter((p, i, all) => i === 0 || p.x - all[i - 1].x > 1e-6)

  if (points.length === 0) {
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
  }
  if (points.length === 1) return [points[0], { x: 1, y: points[0].y }]
  return points
}

/**
 * Tangents chosen so the interpolant cannot leave the interval between its
 * neighbours. The three-sigma circle test is Fritsch and Carlson's: whenever a
 * pair of tangents would let the cubic turn back on itself, both are scaled down
 * onto the boundary of the region where it cannot.
 */
function tangents(points: CurvePoint[]): number[] {
  const n = points.length
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    slope.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x))
  }

  const m: number[] = new Array(n)
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = (slope[i - 1] + slope[i]) / 2

  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const magnitude = Math.hypot(a, b)
    if (magnitude > 3) {
      const scale = 3 / magnitude
      m[i] = scale * a * slope[i]
      m[i + 1] = scale * b * slope[i]
    }
  }
  return m
}

/**
 * Samples a curve at `count` evenly spaced inputs from 0 to 1.
 *
 * Beyond the outermost control points the curve is flat, not extrapolated: a
 * user who drags the black point inward is setting a black *level*, and a
 * tangent carried on past it would send the shadows somewhere they never
 * pointed.
 */
export function sampleCurve(curve: Curve, count = CURVE_SIZE): Float32Array {
  const points = normaliseCurve(curve)
  const out = new Float32Array(count)
  const m = tangents(points)

  let segment = 0
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1)

    if (x <= points[0].x) {
      out[i] = points[0].y
      continue
    }
    if (x >= points[points.length - 1].x) {
      out[i] = points[points.length - 1].y
      continue
    }
    while (segment < points.length - 2 && x > points[segment + 1].x) segment++

    const a = points[segment]
    const b = points[segment + 1]
    const h = b.x - a.x
    const t = (x - a.x) / h
    const t2 = t * t
    const t3 = t2 * t

    out[i] = clamp01(
      (2 * t3 - 3 * t2 + 1) * a.y +
        (t3 - 2 * t2 + t) * h * m[segment] +
        (-2 * t3 + 3 * t2) * b.y +
        (t3 - t2) * h * m[segment + 1],
    )
  }
  return out
}

/** Reads a sampled curve at an arbitrary input, interpolating between entries. */
export function evaluate(lut: Float32Array, x: number): number {
  const position = clamp01(x) * (lut.length - 1)
  const index = Math.floor(position)
  if (index >= lut.length - 1) return lut[lut.length - 1]
  const t = position - index
  return lut[index] * (1 - t) + lut[index + 1] * t
}

/**
 * Bakes all four curves into one RGBA row for the GPU.
 *
 * The per-channel curve runs first and the master curve second, the way every
 * editor with both orders them. Because both are functions of a single channel
 * they compose exactly — `master(red(x))` is still just a function of red — so
 * the pair costs one texture fetch rather than two.
 */
export function curveTexture(curves: Curves, size = CURVE_SIZE): Uint8Array {
  const master = sampleCurve(curves.rgb, size)
  const channels: Float32Array[] = [
    sampleCurve(curves.r, size),
    sampleCurve(curves.g, size),
    sampleCurve(curves.b, size),
  ]

  const data = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = Math.round(clamp01(evaluate(master, channels[c][i])) * 255)
    }
    data[i * 4 + 3] = 255
  }
  return data
}

/** The channels a user has actually drawn on, for labelling a history step. */
export function changedChannels(a: Curves, b: Curves): CurveChannel[] {
  return (['rgb', 'r', 'g', 'b'] as CurveChannel[]).filter((channel) => {
    const from = a[channel]
    const to = b[channel]
    return (
      from.length !== to.length || from.some((p, i) => p.x !== to[i].x || p.y !== to[i].y)
    )
  })
}

export { hasCurves }
