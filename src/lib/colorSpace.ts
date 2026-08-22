/**
 * Colour management.
 *
 * Iris works in Display P3 wherever the browser allows it. P3 contains sRGB
 * entirely, so an ordinary sRGB photo loses nothing by being processed there,
 * while a photo from a modern phone keeps the colours it actually has. Without
 * this, a saturated red shot on an iPhone arrives as its nearest sRGB
 * neighbour — measurably duller — and every adjustment is then made against a
 * rendition the file never contained.
 */
export type ColorSpace = 'srgb' | 'display-p3'

/**
 * Luminance weights for each space.
 *
 * These are the Y row of the RGB→XYZ matrix, and they differ per primaries.
 * Every tone control works on luminance, so using sRGB's weights on P3 data
 * would quietly mis-weight the whole tonal range.
 */
export const LUMA: Record<ColorSpace, [number, number, number]> = {
  srgb: [0.2126, 0.7152, 0.0722],
  'display-p3': [0.2289746, 0.6917385, 0.0792869],
}

let supported: boolean | null = null

/** Whether this browser can present and unpack a wide-gamut drawing buffer. */
export function supportsWideGamut(): boolean {
  if (supported !== null) return supported
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2')
    if (!gl || !('drawingBufferColorSpace' in gl)) return (supported = false)
    gl.drawingBufferColorSpace = 'display-p3'
    supported = gl.drawingBufferColorSpace === 'display-p3'
  } catch {
    supported = false
  }
  return supported
}

/** The space every render happens in. Resolved once, at startup. */
export function workingSpace(): ColorSpace {
  return supportsWideGamut() ? 'display-p3' : 'srgb'
}

export const EXPORT_SPACES: ColorSpace[] = ['srgb', 'display-p3']

// Linear Display P3 to linear sRGB. Standard matrix, D65 in both.
const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0.0],
  [-0.0420569, 1.0420571, 0.0],
  [-0.0196376, -0.0786361, 1.0982735],
]

function toLinear(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Does this photo actually contain colours sRGB cannot hold?
 *
 * The ICC tag is not the interesting question — plenty of P3-tagged files sit
 * entirely inside sRGB and lose nothing on the way out. What matters is whether
 * converting would clip something, so that is what gets measured: the image is
 * sampled small, read back as P3, and pushed through the matrix to see if any
 * channel falls off the end.
 */
export async function hasWideGamutContent(bitmap: ImageBitmap): Promise<boolean> {
  if (!supportsWideGamut()) return false
  try {
    // A thumbnail is plenty: out-of-gamut colour comes in areas, not lone pixels.
    const size = 128
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { colorSpace: 'display-p3' })
    if (!context) return false
    context.drawImage(bitmap, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height, { colorSpace: 'display-p3' })

    let outside = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = toLinear(data[i])
      const g = toLinear(data[i + 1])
      const b = toLinear(data[i + 2])
      for (const row of P3_TO_SRGB) {
        const channel = row[0] * r + row[1] * g + row[2] * b
        // A hair of tolerance, so rounding noise is not mistaken for gamut.
        if (channel < -0.004 || channel > 1.004) {
          outside++
          break
        }
      }
    }
    // A handful of stray pixels is not worth warning anybody about.
    return outside > data.length / 4 / 200
  } catch {
    return false
  }
}
