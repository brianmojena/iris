import { activeSecondaryIndex, useEditor } from '../state/editorStore'
import { fill, useDict } from '../i18n'
import type { SliderSpec } from '../types/adjustments'
import {
  CORRECTION_KEYS,
  DEFAULT_CORRECTION,
  isNeutralCorrection,
  MAX_SECONDARIES,
  type Secondary,
  type WindowShape,
} from '../types/secondary'
import { Slider } from './Slider'
import { IconClose, IconPipette, IconPlus, IconReset } from './icons'

/**
 * Slider shapes for the qualifier.
 *
 * The model stores turns and 0..1 fractions because that is what the shader
 * wants; the panel shows degrees and percentages because that is what a
 * photographer reads. The conversion lives here and nowhere else.
 */
const DEGREES: SliderSpec = { min: 0, max: 360, step: 1, origin: 0, suffix: '°' }
const HALF_TURN: SliderSpec = { min: 0, max: 180, step: 1, origin: 0, suffix: '°' }
const QUARTER_TURN: SliderSpec = { min: 0, max: 90, step: 1, origin: 0, suffix: '°' }
const PERCENT: SliderSpec = { min: 0, max: 100, step: 1, origin: 0, suffix: '%' }
const HALF_PERCENT: SliderSpec = { min: 0, max: 50, step: 1, origin: 0, suffix: '%' }
const ANGLE: SliderSpec = { min: -90, max: 90, step: 1, origin: 0, suffix: '°' }

const CORRECTION_SPECS: Record<string, SliderSpec> = {
  exposure: { min: -3, max: 3, step: 0.01, origin: 0, decimals: 2 },
  contrast: { min: -100, max: 100, step: 1, origin: 0 },
  temperature: { min: -100, max: 100, step: 1, origin: 0 },
  tint: { min: -100, max: 100, step: 1, origin: 0 },
  saturation: { min: -100, max: 100, step: 1, origin: 0 },
  hue: { min: -180, max: 180, step: 1, origin: 0, suffix: '°' },
}

const SHAPES: WindowShape[] = ['none', 'ellipse', 'rectangle']

