import { useEffect, useState } from 'react'
import { useEditor } from '../state/editorStore'
import { isDefault } from '../types/adjustments'
import { fill, useDict } from '../i18n'
import { IconClose, IconPlus } from './icons'

export function PresetStrip() {
  const presets = useEditor((s) => s.presets)
  const adjustments = useEditor((s) => s.edit.adjustments)
  const applyPreset = useEditor((s) => s.applyPreset)
  const createPreset = useEditor((s) => s.createPreset)
  const removePreset = useEditor((s) => s.removePreset)
  const loadPresets = useEditor((s) => s.loadPresets)

  const t = useDict()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    void loadPresets()
  }, [loadPresets])

  const active = presets.find((preset) =>
    (Object.keys(adjustments) as (keyof typeof adjustments)[]).every(
      (key) => preset.adjustments[key] === adjustments[key],
    ),
  )

  const save = async () => {
    await createPreset(name)
    setName('')
    setNaming(false)
  }

  return (
    <section className="group">
      <h2 className="group__title">{t.presets.title}</h2>

      <div className="chips">
        {presets.map((preset) => (
          <span key={preset.id} className="chip-wrap">
            <button
              className="chip"
              aria-pressed={active?.id === preset.id}
              onClick={() => applyPreset(preset)}
            >
              {preset.builtIn
                ? t.presets.builtIn[preset.id as keyof typeof t.presets.builtIn]
                : preset.name}
            </button>
            {!preset.builtIn && (
              <button
                className="chip__remove"
                aria-label={fill(t.presets.remove, { name: preset.name ?? '' })}
                onClick={() => void removePreset(preset.id)}
              >
                <IconClose size={11} />
              </button>
            )}
          </span>
        ))}

        {!naming && (
          <button
            className="chip chip--ghost"
            onClick={() => setNaming(true)}
            disabled={isDefault(adjustments)}
            title={isDefault(adjustments) ? t.presets.saveDisabled : t.presets.saveHint}
          >
            <IconPlus size={13} /> {t.presets.save}
          </button>
        )}
      </div>

      {naming && (
        <form
          className="preset-form"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <input
            className="input"
            autoFocus
            value={name}
            placeholder={t.presets.placeholder}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setNaming(false)
                setName('')
              }
            }}
          />
          <button className="btn btn--primary" type="submit" disabled={!name.trim()}>
            {t.presets.save}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setNaming(false)
              setName('')
            }}
          >
            {t.presets.cancel}
          </button>
        </form>
      )}
    </section>
  )
}
