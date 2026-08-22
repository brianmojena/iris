import { useEffect, useRef } from 'react'
import { useEditor } from '../state/editorStore'
import { IconReset } from './icons'

export function HistoryPanel() {
  const image = useEditor((s) => s.image)
  const history = useEditor((s) => s.history)
  const index = useEditor((s) => s.index)
  const jumpTo = useEditor((s) => s.jumpTo)
  const listRef = useRef<HTMLOListElement>(null)

  // Keep the current step in view as it moves, including while undoing.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!image) {
    return (
      <aside className="panel">
        <p className="panel__empty">Abre una foto para ver su historial.</p>
      </aside>
    )
  }

  return (
    <aside className="panel">
      <div className="panel__scroll">
        <ol className="history" ref={listRef}>
          {history.map((entry, position) => (
            <li key={position}>
              <button
                className={`history__step${position > index ? ' history__step--undone' : ''}`}
                aria-current={position === index ? 'step' : undefined}
                onClick={() => jumpTo(position)}
              >
                <span className="history__dot" aria-hidden="true" />
                <span className="history__label">{entry.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="panel__footer">
        <button
          className="btn"
          onClick={() => jumpTo(0)}
          disabled={index === 0}
          style={{ flex: 1 }}
        >
          <IconReset /> Volver al original
        </button>
      </div>
    </aside>
  )
}
