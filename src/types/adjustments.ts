/**
 * The full, serializable description of an edit. Every tool in Iris writes into
 * this object and nothing else — that is what makes editing non-destructive and
 * makes history, presets and (later) batch copy/paste trivial.
 */
export interface Adjustments {
  exposure: number // EV stops, -5..5
  contrast: number // -100..100
  highlights: number // -100..100
  shadows: number // -100..100
  whites: number // -100..100
  blacks: number // -100..100
  temperature: number // -100 (cool) .. 100 (warm)
  tint: number // -100 (green) .. 100 (magenta)
  vibrance: number // -100..100
  saturation: number // -100..100
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
}

export type AdjustmentKey = keyof Adjustments

/** Everything the Slider component needs, independent of what it controls. */
export interface SliderSpec {
  label: string
  min: number
  max: number
  step: number
  /** Slider fill grows outward from this value. */
  origin: number
  decimals?: number
  suffix?: string
}

export interface AdjustmentSpec extends SliderSpec {
  key: AdjustmentKey
  group: 'light' | 'color'
}

export const ADJUSTMENT_SPECS: AdjustmentSpec[] = [
  {
    key: 'exposure',
    label: 'Exposición',
    min: -5,
    max: 5,
    step: 0.01,
    origin: 0,
    decimals: 2,
    group: 'light',
  },
  { key: 'contrast', label: 'Contraste', min: -100, max: 100, step: 1, origin: 0, group: 'light' },
  { key: 'highlights', label: 'Altas luces', min: -100, max: 100, step: 1, origin: 0, group: 'light' },
  { key: 'shadows', label: 'Sombras', min: -100, max: 100, step: 1, origin: 0, group: 'light' },
  { key: 'whites', label: 'Blancos', min: -100, max: 100, step: 1, origin: 0, group: 'light' },
  { key: 'blacks', label: 'Negros', min: -100, max: 100, step: 1, origin: 0, group: 'light' },
  { key: 'temperature', label: 'Temperatura', min: -100, max: 100, step: 1, origin: 0, group: 'color' },
  { key: 'tint', label: 'Matiz', min: -100, max: 100, step: 1, origin: 0, group: 'color' },
  { key: 'vibrance', label: 'Intensidad', min: -100, max: 100, step: 1, origin: 0, group: 'color' },
  { key: 'saturation', label: 'Saturación', min: -100, max: 100, step: 1, origin: 0, group: 'color' },
]

export const ADJUSTMENT_GROUPS: { id: AdjustmentSpec['group']; label: string }[] = [
  { id: 'light', label: 'Luz' },
  { id: 'color', label: 'Color' },
]

export function isDefault(a: Adjustments): boolean {
  return (Object.keys(DEFAULT_ADJUSTMENTS) as AdjustmentKey[]).every(
    (k) => a[k] === DEFAULT_ADJUSTMENTS[k],
  )
}

/** Formats a value the way it is shown next to a slider. */
export function formatValue(spec: SliderSpec, value: number): string {
  const rounded = Number(value.toFixed(spec.decimals ?? 0))
  const text = rounded.toFixed(spec.decimals ?? 0)
  const signed = rounded > 0 ? `+${text}` : text
  return spec.suffix ? `${signed}${spec.suffix}` : signed
}
