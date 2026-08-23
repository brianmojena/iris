import { Renderer } from '../src/engine/Renderer'
import { DEFAULT_ADJUSTMENTS, type Adjustments } from '../src/types/adjustments'
import { defaultGeometry, outputSize, type Geometry } from '../src/types/geometry'
import { defaultGrade, type Grade } from '../src/types/grade'
import type { Edit } from '../src/types/edit'

export interface Rendered {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function edit(
  bitmap: ImageBitmap,
  adjustments: Partial<Adjustments> = {},
  geometry: Partial<Geometry> = {},
  grade: Partial<Grade> = {},
): Edit {
  return {
    adjustments: { ...DEFAULT_ADJUSTMENTS, ...adjustments },
    grade: { ...defaultGrade(), ...grade },
    geometry: { ...defaultGeometry(bitmap.width, bitmap.height), ...geometry },
  }
}

/**
 * Runs an image through the real pipeline and hands back its pixels.
 *
 * Deliberately the same entry point the export button uses: a test harness that
 * reimplements the render is a test of the harness.
 */
export async function render(
  bitmap: ImageBitmap,
  source: Edit,
  /**
   * Which space to read the result back in. sRGB by default, so assertions read
   * in the numbers everybody already has intuitions about; the colour-management
   * tests ask for display-p3 to see the gamut the pipeline actually kept.
   */
  readAs: 'srgb' | 'display-p3' = 'srgb',
): Promise<Rendered> {
  const { width, height } = outputSize(source.geometry, bitmap.width, bitmap.height)
  const canvas = new OffscreenCanvas(width, height)
  const renderer = new Renderer(canvas)
  try {
    renderer.setImage(bitmap)
    renderer.render(source, width, height)
    // Reading through a 2D context, because the drawing buffer of a WebGL canvas
    // is not guaranteed to survive past the current task.
    const readable = new OffscreenCanvas(width, height)
    const context = readable.getContext('2d', { colorSpace: readAs })!
    context.drawImage(canvas, 0, 0)
    return {
      width,
      height,
      data: context.getImageData(0, 0, width, height, { colorSpace: readAs }).data,
    }
  } finally {
    renderer.dispose()
  }
}

export function pixelAt(image: Rendered, x: number, y: number): [number, number, number, number] {
  const i = (Math.round(y) * image.width + Math.round(x)) * 4
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]]
}

/** Samples a fraction of the way across, which survives a change of crop. */
export function pixelAtFraction(image: Rendered, fx: number, fy: number) {
  return pixelAt(image, fx * (image.width - 1), fy * (image.height - 1))
}

export function luminance([r, g, b]: number[]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export interface RegionStats {
  mean: number
  deviation: number
  /** Mean absolute difference between horizontally adjacent pixels. */
  gradient: number
}

/** Statistics over a window given in fractions of the image. */
export function stats(image: Rendered, fx: number, fy: number, size = 48): RegionStats {
  const x0 = Math.round(fx * (image.width - size))
  const y0 = Math.round(fy * (image.height - size))
  let sum = 0
  let sumSquares = 0
  let gradientSum = 0
  let gradientCount = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = luminance(pixelAt(image, x0 + x, y0 + y))
      sum += value
      sumSquares += value * value
      if (x < size - 1) {
        gradientSum += Math.abs(luminance(pixelAt(image, x0 + x + 1, y0 + y)) - value)
        gradientCount++
      }
    }
  }

  const count = size * size
  const mean = sum / count
  return {
    mean,
    deviation: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)),
    gradient: gradientSum / Math.max(gradientCount, 1),
  }
}

/** Mean luminance of every pixel. A bias has nowhere to hide in this number. */
export function imageMean(image: Rendered): number {
  let total = 0
  for (let i = 0; i < image.data.length; i += 4) {
    total += 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]
  }
  return total / (image.data.length / 4)
}

/** Saturation as a fraction of brightness, which is what "looks vivid" tracks. */
export function chroma([r, g, b]: number[]): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}
