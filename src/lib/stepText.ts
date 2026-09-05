import { ADJUSTMENT_SPECS, formatValue } from '../types/adjustments'
import { ASPECT_PRESETS } from '../types/geometry'
import type { Dictionary } from '../i18n/es'
import { fill, formatNumber } from '../i18n'
import type { StepLabel } from './describe'

/** Renders a stored history step into the language currently on screen. */
export function stepText(label: StepLabel, t: Dictionary): string {
  switch (label.kind) {
    case 'initial':
      return t.history.initial
    case 'text':
      return label.text
    case 'adjustment': {
      const spec = ADJUSTMENT_SPECS.find((s) => s.key === label.key)
      const name = t.adjustments[label.key]
      return spec ? `${name} ${formatValue(spec, label.value, t.code)}` : name
    }
    case 'adjustmentsReset':
      return t.history.adjustmentsReset
    case 'adjustmentsMultiple':
      return t.history.adjustmentsMultiple
    case 'preset': {
      const builtIn = t.presets.builtIn[label.presetId as keyof typeof t.presets.builtIn]
      return fill(t.history.preset, { name: builtIn ?? label.name ?? '' })
    }
    case 'wheel':
      return fill(t.history.wheel, { name: t.grade.wheels[label.wheel] })
    case 'curve':
      return fill(t.history.curve, { name: t.grade.channels[label.channel] })
    case 'gradeReset':
      return t.history.gradeReset
    case 'secondaryAdded':
      return fill(t.history.secondaryAdded, { index: label.index + 1 })
    case 'secondaryRemoved':
      return fill(t.history.secondaryRemoved, { index: label.index + 1 })
    case 'secondary':
      return fill(t.history.secondary, { index: label.index + 1 })
    case 'rotate':
      return label.clockwise ? t.history.rotateRight : t.history.rotateLeft
    case 'flip':
      return label.axis === 'horizontal' ? t.history.flipH : t.history.flipV
    case 'straighten':
      return fill(t.history.straighten, { angle: formatNumber(label.angle, 1, t.code) })
    case 'aspect': {
      if (label.presetId === 'free') return t.history.aspectFree
      const preset = ASPECT_PRESETS.find((p) => p.id === label.presetId)
      if (!preset) return t.history.aspectCustom
      const name = preset.notation ?? t.crop[preset.id as 'free' | 'original']
      return fill(t.history.aspect, { label: name })
    }
    case 'crop':
      return t.history.crop
    case 'geometryReset':
      return t.history.geometryReset
  }
}
