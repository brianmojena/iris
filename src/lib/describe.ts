import {
  ADJUSTMENT_SPECS,
  formatValue,
  isDefault,
  type AdjustmentKey,
} from '../types/adjustments'
import { ASPECT_PRESETS, type Geometry } from '../types/geometry'
import { changedAdjustments, type Edit } from '../types/edit'

export const INITIAL_LABEL = 'Original'

function specFor(key: AdjustmentKey) {
  return ADJUSTMENT_SPECS.find((spec) => spec.key === key)
}

/**
 * Names a geometry change the way the user would describe it, picking the most
 * significant difference when several moved at once — a quarter turn also drags
 * the crop with it, but "Giro a la derecha" is what actually happened.
 */
function describeGeometry(from: Geometry, to: Geometry): string {
  if (from.rotation !== to.rotation) {
    return (from.rotation + 90) % 360 === to.rotation ? 'Giro a la derecha' : 'Giro a la izquierda'
  }
  if (from.flipH !== to.flipH) return 'Volteo horizontal'
  if (from.flipV !== to.flipV) return 'Volteo vertical'
  if (from.angle !== to.angle) {
    const value = to.angle > 0 ? `+${to.angle.toFixed(1)}` : to.angle.toFixed(1)
    return `Enderezado ${value}°`
  }
  if (from.aspect !== to.aspect) {
    if (to.aspect === null) return 'Proporción libre'
    const preset = ASPECT_PRESETS.find(
      (p) => typeof p.ratio === 'number' && Math.abs(p.ratio - to.aspect!) < 1e-3,
    )
    return `Proporción ${preset?.label ?? 'personalizada'}`
  }
  return 'Recorte'
}

/**
 * Turns a step of history into a line the user can recognise in the panel.
 *
 * Derived from the diff rather than supplied at each call site: a label written
 * by hand is one that eventually disagrees with what the step actually did.
 * Callers that know better — applying a named preset — can still override it.
 */
export function describeChange(from: Edit, to: Edit): string {
  const keys = changedAdjustments(from.adjustments, to.adjustments)

  if (keys.length === 0) return describeGeometry(from.geometry, to.geometry)

  if (keys.length === 1) {
    const spec = specFor(keys[0])
    if (spec) return `${spec.label} ${formatValue(spec, to.adjustments[keys[0]])}`
  }

  return isDefault(to.adjustments) ? 'Ajustes restablecidos' : 'Varios ajustes'
}
