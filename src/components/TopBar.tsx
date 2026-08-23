import { useRef } from 'react'
import { ACCEPTED_FILE_TYPES } from '../lib/decode'
import { useEditor } from '../state/editorStore'
import { LOCALES, useDict, useLocaleStore } from '../i18n'
import { IconCompare, IconDownload, IconRedo, IconScope, IconUndo } from './icons'

interface TopBarProps {
  onExport: () => void
  onCompareChange: (active: boolean) => void
  comparing: boolean
  scopes: boolean
  onScopesChange: (active: boolean) => void
}

export function TopBar({
  onExport,
  onCompareChange,
  comparing,
  scopes,
  onScopesChange,
}: TopBarProps) {
  const image = useEditor((s) => s.image)
  const loading = useEditor((s) => s.status === 'loading')
  const openFile = useEditor((s) => s.openFile)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.index > 0)
  const canRedo = useEditor((s) => s.index < s.history.length - 1)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useDict()
  const locale = useLocaleStore((s) => s.locale)
  const setLocale = useLocaleStore((s) => s.setLocale)

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
          {t.app.opening}
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
              title={t.app.undoHint}
              aria-label={t.app.undo}
            >
              <IconUndo />
            </button>
            <button
              className="btn btn--icon"
              onClick={redo}
              disabled={!canRedo}
              title={t.app.redoHint}
              aria-label={t.app.redo}
            >
              <IconRedo />
            </button>
          </div>

          <button
            className={`btn btn--icon${scopes ? ' btn--active' : ''}`}
            onClick={() => onScopesChange(!scopes)}
            aria-pressed={scopes}
            title={scopes ? t.scopes.hide : t.scopes.show}
            aria-label={scopes ? t.scopes.hide : t.scopes.show}
          >
            <IconScope />
          </button>

          <button
            className={`btn${comparing ? ' btn--active' : ''}`}
            title={t.app.compareHint}
            aria-label={t.app.compareLabel}
            onPointerDown={() => onCompareChange(true)}
            onPointerUp={() => onCompareChange(false)}
            onPointerLeave={() => onCompareChange(false)}
            onPointerCancel={() => onCompareChange(false)}
          >
            <IconCompare />
            <span className="btn--wide-only">{t.app.compare}</span>
          </button>
        </>
      )}

      <button className="btn" onClick={() => inputRef.current?.click()}>
        {t.app.open}
      </button>

      {image && (
        <button className="btn btn--primary" onClick={onExport}>
          <IconDownload />
          <span className="btn--wide-only">{t.app.export}</span>
        </button>
      )}

      <select
        className="language"
        aria-label={t.app.language}
        value={locale}
        onChange={(event) => setLocale(event.target.value as (typeof LOCALES)[number])}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>

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
