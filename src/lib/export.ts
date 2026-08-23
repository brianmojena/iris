import { Renderer } from '../engine/Renderer'
import { dict } from '../i18n'
import { outputSize } from '../types/geometry'
import { workingSpace, type ColorSpace } from './colorSpace'
import type { Edit } from '../state/editorStore'

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ExportOptions {
  format: ExportFormat
  /** 0..1, ignored for PNG. */
  quality: number
  /** Longest edge in pixels. Null keeps the original size. */
  maxEdge: number | null
  /** The space the file is tagged with. sRGB is the safe default everywhere. */
  colorSpace: ColorSpace
}

export const EXPORT_FORMATS: { value: ExportFormat; label: string; extension: string }[] = [
  { value: 'image/jpeg', label: 'JPEG', extension: 'jpg' },
  { value: 'image/png', label: 'PNG', extension: 'png' },
  { value: 'image/webp', label: 'WebP', extension: 'webp' },
]

export function extensionFor(format: ExportFormat): string {
  return EXPORT_FORMATS.find((f) => f.value === format)?.extension ?? 'jpg'
}

export function exportDimensions(
  width: number,
  height: number,
  maxEdge: number | null,
): { width: number; height: number } {
  if (!maxEdge) return { width, height }
  const largest = Math.max(width, height)
  if (largest <= maxEdge) return { width, height }
  const scale = maxEdge / largest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Renders at full resolution on a throwaway offscreen context.
 *
 * Using a separate context rather than the preview one means the visible canvas
 * never has to resize mid-export (which would flash), and the export runs
 * through the exact same shader the user has been looking at.
 */
export async function renderToBlob(
  bitmap: ImageBitmap,
  edit: Edit,
  options: ExportOptions,
): Promise<Blob> {
  const cropped = outputSize(edit.geometry, bitmap.width, bitmap.height)
  const { width, height } = exportDimensions(cropped.width, cropped.height, options.maxEdge)

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })

  // Always render in the working space, so the export runs the exact same shader
  // maths as the preview. Narrowing to sRGB, when asked for, happens afterwards
  // as a conversion — never by quietly changing what the pipeline computed.
  const renderer = new Renderer(canvas, workingSpace())
  try {
    renderer.setImage(bitmap)
    renderer.render(edit, width, height)

    const encodable =
      options.colorSpace === workingSpace() ? canvas : convert(canvas, options.colorSpace)

    if (encodable instanceof HTMLCanvasElement) {
      return await new Promise<Blob>((resolve, reject) => {
        encodable.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error(dict().notices.exportFailed))),
          options.format,
          options.quality,
        )
      })
    }
    return await encodable.convertToBlob({ type: options.format, quality: options.quality })
  } finally {
    renderer.dispose()
  }
}

/**
 * Re-encodes a rendered canvas into another colour space.
 *
 * The browser owns the conversion, including how out-of-gamut colour is brought
 * back in. Doing the matrix by hand here would be a second, worse implementation
 * of something already sitting in the platform.
 */
function convert(source: HTMLCanvasElement | OffscreenCanvas, target: ColorSpace) {
  const { width, height } = source
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d', { colorSpace: target })?.drawImage(source, 0, 0)
    return canvas
  }
  const canvas = Object.assign(document.createElement('canvas'), { width, height })
  canvas.getContext('2d', { colorSpace: target })?.drawImage(source, 0, 0)
  return canvas
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