export function SecondaryPanel() {
  const secondaries = useEditor((s) => s.edit.grade.secondaries)
  const index = useEditor(activeSecondaryIndex)
  const matteView = useEditor((s) => s.matteView)
  const picking = useEditor((s) => s.picking)
  const startEdit = useEditor((s) => s.startEdit)
  const endEdit = useEditor((s) => s.endEdit)
  const addSecondary = useEditor((s) => s.addSecondary)
  const removeSecondary = useEditor((s) => s.removeSecondary)
  const setSecondary = useEditor((s) => s.setSecondary)
  const setQualifier = useEditor((s) => s.setQualifier)
  const setWindow = useEditor((s) => s.setWindow)
  const setCorrection = useEditor((s) => s.setCorrection)
  const setActiveSecondary = useEditor((s) => s.setActiveSecondary)
  const setMatteView = useEditor((s) => s.setMatteView)
  const setPicking = useEditor((s) => s.setPicking)
  const t = useDict()

  const active: Secondary | undefined = secondaries[index]
  const full = secondaries.length >= MAX_SECONDARIES

  /** Every control here is a one-shot click, so each records its own step. */
  const once = (change: () => void) => {
    startEdit()
    change()
    endEdit()
  }

  return (
    <>
      <section className="group">
        <div className="group__head">
          <h2 className="group__title">{t.secondary.tabs.selective}</h2>
          <button
            className="group__action"
            onClick={addSecondary}
            disabled={full}
            title={full ? t.secondary.limit : t.secondary.addHint}
            aria-label={t.secondary.addHint}
          >
            <IconPlus size={14} />
          </button>
        </div>

        {secondaries.length > 0 && (
          <div className="chips">
            {secondaries.map((s, i) => (
              <button
                key={s.id}
                className={`chip${s.enabled ? '' : ' chip--muted'}`}
                aria-pressed={s.id === active?.id}
                onClick={() => setActiveSecondary(s.id)}
              >
                {fill(t.secondary.name, { index: i + 1 })}
              </button>
            ))}
          </div>
        )}
      </section>

      {!active ? (
        <p className="panel__empty">{t.secondary.empty}</p>
      ) : (
        <>
          <section className="group">
            <div className="group__head">
              <h2 className="group__title">{fill(t.secondary.name, { index: index + 1 })}</h2>
              <button
                className="group__action"
                onClick={() => removeSecondary(active.id)}
                aria-label={fill(t.secondary.remove, { index: index + 1 })}
              >
                <IconClose size={14} />
              </button>
            </div>

            <div className="chips">
              <button
                className="chip"
                aria-pressed={active.enabled}
                onClick={() => once(() => setSecondary(active.id, { enabled: !active.enabled }))}
              >
                {t.secondary.enabled}
              </button>
              <button
                className="chip"
                aria-pressed={active.invert}
                onClick={() => once(() => setSecondary(active.id, { invert: !active.invert }))}
              >
                {t.secondary.invert}
              </button>
              <button
                className="chip"
                aria-pressed={matteView}
                title={t.secondary.matteHint}
                onClick={() => setMatteView(!matteView)}
              >
                {t.secondary.matte}
              </button>
            </div>
          </section>

          <section className="group">
            <div className="group__head">
              <h2 className="group__title">{t.secondary.qualifier.title}</h2>
              <button
                className={`chip chip--compact${picking ? ' chip--armed' : ''}`}
                aria-pressed={picking}
                title={t.secondary.qualifier.pickHint}
                onClick={() => setPicking(!picking)}
              >
                <IconPipette size={13} /> {t.secondary.qualifier.pick}
              </button>
            </div>

            <div className="chips chips--single">
              <button
                className="chip"
                aria-pressed={active.qualifier.enabled}
                onClick={() =>
                  once(() =>
                    setQualifier(active.id, { enabled: !active.qualifier.enabled }),
                  )
                }
              >
                {t.secondary.qualifier.use}
              </button>
            </div>

            <h3 className="group__subtitle">{t.secondary.qualifier.hue}</h3>
            <Slider
              spec={DEGREES}
              label={t.secondary.qualifier.centre}
              value={Math.round(active.qualifier.hue.centre * 360)}
              defaultValue={0}
              onStart={startEdit}
              onEnd={endEdit}
              onChange={(v) =>
                setQualifier(active.id, { hue: { ...active.qualifier.hue, centre: v / 360 } })
              }
            />
            <Slider
              spec={HALF_TURN}
              label={t.secondary.qualifier.range}
              value={Math.round(active.qualifier.hue.range * 360)}
              defaultValue={180}
              onStart={startEdit}
              onEnd={endEdit}
              onChange={(v) =>
                setQualifier(active.id, { hue: { ...active.qualifier.hue, range: v / 360 } })
              }
            />
            <Slider
              spec={QUARTER_TURN}
              label={t.secondary.qualifier.softness}
              value={Math.round(active.qualifier.hue.softness * 360)}
              defaultValue={18}
              onStart={startEdit}
              onEnd={endEdit}
              onChange={(v) =>
                setQualifier(active.id, { hue: { ...active.qualifier.hue, softness: v / 360 } })
              }
            />

            {(['saturation', 'luminance'] as const).map((band) => (
              <div key={band}>
                <h3 className="group__subtitle">{t.secondary.qualifier[band]}</h3>
                <Slider
                  spec={PERCENT}
                  label={t.secondary.qualifier.low}
                  value={Math.round(active.qualifier[band].low * 100)}
                  defaultValue={0}
                  onStart={startEdit}
                  onEnd={endEdit}
                  onChange={(v) =>
                    setQualifier(active.id, {
                      [band]: { ...active.qualifier[band], low: v / 100 },
                    })
                  }
                />
                <Slider
                  spec={PERCENT}
                  label={t.secondary.qualifier.high}
                  value={Math.round(active.qualifier[band].high * 100)}
                  defaultValue={100}
                  onStart={startEdit}
                  onEnd={endEdit}
                  onChange={(v) =>
                    setQualifier(active.id, {
                      [band]: { ...active.qualifier[band], high: v / 100 },
                    })
                  }
                />
                <Slider
                  spec={HALF_PERCENT}
                  label={t.secondary.qualifier.softness}
                  value={Math.round(active.qualifier[band].softness * 100)}
                  defaultValue={8}
                  onStart={startEdit}
                  onEnd={endEdit}
                  onChange={(v) =>
                    setQualifier(active.id, {
                      [band]: { ...active.qualifier[band], softness: v / 100 },
                    })
                  }
                />
              </div>
            ))}
          </section>

          <section className="group">
            <h2 className="group__title">{t.secondary.window.title}</h2>
            <div className="segmented segmented--curve">
              {SHAPES.map((shape) => (
                <button
                  key={shape}
                  aria-pressed={active.window.shape === shape}
                  onClick={() => once(() => setWindow(active.id, { shape }))}
                >
                  {t.secondary.window[shape]}
                </button>
              ))}
            </div>

            {active.window.shape !== 'none' && (
              <>
                <Slider
                  spec={PERCENT}
                  label={t.secondary.window.feather}
                  value={Math.round(active.window.feather * 100)}
                  defaultValue={50}
                  onStart={startEdit}
                  onEnd={endEdit}
                  onChange={(v) => setWindow(active.id, { feather: v / 100 })}
                />
                <Slider
                  spec={ANGLE}
                  label={t.secondary.window.angle}
                  value={active.window.angle}
                  defaultValue={0}
                  onStart={startEdit}
                  onEnd={endEdit}
                  onChange={(v) => setWindow(active.id, { angle: v })}
                />
                <p className="curve__hint">{t.secondary.window.hint}</p>
              </>
            )}
          </section>

          <section className="group">
            <div className="group__head">
              <h2 className="group__title">{t.secondary.correction.title}</h2>
              <button
                className="group__action"
                onClick={() => once(() => setCorrection(active.id, { ...DEFAULT_CORRECTION }))}
                disabled={isNeutralCorrection(active.correction)}
                aria-label={t.panel.reset}
              >
                <IconReset size={14} />
              </button>
            </div>
            {CORRECTION_KEYS.map((key) => (
              <Slider
                key={key}
                spec={CORRECTION_SPECS[key]}
                label={t.secondary.correction[key]}
                value={active.correction[key]}
                defaultValue={DEFAULT_CORRECTION[key]}
                onStart={startEdit}
                onEnd={endEdit}
                onChange={(v) => setCorrection(active.id, { [key]: v })}
              />
            ))}
          </section>
        </>
      )}
    </>
  )
}
