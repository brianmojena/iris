import { useEffect, useState } from 'react'
import { useEditor } from '../state/editorStore'
import { outputSize } from '../types/geometry'
import {
  EXPORT_FORMATS,
  downloadBlob,
  exportDimensions,
  extensionFor,
  formatBytes,
  renderToBlob,
  type ExportFormat,
} from '../lib/export'

const SIZE_PRESETS: { label: string; maxEdge: number | null }[] = [
  { label: 'Original', maxEdge: null },
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
        message: error instanceof Error ? error.message : 'La exportación falló.',
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
        aria-label="Exportar imagen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">Exportar</div>

        <div className="dialog__body">
          <div className="field">
            <span className="field__label">Formato</span>
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
            <span className="field__label">Tamaño</span>
            <div className="segmented">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  aria-pressed={options.maxEdge === preset.maxEdge}
                  onClick={() => setExportOptions({ maxEdge: preset.maxEdge })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {lossy && (
            <div className="field">
              <span className="field__label">Calidad · {Math.round(options.quality * 100)}</span>
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
            {target.width} × {target.height} px
            {size !== null && ` · ${formatBytes(size)}`}
          </p>
        </div>

        <div className="dialog__foot">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exportando…' : 'Descargar'}
          </button>
        </div>
      </div>
    </div>
  )
}
