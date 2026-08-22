import { useRef } from 'react'
import { ACCEPTED_FILE_TYPES } from '../lib/decode'
import { useEditor } from '../state/editorStore'
import { IconCompare, IconDownload, IconRedo, IconUndo } from './icons'

interface TopBarProps {
  onExport: () => void
  onCompareChange: (active: boolean) => void
  comparing: boolean
}

export function TopBar({ onExport, onCompareChange, comparing }: TopBarProps) {
  const image = useEditor((s) => s.image)
  const loading = useEditor((s) => s.status === 'loading')
  const openFile = useEditor((s) => s.openFile)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__name">Iris</span>
        {image && <span className="topbar__file">{image.name}</span>}
      </div>

      {/* HEIC files decode through WebAssembly and can take a few seconds. */}
      {loading && (
        <span className="topbar__loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Abriendo…
        </span>
      )}

      <div className="topbar__spacer" />

      {image && (
        <>
          <div className="topbar__group">
            <button
              className="btn btn--icon"
              onClick={undo}
              disabled={!canUndo}
              title="Deshacer (⌘Z)"
              aria-label="Deshacer"
            >
              <IconUndo />
            </button>
            <button
              className="btn btn--icon"
              onClick={redo}
              disabled={!canRedo}
              title="Rehacer (⇧⌘Z)"
              aria-label="Rehacer"
            >
              <IconRedo />
            </button>
          </div>

          <button
            className={`btn${comparing ? ' btn--active' : ''}`}
            title="Mantén pulsado para ver el original (\\)"
            aria-label="Comparar con el original"
            onPointerDown={() => onCompareChange(true)}
            onPointerUp={() => onCompareChange(false)}
            onPointerLeave={() => onCompareChange(false)}
            onPointerCancel={() => onCompareChange(false)}
          >
            <IconCompare />
            <span className="btn--wide-only">Original</span>
          </button>
        </>
      )}

      <button className="btn" onClick={() => inputRef.current?.click()}>
        Abrir
      </button>

      {image && (
        <button className="btn btn--primary" onClick={onExport}>
          <IconDownload />
          <span className="btn--wide-only">Exportar</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void openFile(file)
          e.target.value = ''
        }}
      />
    </header>
  )
}
