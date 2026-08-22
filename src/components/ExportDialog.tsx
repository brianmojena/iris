import { useEffect, useState } from 'react'
import { useEditor } from '../state/editorStore'
import { outputSize } from '../types/geometry'
import { fill, useDict } from '../i18n'
import { EXPORT_SPACES, supportsWideGamut, type ColorSpace } from '../lib/colorSpace'
import {
  EXPORT_FORMATS,
  downloadBlob,
  exportDimensions,
  extensionFor,
  formatBytes,
  renderToBlob,
  type ExportFormat,
} from '../lib/export'

/** Only the first needs a word; the rest are pixel counts in any language. */
const SIZE_PRESETS: { label: string | null; maxEdge: number | null }[] = [
  { label: null, maxEdge: null },
  { label: '4096 px', maxEdge: 4096 },
  { label: '2048 px', maxEdge: 2048 },
  { label: '1080 px', maxEdge: 1080 },
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const image = useEditor((s) => s.image)
  const edit = useEditor((s) => s.edit)
  const options = useEditor((s) => s.exportOptions)
  const setExportOptions = useEditor((s) => s.setExportOptions)
  const isExporting = useEditor((s) => s.isExporting)
  const setExporting = useEditor((s) => s.setExporting)
  const notify = useEditor((s) => s.notify)
  const [size, setSize] = useState<number | null>(null)
  const t = useDict()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The size readout encodes the real thing at the real target size. Estimating
  // from a downscaled proxy was tempting but wrong by nearly 2×: shrinking an
  // image concentrates detail, so bytes-per-pixel goes up and extrapolating back
  // overshoots badly. Debounced and cancellable, an exact answer is affordable.
  useEffect(() => {
    if (!image) return
    let cancelled = false
    setSize(null)
    const timer = setTimeout(async () => {
      try {
        const blob = await renderToBlob(image.bitmap, edit, options)
        if (!cancelled) setSize(blob.size)
      } catch {
        if (!cancelled) setSize(null)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [image, edit, options])

  if (!image) return null

  const cropped = outputSize(edit.geometry, image.bitmap.width, image.bitmap.height)
  const target = exportDimensions(cropped.width, cropped.height, options.maxEdge)
  const lossy = options.format !== 'image/png'

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await renderToBlob(image.bitmap, edit, options)
      downloadBlob(blob, `${image.name}-iris.${extensionFor(options.format)}`)
      onClose()
    } catch (error) {
      notify({
        kind: 'error',
        message: error instanceof Error ? error.message : t.notices.exportFailed,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.export.label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">{t.export.title}</div>

        <div className="dialog__body">
          <div className="field">
            <span className="field__label">{t.export.format}</span>
            <div className="segmented">
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format.value}
                  aria-pressed={options.format === format.value}
                  onClick={() => setExportOptions({ format: format.value as ExportFormat })}
                >
                  {format.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">{t.export.size}</span>
            <div className="segmented">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.maxEdge ?? 'original'}
                  aria-pressed={options.maxEdge === preset.maxEdge}
                  onClick={() => setExportOptions({ maxEdge: preset.maxEdge })}
                >
                  {preset.label ?? t.export.original}
                </button>
              ))}
            </div>
          </div>

          {/* Only offered where the browser can actually present a wide gamut;
              elsewhere the choice would be a control that does nothing. */}
          {supportsWideGamut() && (
            <div className="field">
              <span className="field__label">{t.export.colorSpace}</span>
              <div className="segmented">
                {EXPORT_SPACES.map((space) => (
                  <button
                    key={space}
                    aria-pressed={options.colorSpace === space}
                    title={space === 'srgb' ? t.export.srgbHint : t.export.p3Hint}
                    onClick={() => setExportOptions({ colorSpace: space as ColorSpace })}
                  >
                    {space === 'srgb' ? t.export.srgb : t.export.displayP3}
                  </button>
                ))}
              </div>
              {image.wideGamut && options.colorSpace === 'srgb' && (
                <p className="field__note">{t.export.wideGamutNote}</p>
              )}
            </div>
          )}

          {lossy && (
            <div className="field">
              <span className="field__label">
                {t.export.quality} · {Math.round(options.quality * 100)}
              </span>
              <input
                className="range"
                type="range"
                min={0.4}
                max={1}
                step={0.01}
                value={options.quality}
                onChange={(e) => setExportOptions({ quality: Number(e.target.value) })}
              />
            </div>
          )}

          <p className="dialog__meta">
            {fill(t.export.dimensions, { width: target.width, height: target.height })}
            {size !== null && ` · ${formatBytes(size)}`}
          </p>
        </div>

        <div className="dialog__foot">
          <button className="btn" onClick={onClose}>
            {t.export.cancel}
          </button>
          <button className="btn btn--primary" onClick={handleExport} disabled={isExporting}>
            {isExporting ? t.export.working : t.export.download}
          </button>
        </div>
      </div>
    </div>
  )
}
