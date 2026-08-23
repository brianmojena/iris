import type { ScopeSample } from '../engine/Renderer'

/**
 * The measuring instruments: histogram, waveform, RGB parade and vectorscope.
 *
 * All four read the same thumbnail of the graded image — around two hundred
 * pixels on its longest edge, which is forty thousand samples. That is plenty
 * for a distribution and few enough that the whole set can be rebuilt inside one
 * animation frame while a wheel is being dragged, which is the only time any of
 * this is worth looking at.
 *
 * Nothing here touches the DOM: each function returns numbers or a pixel buffer,
 * so the maths can be tested without a canvas anywhere near it.
 */

export type ScopeKind = 'histogram' | 'waveform' | 'parade' | 'vectorscope'
export const SCOPE_KINDS: ScopeKind[] = ['histogram', 'waveform', 'parade', 'vectorscope']

/** Straightening leaves transparent corners; they are not part of the picture. */
const OPAQUE = 128

const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

/** The instrument's own background, dark the way every scope has always been. */
const BACKDROP = [15, 15, 17]

export interface Histogram {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  luma: Uint32Array
  /** Tallest bin, ignoring the two ends. */
  peak: number
  /** Fraction of samples with at least one channel hard against 0 or 255. */
  clippedLow: number
  clippedHigh: number
}

export function histogram(sample: ScopeSample): Histogram {
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  const luma = new Uint32Array(256)
  const { data } = sample
  let total = 0
  let low = 0
  let high = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < OPAQUE) continue
    total++
    r[data[i]]++
    g[data[i + 1]]++
    b[data[i + 2]]++
    luma[Math.round(LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2])]++
    if (data[i] === 0 || data[i + 1] === 0 || data[i + 2] === 0) low++
    if (data[i] === 255 || data[i + 1] === 255 || data[i + 2] === 255) high++
  }

  // The end bins are where every clipped pixel piles up, and one blown sky can
  // be tall enough to flatten the entire rest of the plot into the baseline.
  // They are reported separately instead, as the numbers they actually are.
  let peak = 1
  for (let i = 1; i < 255; i++) {
    peak = Math.max(peak, r[i], g[i], b[i], luma[i])
  }

  const samples = Math.max(total, 1)
  return { r, g, b, luma, peak, clippedLow: low / samples, clippedHigh: high / samples }
}

/**
 * How a raw count becomes a brightness.
 *
 * Saturating rather than linear: a waveform is mostly a few very dense traces
 * over a wide field of nearly empty cells, and scaling linearly against the peak
 * leaves everything but the densest trace invisible. This flattens the top end
 * and keeps the sparse cells legible, which is the whole point of the display.
 */
function intensity(count: number, gain: number): number {
  return count === 0 ? 0 : 1 - Math.exp(-count * gain)
}

export type WaveformMode = 'luma' | 'rgb' | 'parade'

/**
 * A plot at its own resolution, for the caller to scale onto the canvas.
 *
 * The two are deliberately separate. A plot can only be as wide as the picture
 * has columns and as tall as there are levels to distinguish, and drawing it any
 * larger than that does not add detail — it spreads the same measurements across
 * more cells and leaves gaps between them, which reads as a broken trace rather
 * than as a magnified one.
 */
export interface ScopeImage {
  pixels: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}

/** Levels an 8-bit pipeline can tell apart; taller than this measures nothing new. */
const LEVELS = 256

/**
 * Column-by-column plot of level against horizontal position.
 *
 * The parade is the same measurement with the three channels laid side by side
 * instead of on top of each other, so it is built here too rather than in a
 * near-copy: only the column each sample lands in differs.
 */
export function waveformImage(
  sample: ScopeSample,
  maxWidth: number,
  maxHeight: number,
  mode: WaveformMode = 'rgb',
): ScopeImage {
  const lanes = mode === 'parade' ? 3 : 1
  const lane = Math.max(1, Math.min(Math.floor(maxWidth / lanes), sample.width))
  const height = Math.max(1, Math.min(maxHeight, LEVELS))
  const width = lane * lanes
  const planes = mode === 'luma' ? 1 : 3
  const counts = new Uint32Array(lane * height * planes)
  const { data, width: sw, height: sh } = sample

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4
      if (data[i + 3] < OPAQUE) continue
      const column = Math.min(lane - 1, Math.floor((x / sw) * lane))

      if (planes === 1) {
        const value = LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2]
        const row = Math.min(height - 1, Math.floor((1 - value / 255) * height))
        counts[row * lane + column]++
      } else {
        for (let c = 0; c < 3; c++) {
          const row = Math.min(height - 1, Math.floor((1 - data[i + c] / 255) * height))
          counts[(row * lane + column) * 3 + c]++
        }
      }
    }
  }

  // Referenced against how many samples a column would hold if its levels were
  // spread evenly, so the trace keeps the same weight whatever size the proxy is.
  const expected = Math.max(1, ((sw / lane) * sh) / height)
  const gain = 1.6 / expected

  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = BACKDROP[0]
      out[o + 1] = BACKDROP[1]
      out[o + 2] = BACKDROP[2]
      out[o + 3] = 255

      const column = x % lane
      if (planes === 1) {
        const v = intensity(counts[y * lane + column], gain) * 235
        out[o] += v
        out[o + 1] += v
        out[o + 2] += v
      } else {
        const cell = (y * lane + column) * 3
        // In parade mode each third of the plot shows one channel; overlaid, all
        // three are drawn into the same column and add up as light does.
        const first = mode === 'parade' ? Math.floor(x / lane) : 0
        const last = mode === 'parade' ? first : 2
        for (let c = first; c <= last; c++) {
          out[o + c] += intensity(counts[cell + c], gain) * 235
        }
      }
    }
  }
  return { pixels: out, width, height }
}

