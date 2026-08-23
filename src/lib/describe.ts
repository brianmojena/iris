import { isDefault, type AdjustmentKey } from '../types/adjustments'
import { ASPECT_PRESETS, type Geometry } from '../types/geometry'
import {
  isNeutralGrade,
  isNeutralWheel,
  sameGrade,
  WHEEL_KEYS,
  type CurveChannel,
  type Grade,
  type WheelKey,
} from '../types/grade'
import { changedChannels } from './curve'
import { changedAdjustments, type Edit } from '../types/edit'

/**
 * What a history step did, described rather than worded.
 *
 * Steps are written to IndexedDB, so storing them as finished sentences would
 * freeze a session into whatever language it was recorded in — switch to English
 * and your own history would still be talking Spanish. The panel turns these
 * into text at the moment it draws them.
 */
export type StepLabel =
  | { kind: 'initial' }
  | { kind: 'adjustment'; key: AdjustmentKey; value: number }
  | { kind: 'adjustmentsReset' }
  | { kind: 'adjustmentsMultiple' }
  | { kind: 'preset'; presetId: string; name?: string }
  | { kind: 'wheel'; wheel: WheelKey }
  | { kind: 'curve'; channel: CurveChannel }
  | { kind: 'gradeReset' }
  | { kind: 'rotate'; clockwise: boolean }
  | { kind: 'flip'; axis: 'horizontal' | 'vertical' }
  | { kind: 'straighten'; angle: number }
  | { kind: 'aspect'; presetId: string | null }
  | { kind: 'crop' }
  | { kind: 'geometryReset' }
  /** Anything restored from a session recorded before labels were structured. */
  | { kind: 'text'; text: string }

export const INITIAL_LABEL: StepLabel = { kind: 'initial' }

function describeGrade(from: Grade, to: Grade): StepLabel {
  if (isNeutralGrade(to) && !isNeutralGrade(from)) return { kind: 'gradeReset' }

  const wheel = WHEEL_KEYS.find(
    (key) =>
      from.wheels[key].x !== to.wheels[key].x ||
      from.wheels[key].y !== to.wheels[key].y ||
      from.wheels[key].master !== to.wheels[key].master,
  )
  if (wheel) return { kind: 'wheel', wheel }

  const channel = changedChannels(from.curves, to.curves)[0]
  if (channel) return { kind: 'curve', channel }

  // Nothing recognisable changed; the wheels are the safer thing to name.
  const touched = WHEEL_KEYS.find((key) => !isNeutralWheel(to.wheels[key]))
  return touched ? { kind: 'wheel', wheel: touched } : { kind: 'curve', channel: 'rgb' }
}

function describeGeometry(from: Geometry, to: Geometry): StepLabel {
  if (from.rotation !== to.rotation) {
    return { kind: 'rotate', clockwise: (from.rotation + 90) % 360 === to.rotation }
  }
  if (from.flipH !== to.flipH) return { kind: 'flip', axis: 'horizontal' }
  if (from.flipV !== to.flipV) return { kind: 'flip', axis: 'vertical' }
  if (from.angle !== to.angle) return { kind: 'straighten', angle: to.angle }
  if (from.aspect !== to.aspect) {
    if (to.aspect === null) return { kind: 'aspect', presetId: 'free' }
    const preset = ASPECT_PRESETS.find(
      (p) => typeof p.ratio === 'number' && Math.abs(p.ratio - to.aspect!) < 1e-3,
    )
    return { kind: 'aspect', presetId: preset?.id ?? null }
  }
  return { kind: 'crop' }
}

/**
 * Derived from the diff rather than supplied at each call site: a label written
 * by hand is one that eventually disagrees with what the step actually did.
 * Callers that know better — applying a named preset — can still override it.
 */
export function describeChange(from: Edit, to: Edit): StepLabel {
  const keys = changedAdjustments(from.adjustments, to.adjustments)

  if (keys.length === 0) {
    return sameGrade(from.grade, to.grade)
      ? describeGeometry(from.geometry, to.geometry)
      : describeGrade(from.grade, to.grade)
  }
  if (keys.length === 1) return { kind: 'adjustment', key: keys[0], value: to.adjustments[keys[0]] }

  return isDefault(to.adjustments) ? { kind: 'adjustmentsReset' } : { kind: 'adjustmentsMultiple' }
}
