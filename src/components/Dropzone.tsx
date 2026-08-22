import { useRef, useState } from 'react'
import { ACCEPTED_FILE_TYPES } from '../lib/decode'
import { useEditor } from '../state/editorStore'
import { useDict } from '../i18n'
import { IconImage } from './icons'

export function Dropzone() {
  const openFile = useEditor((s) => s.openFile)
  const status = useEditor((s) => s.status)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useDict()
  const [over, setOver] = useState(false)
  // Drag events fire for every child element, so we count instead of toggling.
  const depth = useRef(0)

  const accept = (files: FileList | null) => {
    const file = files?.[0]
    if (file) void openFile(file)
  }

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        depth.current -= 1
        if (depth.current <= 0) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        accept(e.dataTransfer.files)
      }}
    >
      <div className="dropzone__inner">
        <div className="dropzone__icon">
          <IconImage />
        </div>
        <p className="dropzone__title">
          {status === 'loading' ? t.app.opening : t.dropzone.title}
        </p>
        <p className="dropzone__hint">
          {t.dropzone.or}{' '}
          <button
            className="btn"
            style={{ height: 'auto', padding: 0, textDecoration: 'underline' }}
            onClick={() => inputRef.current?.click()}
          >
            {t.dropzone.choose}
          </button>
          <br />
          {t.dropzone.privacy}
        </p>
        <p className="dropzone__formats">{t.dropzone.formats}</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          hidden
          onChange={(e) => {
            accept(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
