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
  label: 'Enderezar',
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

  if (!image) {
    return (
      <aside className="panel">
        <p className="panel__empty">Abre una foto para recortarla.</p>
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
          <h2 className="group__title">Proporción</h2>
          <div className="chips">
            {ASPECT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="chip"
                aria-pressed={activePreset?.id === preset.id}
                onClick={() => chooseAspect(preset.ratio)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        <section className="group">
          <h2 className="group__title">Orientación</h2>
          <div className="panel__row">
            <button
              className="btn"
              onClick={() =>
                commit({ geometry: rotateQuarter(geometry, sourceWidth, sourceHeight, -1) })
              }
              title="Girar a la izquierda"
              aria-label="Girar a la izquierda"
            >
              <IconRotateLeft />
            </button>
            <button
              className="btn"
              onClick={() =>
                commit({ geometry: rotateQuarter(geometry, sourceWidth, sourceHeight, 1) })
              }
              title="Girar a la derecha"
              aria-label="Girar a la derecha"
            >
              <IconRotateRight />
            </button>
            <button
              className="btn"
              onClick={() => commit({ geometry: flipGeometry(geometry, 'horizontal') })}
              title="Voltear horizontalmente"
              aria-label="Voltear horizontalmente"
            >
              <IconFlipH />
            </button>
            <button
              className="btn"
              onClick={() => commit({ geometry: flipGeometry(geometry, 'vertical') })}
              title="Voltear verticalmente"
              aria-label="Voltear verticalmente"
            >
              <IconFlipV />
            </button>
          </div>

          <Slider
            spec={ANGLE_SPEC}
            value={geometry.angle}
            defaultValue={0}
            onStart={startEdit}
            onChange={(angle) => setGeometry({ angle })}
            onEnd={endEdit}
          />
        </section>

        <p className="panel__note">
          Resultado: {output.width} × {output.height} px
        </p>
      </div>

      <div className="panel__footer">
        <button className="btn" onClick={resetGeometry} disabled={untouched}>
          <IconReset /> Restablecer
        </button>
        <button className="btn btn--primary" onClick={onDone}>
          <IconCheck /> Listo
        </button>
      </div>
    </aside>
  )
}
