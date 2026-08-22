import { useEditor } from '../state/editorStore'
import { useDict } from '../i18n'
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SPECS,
  DEFAULT_ADJUSTMENTS,
  isDefault,
} from '../types/adjustments'
import { PresetStrip } from './PresetStrip'
import { Slider } from './Slider'
import { IconDownload, IconReset } from './icons'

export function AdjustmentsPanel({ onExport }: { onExport: () => void }) {
  const image = useEditor((s) => s.image)
  const adjustments = useEditor((s) => s.edit.adjustments)
  const startEdit = useEditor((s) => s.startEdit)
  const setAdjustment = useEditor((s) => s.setAdjustment)
  const endEdit = useEditor((s) => s.endEdit)
  const resetAdjustments = useEditor((s) => s.resetAdjustments)
  const t = useDict()

  if (!image) {
    return (
      <aside className="panel">
        <p className="panel__empty">{t.panel.emptyAdjust}</p>
      </aside>
    )
  }

  const untouched = isDefault(adjustments)

  return (
    <aside className="panel">
      <div className="panel__scroll">
        <PresetStrip />

        {ADJUSTMENT_GROUPS.map((group) => (
          <section className="group" key={group}>
            <h2 className="group__title">{t.groups[group]}</h2>
            {ADJUSTMENT_SPECS.filter((spec) => spec.group === group).map((spec) => (
              <Slider
                key={spec.key}
                spec={spec}
                label={t.adjustments[spec.key]}
                value={adjustments[spec.key]}
                defaultValue={DEFAULT_ADJUSTMENTS[spec.key]}
                onStart={startEdit}
                onChange={(value) => setAdjustment(spec.key, value)}
                onEnd={endEdit}
              />
            ))}
          </section>
        ))}
      </div>

      <div className="panel__footer">
        <button className="btn" onClick={resetAdjustments} disabled={untouched}>
          <IconReset /> {t.panel.reset}
        </button>
        <button className="btn btn--primary" onClick={onExport}>
          <IconDownload /> {t.app.export}
        </button>
      </div>
    </aside>
  )
}