/** Where the six colour targets sit, in -1..1 with y upwards. */
export interface VectorTarget {
  label: string
  x: number
  y: number
  color: string
}

/**
 * Rec. 601 chroma axes, which is what a vectorscope has always plotted: blue
 * minus luma across, red minus luma up. Every graticule anyone has ever read is
 * drawn against these, so the axes are not ours to modernise.
 */
function chroma(r: number, g: number, b: number): [number, number] {
  return [
    (-0.14713 * r - 0.28886 * g + 0.436 * b) / 255,
    (0.615 * r - 0.51499 * g - 0.10001 * b) / 255,
  ]
}

/** Full saturation lands a little inside the rim, leaving room to see overshoot. */
const CHROMA_SCALE = 1 / 0.72

/** Beyond this the scatter thins out into isolated dots instead of a trace. */
const MAX_VECTOR_SIDE = 192

const PRIMARIES: [string, number, number, number, string][] = [
  ['R', 255, 0, 0, '#e5484d'],
  ['Yl', 255, 255, 0, '#d4b106'],
  ['G', 0, 255, 0, '#30a46c'],
  ['Cy', 0, 255, 255, '#00a2c7'],
  ['B', 0, 0, 255, '#3e63dd'],
  ['Mg', 255, 0, 255, '#c2298a'],
]

/**
 * The targets at 75 % saturation, which is the reference every broadcast
 * graticule uses and what colour bars are generated at.
 */
export const VECTOR_TARGETS: VectorTarget[] = PRIMARIES.map(([label, r, g, b, color]) => {
  const [u, v] = chroma(r * 0.75, g * 0.75, b * 0.75)
  return { label, x: u * CHROMA_SCALE, y: v * CHROMA_SCALE, color }
})

/**
 * Chroma scatter: how much colour the picture holds and in which directions.
 *
 * Each cell is tinted with the hue of where it sits rather than left grey, which
 * costs nothing and turns "there is a cluster up and to the left" into "the skin
 * tones are where they should be".
 */
export function vectorscopeImage(sample: ScopeSample, maxSide: number): ScopeImage {
  const size = Math.max(32, Math.min(maxSide, MAX_VECTOR_SIDE))
  const counts = new Uint32Array(size * size)
  const { data } = sample
  let total = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < OPAQUE) continue
    total++
    const [u, v] = chroma(data[i], data[i + 1], data[i + 2])
    const x = Math.round((u * CHROMA_SCALE * 0.5 + 0.5) * (size - 1))
    const y = Math.round((0.5 - v * CHROMA_SCALE * 0.5) * (size - 1))
    if (x < 0 || y < 0 || x >= size || y >= size) continue
    counts[y * size + x]++
  }

  // A neutral photograph puts almost everything in the few cells around the
  // centre, so the reference is the mean over the disc rather than the peak.
  const gain = 6 / Math.max(1, total / (size * size))
  const out = new Uint8ClampedArray(size * size * 4)
  const centre = (size - 1) / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      out[o] = BACKDROP[0]
      out[o + 1] = BACKDROP[1]
      out[o + 2] = BACKDROP[2]
      out[o + 3] = 255

      const count = counts[y * size + x]
      if (count === 0) continue
      const level = intensity(count, gain) * 255

      // Hue of the cell's own direction, so the plot is coloured like the wheel
      // it is measured against. Radius decides how far from grey it is drawn.
      const dx = (x - centre) / centre
      const dy = (centre - y) / centre
      const radius = Math.min(1, Math.hypot(dx, dy))
      const [hr, hg, hb] = hueRgb(Math.atan2(dy, dx) / (Math.PI * 2))
      out[o] += level * (1 - radius + radius * hr)
      out[o + 1] += level * (1 - radius + radius * hg)
      out[o + 2] += level * (1 - radius + radius * hb)
    }
  }
  return { pixels: out, width: size, height: size }
}

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
