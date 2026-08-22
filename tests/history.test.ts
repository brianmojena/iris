import { describe, expect, test } from 'vitest'
import { DEFAULT_ADJUSTMENTS } from '../src/types/adjustments'
import { defaultGeometry, flipGeometry, rotateQuarter } from '../src/types/geometry'
import { describeChange } from '../src/lib/describe'
import { stepText } from '../src/lib/stepText'
import type { Edit } from '../src/types/edit'
import { es } from '../src/i18n/es'
import { en } from '../src/i18n/en'

const base: Edit = {
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  geometry: defaultGeometry(1000, 500),
}

describe('etiquetas del historial', () => {
  test('un solo control se nombra con su valor', () => {
    const next: Edit = { ...base, adjustments: { ...base.adjustments, exposure: 0.6 } }
    const label = describeChange(base, next)
    expect(label).toEqual({ kind: 'adjustment', key: 'exposure', value: 0.6 })
    expect(stepText(label, es)).toBe('Exposición +0,60')
    expect(stepText(label, en)).toBe('Exposure +0.60')
  })

  test('varios controles a la vez se agrupan', () => {
    const next: Edit = {
      ...base,
      adjustments: { ...base.adjustments, exposure: 0.4, contrast: 20 },
    }
    expect(describeChange(base, next)).toEqual({ kind: 'adjustmentsMultiple' })
  })

  test('volver a los valores por defecto se nombra como tal', () => {
    const touched: Edit = { ...base, adjustments: { ...base.adjustments, exposure: 1, blur: 5 } }
    expect(describeChange(touched, base)).toEqual({ kind: 'adjustmentsReset' })
  })

  test('un giro se distingue de un volteo', () => {
    const turned: Edit = { ...base, geometry: rotateQuarter(base.geometry, 1000, 500, 1) }
    expect(describeChange(base, turned)).toEqual({ kind: 'rotate', clockwise: true })

    const flipped: Edit = { ...base, geometry: flipGeometry(base.geometry, 'horizontal') }
    expect(describeChange(base, flipped)).toEqual({ kind: 'flip', axis: 'horizontal' })
  })

  test('el enderezado guarda el ángulo, no la frase', () => {
    const tilted: Edit = { ...base, geometry: { ...base.geometry, angle: 7.2 } }
    const label = describeChange(base, tilted)
    expect(label).toEqual({ kind: 'straighten', angle: 7.2 })
    // El mismo paso guardado, leído en dos idiomas: esto es lo que hace que una
    // sesión grabada en español no siga hablando español al cambiar a inglés.
    expect(stepText(label, es)).toBe('Enderezado +7,2°')
    expect(stepText(label, en)).toBe('Straightened +7.2°')
  })

  test('los preajustes de fábrica se traducen; los propios conservan su nombre', () => {
    expect(stepText({ kind: 'preset', presetId: 'film' }, es)).toBe('Preajuste: Película')
    expect(stepText({ kind: 'preset', presetId: 'film' }, en)).toBe('Preset: Film')
    expect(stepText({ kind: 'preset', presetId: 'user-1', name: 'Mi look' }, es)).toBe(
      'Preajuste: Mi look',
    )
  })

  test('una sesión antigua con etiquetas de texto sigue leyéndose', () => {
    expect(stepText({ kind: 'text', text: 'Algo antiguo' }, en)).toBe('Algo antiguo')
  })
})

describe('diccionarios', () => {
  test('español e inglés tienen exactamente las mismas claves', () => {
    const keysOf = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) => keysOf(child, `${prefix}${key}.`))
        : [prefix]
    expect(keysOf(en).sort()).toEqual(keysOf(es).sort())
  })

  /**
   * Coinciden a propósito porque se escriben igual en los dos idiomas. La lista
   * es explícita para que añadir una cadena nueva obligue a decidir si su
   * coincidencia es intencionada o una traducción que falta.
   */
  const IDENTICAL_ON_PURPOSE = [
    'Color',
    'Original',
    'JPEG · PNG · WebP · HEIC',
    '{width} × {height} px',
    // Nombres de estándares de color: no se traducen en ningún idioma.
    'sRGB',
    'Display P3',
  ]

  test('no queda ninguna cadena sin traducir', () => {
    const flatten = (value: unknown): string[] =>
      value && typeof value === 'object' ? Object.values(value).flatMap(flatten) : [String(value)]
    const spanish = flatten(es)
    const english = flatten(en)
    const identical = spanish.filter((text, i) => text === english[i] && /[a-z]{4,}/i.test(text))
    const unexpected = identical.filter((text) => !IDENTICAL_ON_PURPOSE.includes(text))
    expect(unexpected).toEqual([])
  })
})
