import { useCallback, useEffect, useRef, useState } from 'react'
import { AdjustmentsPanel } from './components/AdjustmentsPanel'
import { GradePanel } from './components/GradePanel'
import { GeometryPanel } from './components/GeometryPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { CanvasView } from './components/CanvasView'
import { Dropzone } from './components/Dropzone'
import { ExportDialog } from './components/ExportDialog'
import { TopBar } from './components/TopBar'
import { IconClock, IconClose, IconCrop, IconCurve, IconSliders } from './components/icons'
import { useEditor } from './state/editorStore'
import { useDict } from './i18n'

export default function App() {
  const image = useEditor((s) => s.image)
  const notice = useEditor((s) => s.notice)
  const notify = useEditor((s) => s.notify)
  const openFile = useEditor((s) => s.openFile)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const restoreSession = useEditor((s) => s.restoreSession)

  const [exporting, setExporting] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [tab, setTab] = useState<'adjust' | 'color' | 'crop' | 'history'>('adjust')
  const [scopes, setScopes] = useState(false)
  const t = useDict()
  // Drag events bubble through every child, so track enter/leave depth.
  const dragDepth = useRef(0)
  const [draggingOver, setDraggingOver] = useState(false)

  const openExport = useCallback(() => setExporting(true), [])

  // Pick up where the last visit left off, before anything else touches state.
  useEffect(() => {
    void restoreSession()
  }, [restoreSession])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal keys from a field the user is typing in.
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.matches('input, textarea, select, [contenteditable]')
      ) {
        return
      }
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? redo() : undo()
      } else if (mod && event.key.toLowerCase() === 'e' && image) {
        event.preventDefault()
        openExport()
      } else if (event.key === '\\' && !event.repeat) {
        setComparing(true)
      } else if (event.key.toLowerCase() === 'c' && !mod && image) {
        setTab((current) => (current === 'crop' ? 'adjust' : 'crop'))
      } else if (event.key.toLowerCase() === 's' && !mod && image) {
        setScopes((current) => !current)
      } else if (event.key === 'Escape') {
        setTab('adjust')
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === '\\') setComparing(false)
    }
    // A released modifier can swallow the keyup, so clear on blur too.
    const onBlur = () => setComparing(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [undo, redo, image, openExport])

  // Paste an image straight from the clipboard.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])][0]
      if (file?.type.startsWith('image/')) {
        event.preventDefault()
        void openFile(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [openFile])

  // Auto-dismiss informational notices; errors stay until closed.
  useEffect(() => {
    if (notice?.kind !== 'info') return
    const timer = setTimeout(() => notify(null), 6000)
    return () => clearTimeout(timer)
  }, [notice, notify])

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        setDraggingOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setDraggingOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDraggingOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void openFile(file)
      }}
    >
      <TopBar
        onExport={openExport}
        onCompareChange={setComparing}
        comparing={comparing}
        scopes={scopes}
        onScopesChange={setScopes}
      />

      <div className="workspace">
        {image ? (
          <CanvasView
            showOriginal={comparing}
            cropMode={tab === 'crop'}
            showScopes={scopes}
            onCloseScopes={() => setScopes(false)}
            grading={tab === 'color'}
          />
        ) : (
          <Dropzone />
        )}

        <div className="panel-host">
          <nav className="tabs" aria-label={t.app.tools}>
            <button
              className="tabs__tab"
              aria-pressed={tab === 'adjust'}
              onClick={() => setTab('adjust')}
            >
              <IconSliders /> {t.tabs.adjust}
            </button>
            <button
              className="tabs__tab"
              aria-pressed={tab === 'color'}
              onClick={() => setTab('color')}
            >
              <IconCurve /> {t.tabs.color}
            </button>
            <button
              className="tabs__tab"
              aria-pressed={tab === 'crop'}
              onClick={() => setTab('crop')}
            >
              <IconCrop /> {t.tabs.crop}
            </button>
            <button
              className="tabs__tab"
              aria-pressed={tab === 'history'}
              onClick={() => setTab('history')}
            >
              <IconClock /> {t.tabs.history}
            </button>
          </nav>

          {tab === 'adjust' && <AdjustmentsPanel onExport={openExport} />}
          {tab === 'color' && <GradePanel onExport={openExport} />}
          {tab === 'crop' && <GeometryPanel onDone={() => setTab('adjust')} />}
          {tab === 'history' && <HistoryPanel />}
        </div>
      </div>

      {image && draggingOver && (
        <div className="backdrop" style={{ pointerEvents: 'none' }}>
          <div className="dialog" style={{ padding: '28px 32px', textAlign: 'center' }}>
            {t.dropzone.replace}
          </div>
        </div>
      )}

      {notice && (
        <div className={`notice${notice.kind === 'error' ? ' notice--error' : ''}`} role="status">
          <span>{notice.message}</span>
          <button
            className="notice__close"
            onClick={() => notify(null)}
            aria-label={t.notices.close}
          >
            <IconClose />
          </button>
        </div>
      )}

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}
