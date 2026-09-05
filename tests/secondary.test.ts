import { describe, expect, test } from 'vitest'
import { defaultGrade } from '../src/types/grade'
import {
  defaultSecondary,
  qualifierFromColour,
  secondaryUniforms,
  type Correction,
  type PowerWindow,
  type Qualifier,
  type Secondary,
} from '../src/types/secondary'
import { colorQuadrants, flatGray, QUADRANTS } from './fixtures'
import { changedBounds, difference, edit, pixelAtFraction, render } from './render'

/** sRGB weights; the tests read their pixels back in sRGB. */
const LUMA: [number, number, number] = [0.2126, 0.7152, 0.0722]

function secondary(patch: {
  qualifier?: Partial<Qualifier>
  window?: Partial<PowerWindow>
  correction?: Partial<Correction>
  invert?: boolean
  enabled?: boolean
}): Secondary {
  const base = defaultSecondary('test')
  return {
    ...base,
    enabled: patch.enabled ?? base.enabled,
    invert: patch.invert ?? base.invert,
    qualifier: { ...base.qualifier, ...patch.qualifier },
    window: { ...base.window, ...patch.window },
    correction: { ...base.correction, ...patch.correction },
  }
}

function withSecondaries(list: Secondary[]) {
  return { ...defaultGrade(), secondaries: list }
}

/** A key that covers everything, so only the window decides. */
const NO_QUALIFIER: Partial<Qualifier> = { enabled: false }

/** Something big enough to see wherever the matte lets it through. */
const OBVIOUS: Partial<Correction> = { exposure: 1.2, saturation: -100 }

describe('empaquetado para el shader', () => {
  test('cada secundario ocupa su propia ranura, en el orden de la lista', () => {
    const first = { ...defaultSecondary('a'), correction: { ...defaultSecondary('a').correction, exposure: 1 } }
    const second = defaultSecondary('b')
    const packed = secondaryUniforms([first, second])

    expect(packed.count).toBe(2)
    // El segundo no hace nada, pero sigue estando en la ranura 1: la vista de
    // máscara se mira antes de tocar la corrección, y filtrar los inertes
    // dejaría fuera justo al que se está mirando.
    expect(packed.correctionB[2]).toBe(1)
    expect(packed.correctionB[4 + 2]).toBe(0)
  })

  test('el ángulo viaja ya resuelto en seno y coseno', () => {
    const packed = secondaryUniforms([secondary({ window: { shape: 'ellipse', angle: 90 } })])
    expect(packed.windowB[0]).toBeCloseTo(0, 5)
    expect(packed.windowB[1]).toBeCloseTo(1, 5)
  })

  test('nunca se empaquetan más de las que el shader tiene sitio', () => {
    const many = Array.from({ length: 9 }, (_, i) => defaultSecondary(`s${i}`))
    expect(secondaryUniforms(many).count).toBe(4)
  })
})

describe('cuentagotas', () => {
  test('centra el tono en el color tomado y abre las bandas alrededor', () => {
    // Un azul de cielo: tono en torno a 0,58 de vuelta.
    const key = qualifierFromColour([60, 120, 200], LUMA)
    expect(key.enabled).toBe(true)
    expect(key.hue.centre).toBeCloseTo(0.58, 1)
    expect(key.hue.range).toBeGreaterThan(0)
    expect(key.saturation.low).toBeLessThan(key.saturation.high)
    expect(key.luminance.low).toBeLessThan(key.luminance.high)
  })

  test('un gris no tiene tono, y la banda de tono no puede inventárselo', () => {
    const key = qualifierFromColour([128, 128, 128], LUMA)
    expect(key.saturation.low).toBe(0)
    expect(key.saturation.high).toBeGreaterThan(0)
  })
})

