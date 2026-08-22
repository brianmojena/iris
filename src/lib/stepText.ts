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
      return spec ? `${name} ${formatValue(spec, label.value)}` : name
    }
    case 'adjustmentsReset':
      return t.history.adjustmentsReset
    case 'adjustmentsMultiple':
      return t.history.adjustmentsMultiple
    case 'preset': {
      const builtIn = t.presets.builtIn[label.presetId as keyof typeof t.presets.builtIn]
      return fill(t.history.preset, { name: builtIn ?? label.name ?? '' })
    }
    case 'rotate':
      return label.clockwise ? t.history.rotateRight : t.history.rotateLeft
    case 'flip':
      return label.axis === 'horizontal' ? t.history.flipH : t.history.flipV
    case 'straighten':
      return fill(t.history.straighten, { angle: formatNumber(label.angle, 1) })
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
