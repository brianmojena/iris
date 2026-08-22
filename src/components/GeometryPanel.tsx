import { useEditor } from '../state/editorStore'
import {
  ASPECT_PRESETS,
  effectiveCrop,
  flipGeometry,
  isDefaultGeometry,
  outputSize,
  rotateQuarter,
} from '../types/geometry'
import { applyAspect, resolveAspect } from '../lib/crop'
import { Slider } from './Slider'
import { fill, useDict } from '../i18n'
import type { SliderSpec } from '../types/adjustments'
import {
  IconCheck,
  IconFlipH,
  IconFlipV,
  IconReset,
  IconRotateLeft,
  IconRotateRight,
} from './icons'

const ANGLE_SPEC: SliderSpec = {
  min: -45,
  max: 45,
  step: 0.1,
  origin: 0,
  decimals: 1,
  suffix: '°',
}

export function GeometryPanel({ onDone }: { onDone: () => void }) {
  const image = useEditor((s) => s.image)
  const geometry = useEditor((s) => s.edit.geometry)
  const startEdit = useEditor((s) => s.startEdit)
  const setGeometry = useEditor((s) => s.setGeometry)
  const endEdit = useEditor((s) => s.endEdit)
  const commit = useEditor((s) => s.commit)
  const resetGeometry = useEditor((s) => s.resetGeometry)
  const t = useDict()

  if (!image) {
    return (
      <aside className="panel">
        <p className="panel__empty">{t.panel.emptyCrop}</p>
      </aside>
    )
  }

  const { width: sourceWidth, height: sourceHeight } = image.bitmap
  const output = outputSize(geometry, sourceWidth, sourceHeight)
  const untouched = isDefaultGeometry(geometry, sourceWidth, sourceHeight)

  const chooseAspect = (ratio: number | null | 'original') => {
    const aspect = resolveAspect(ratio, geometry, sourceWidth, sourceHeight)
    const current = effectiveCrop(geometry, sourceWidth, sourceHeight)
    commit({
      geometry: {
        ...geometry,
        aspect,
        crop: aspect ? applyAspect(current, aspect, geometry, sourceWidth, sourceHeight) : current,
      },
    })
  }

  const activePreset = ASPECT_PRESETS.find((preset) => {
    const ratio = resolveAspect(preset.ratio, geometry, sourceWidth, sourceHeight)
    if (ratio === null) return geometry.aspect === null
    return geometry.aspect !== null && Math.abs(geometry.aspect - ratio) < 1e-3
  })

  return (
    <aside className="panel">
      <div className="panel__scroll">
        <section className="group">
          <h2 className="group__title">{t.crop.aspect}</h2>
          <div className="chips">
            {ASPECT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="chip"
                aria-pressed={activePreset?.id === preset.id}
                onClick={() => chooseAspect(preset.ratio)}
              >
                {preset.notation ?? t.crop[preset.id as 'free' | 'original']}
              </button>
            ))}
          </div>
        </section>

        <section className="group">
          <h2 className="group__title">{t.crop.orientation}</h2>
          <div className="panel__row">
            <button
              className="btn"
              onClick={() =>
                commit({ geometry: rotateQuarter(geometry, sourceWidth, sourceHeight, -1) })
              }
              title={t.crop.rotateLeft}
              aria-label={t.crop.rotateLeft}
            >
              <IconRotateLeft />
            </button>
            <button
              className="btn"
              onClick={() =>
                commit({ geometry: rotateQuarter(geometry, sourceWidth, sourceHeight, 1) })
              }
              title={t.crop.rotateRight}
              aria-label={t.crop.rotateRight}
            >
              <IconRotateRight />
            </button>
            <button
              className="btn"
              onClick={() => commit({ geometry: flipGeometry(geometry, 'horizontal') })}
              title={t.crop.flipH}
              aria-label={t.crop.flipH}
            >
              <IconFlipH />
            </button>
            <button
              className="btn"
              onClick={() => commit({ geometry: flipGeometry(geometry, 'vertical') })}
              title={t.crop.flipV}
              aria-label={t.crop.flipV}
            >
              <IconFlipV />
            </button>
          </div>

          <Slider
            spec={ANGLE_SPEC}
            label={t.crop.straighten}
            value={geometry.angle}
            defaultValue={0}
            onStart={startEdit}
            onChange={(angle) => setGeometry({ angle })}
            onEnd={endEdit}
          />
        </section>

        <p className="panel__note">
          {fill(t.crop.result, { width: output.width, height: output.height })}
        </p>
      </div>

      <div className="panel__footer">
        <button className="btn" onClick={resetGeometry} disabled={untouched}>
          <IconReset /> {t.panel.reset}
        </button>
        <button className="btn btn--primary" onClick={onDone}>
          <IconCheck /> {t.crop.done}
        </button>
      </div>
    </aside>
  )
}