describe('secundarios en el pipeline', () => {
  test('sin corrección no tocan un solo píxel', async () => {
    const bitmap = await colorQuadrants()
    const base = await render(bitmap, edit(bitmap))
    const withOne = await render(
      bitmap,
      edit(bitmap, {}, {}, withSecondaries([secondary({})])),
    )
    expect(changedBounds(base, withOne).count).toBe(0)
  })

  test('uno desactivado tampoco, por muy dialada que esté la corrección', async () => {
    const bitmap = await colorQuadrants()
    const base = await render(bitmap, edit(bitmap))
    const off = await render(
      bitmap,
      edit(bitmap, {}, {}, withSecondaries([secondary({ enabled: false, correction: OBVIOUS })])),
    )
    expect(changedBounds(base, off).count).toBe(0)
  })

  test('la selección por tono alcanza un cuadrante y deja los otros tres', async () => {
    const bitmap = await colorQuadrants()
    const base = await render(bitmap, edit(bitmap))
    // El rojo de arriba a la izquierda está en el tono 0.
    const keyed = withSecondaries([
      secondary({
        qualifier: { hue: { centre: 0, range: 0.05, softness: 0.03 } },
        correction: OBVIOUS,
      }),
    ])
    const result = await render(bitmap, edit(bitmap, {}, {}, keyed))

    expect(difference(base, result, base.width * 0.25, base.height * 0.25)).toBeGreaterThan(40)
    for (const [fx, fy] of [
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      expect(difference(base, result, base.width * fx, base.height * fy)).toBeLessThan(6)
    }
  })

  test('invertir cambia exactamente los píxeles que antes no cambiaban', async () => {
    const bitmap = await colorQuadrants()
    const base = await render(bitmap, edit(bitmap))
    const key = { hue: { centre: 0, range: 0.05, softness: 0.03 } }
    const straight = await render(
      bitmap,
      edit(bitmap, {}, {}, withSecondaries([secondary({ qualifier: key, correction: OBVIOUS })])),
    )
    const inverted = await render(
      bitmap,
      edit(
        bitmap,
        {},
        {},
        withSecondaries([secondary({ qualifier: key, invert: true, correction: OBVIOUS })]),
      ),
    )

    expect(difference(base, straight, base.width * 0.25, base.height * 0.25)).toBeGreaterThan(40)
    expect(difference(base, inverted, base.width * 0.25, base.height * 0.25)).toBeLessThan(6)
    expect(difference(base, inverted, base.width * 0.75, base.height * 0.75)).toBeGreaterThan(40)
  })

  test('la banda de luminancia mide luz, no el canal más alto', async () => {
    // Un azul saturado y el blanco tienen el mismo «valor» en HSV, y por esa
    // medida «selecciona lo claro» seleccionaría también el cielo. Por
    // luminancia el azul es oscuro, que es como lo ve cualquiera.
    const bitmap = await colorQuadrants()
    const base = await render(bitmap, edit(bitmap))
    const bright = withSecondaries([
      secondary({
        qualifier: { hue: { centre: 0, range: 0.5, softness: 0.01 }, luminance: { low: 0.5, high: 1, softness: 0.02 } },
        correction: OBVIOUS,
      }),
    ])
    const result = await render(bitmap, edit(bitmap, {}, {}, bright))

    // El amarillo de abajo a la derecha es el cuadrante realmente luminoso.
    const yellow = 0.2126 * QUADRANTS.bottomRight[0] + 0.7152 * QUADRANTS.bottomRight[1] + 0.0722 * QUADRANTS.bottomRight[2]
    const blue = 0.2126 * QUADRANTS.bottomLeft[0] + 0.7152 * QUADRANTS.bottomLeft[1] + 0.0722 * QUADRANTS.bottomLeft[2]
    expect(yellow).toBeGreaterThan(128)
    expect(blue).toBeLessThan(128)

    expect(difference(base, result, base.width * 0.75, base.height * 0.75)).toBeGreaterThan(40)
    expect(difference(base, result, base.width * 0.25, base.height * 0.75)).toBeLessThan(6)
  })

  test('la ventana encierra la corrección y el resto queda intacto', async () => {
    const bitmap = await flatGray(140, 192, 192)
    const base = await render(bitmap, edit(bitmap))
    const windowed = withSecondaries([
      secondary({
        qualifier: NO_QUALIFIER,
        window: { shape: 'ellipse', halfWidth: 0.2, halfHeight: 0.2, feather: 0.1 },
        correction: OBVIOUS,
      }),
    ])
    const result = await render(bitmap, edit(bitmap, {}, {}, windowed))

    expect(difference(base, result, base.width / 2, base.height / 2)).toBeGreaterThan(40)
    expect(difference(base, result, 2, 2)).toBeLessThan(6)
    // Y no se come la foto entera: la mitad del ancho es el diámetro máximo.
    const bounds = changedBounds(base, result)
    expect(bounds.right - bounds.left).toBeLessThan(base.width * 0.55)
  })

  test('una ventana circular sale circular en una foto que no es cuadrada', async () => {
    // Las dos semimedidas se guardan en fracciones de la *altura*. Si el shader
    // no lo corrigiera, este círculo saldría el doble de ancho que de alto.
    const bitmap = await flatGray(140, 256, 128)
    const base = await render(bitmap, edit(bitmap))
    const circle = withSecondaries([
      secondary({
        qualifier: NO_QUALIFIER,
        window: { shape: 'ellipse', halfWidth: 0.3, halfHeight: 0.3, feather: 0.02 },
        correction: OBVIOUS,
      }),
    ])
    const bounds = changedBounds(base, await render(bitmap, edit(bitmap, {}, {}, circle)))

    const width = bounds.right - bounds.left
    const height = bounds.bottom - bounds.top
    expect(width).toBeGreaterThan(10)
    expect(Math.abs(width - height)).toBeLessThan(width * 0.12)
  })

  test('girar una ventana alargada la gira de verdad', async () => {
    const bitmap = await flatGray(140, 192, 192)
    const base = await render(bitmap, edit(bitmap))
    const shape: Partial<PowerWindow> = {
      shape: 'rectangle',
      halfWidth: 0.35,
      halfHeight: 0.08,
      feather: 0.02,
    }
    const flat = await render(
      bitmap,
      edit(bitmap, {}, {}, withSecondaries([
        secondary({ qualifier: NO_QUALIFIER, window: shape, correction: OBVIOUS }),
      ])),
    )
    const upright = await render(
      bitmap,
      edit(bitmap, {}, {}, withSecondaries([
        secondary({ qualifier: NO_QUALIFIER, window: { ...shape, angle: 90 }, correction: OBVIOUS }),
      ])),
    )

    const wide = changedBounds(base, flat)
    const tall = changedBounds(base, upright)
    expect(wide.right - wide.left).toBeGreaterThan(wide.bottom - wide.top)
    expect(tall.bottom - tall.top).toBeGreaterThan(tall.right - tall.left)
    // Girar no cambia cuánta foto queda dentro.
    expect(Math.abs(wide.count - tall.count)).toBeLessThan(wide.count * 0.15)
  })

  test('ventana y color se multiplican: hace falta cumplir las dos', async () => {
    const bitmap = await colorQuadrants(128, 128)
    const base = await render(bitmap, edit(bitmap))
    // Rojo, pero solo en la mitad izquierda.
    const both = withSecondaries([
      secondary({
        qualifier: { hue: { centre: 0, range: 0.05, softness: 0.03 } },
        window: { shape: 'rectangle', cx: 0.25, cy: 0.5, halfWidth: 0.25, halfHeight: 1, feather: 0.02 },
        correction: OBVIOUS,
      }),
    ])
    const result = await render(bitmap, edit(bitmap, {}, {}, both))

    // Rojo y dentro de la ventana.
    expect(difference(base, result, base.width * 0.2, base.height * 0.25)).toBeGreaterThan(40)
    // Rojo pero fuera de la ventana: el cuadrante rojo no llega hasta ahí, así
    // que se comprueba con el verde, que sí está fuera y no es rojo.
    expect(difference(base, result, base.width * 0.8, base.height * 0.25)).toBeLessThan(6)
    // Dentro de la ventana pero azul.
    expect(difference(base, result, base.width * 0.2, base.height * 0.8)).toBeLessThan(6)
  })

  test('la vista de máscara dibuja la máscara y no la foto', async () => {
    const bitmap = await colorQuadrants()
    const keyed = withSecondaries([
      secondary({ qualifier: { hue: { centre: 0, range: 0.05, softness: 0.03 } } }),
    ])
    const matte = await render(bitmap, edit(bitmap, {}, {}, keyed), 'srgb', { matteView: 0 })

    // Blanco donde el rojo, negro en el resto, y nada de color en ningún sitio.
    const inside = pixelAtFraction(matte, 0.25, 0.25)
    const outside = pixelAtFraction(matte, 0.75, 0.75)
    expect(inside[0]).toBeGreaterThan(230)
    expect(outside[0]).toBeLessThan(25)
    expect(Math.abs(inside[0] - inside[1])).toBeLessThan(3)
    expect(Math.abs(outside[0] - outside[2])).toBeLessThan(3)
  })

  test('se ve la máscara de un secundario cuya corrección aún está a cero', async () => {
    // Es el caso normal: primero se ajusta la selección, y solo después se
    // corrige. Un empaquetado que descartara los inertes no mostraría nada.
    const bitmap = await colorQuadrants()
    const keyed = withSecondaries([
      secondary({
        qualifier: { hue: { centre: 0, range: 0.05, softness: 0.03 } },
        correction: {},
      }),
    ])
    const matte = await render(bitmap, edit(bitmap, {}, {}, keyed), 'srgb', { matteView: 0 })
    expect(pixelAtFraction(matte, 0.25, 0.25)[0]).toBeGreaterThan(230)
    expect(pixelAtFraction(matte, 0.75, 0.75)[0]).toBeLessThan(25)
  })

  test('cuatro secundarios a la vez, cada uno en lo suyo', async () => {
    const bitmap = await colorQuadrants()
    const base = await render(bitmap, edit(bitmap))
    const hues = [0, 0.36, 0.62, 0.14]
    const list = hues.map((centre, i) => ({
      ...secondary({
        qualifier: { hue: { centre, range: 0.05, softness: 0.02 } },
        correction: { exposure: 0.8 },
      }),
      id: `s${i}`,
    }))
    const result = await render(bitmap, edit(bitmap, {}, {}, withSecondaries(list)))

    for (const [fx, fy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      expect(difference(base, result, base.width * fx, base.height * fy)).toBeGreaterThan(20)
    }
  })
})
