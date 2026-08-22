import { Renderer } from '../engine/Renderer'
import { outputSize } from '../types/geometry'
import type { Edit } from '../state/editorStore'

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ExportOptions {
  format: ExportFormat
  /** 0..1, ignored for PNG. */
  quality: number
  /** Longest edge in pixels. Null keeps the original size. */
  maxEdge: number | null
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

  const renderer = new Renderer(canvas)
  try {
    renderer.setImage(bitmap)
    renderer.render(edit.adjustments, width, height, { geometry: edit.geometry })

    if (canvas instanceof HTMLCanvasElement) {
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('La exportación falló.'))),
          options.format,
          options.quality,
        )
      })
    }
    return await canvas.convertToBlob({ type: options.format, quality: options.quality })
  } finally {
    renderer.dispose()
  }
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
