import { describe, expect, test } from 'vitest'
import { curveTexture, evaluate, sampleCurve } from '../src/lib/curve'
import { defaultGrade, neutralWheel, wheelBalance, wheelUniforms } from '../src/types/grade'
import type { Curve, Curves, Grade, Wheel } from '../src/types/grade'
import { flatGray, grayRamp } from './fixtures'
import { edit, luminance, pixelAtFraction, render, stats } from './render'

function curves(patch: Partial<Curves>): Partial<Grade> {
  return { curves: { ...defaultGrade().curves, ...patch } }
}

function wheel(key: keyof Grade['wheels'], value: Partial<Wheel>): Partial<Grade> {
  return {
    wheels: { ...defaultGrade().wheels, [key]: { ...neutralWheel(), ...value } },
  }
}

/** The pair that makes a curve steep in the middle and flat at both ends. */
const S_CURVE: Curve = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.15 },
  { x: 0.75, y: 0.85 },
  { x: 1, y: 1 },
]

describe('interpolación de curvas', () => {
  test('la curva neutra es la identidad', () => {
    const lut = sampleCurve([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ])
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(evaluate(lut, x)).toBeCloseTo(x, 3)
    }
  })

  test('no se pasa de largo: un punto bajo no arrastra la curva por debajo de él', () => {
    // Una spline natural sobrepasa aquí y devuelve valores negativos justo antes
    // del punto bajo, que en la foto sería una banda oscura que nadie ha pedido.
    const lut = sampleCurve([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.05 },
      { x: 1, y: 1 },
    ])
    for (let i = 0; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0)
      expect(lut[i]).toBeLessThanOrEqual(1)
    }
    // Y sigue subiendo en todo el recorrido, que es lo que garantiza el método.
    for (let i = 1; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1e-6)
    }
  })

  test('fuera de los extremos la curva es plana, no extrapolada', () => {
    const lut = sampleCurve([
      { x: 0.3, y: 0.4 },
      { x: 0.7, y: 0.6 },
    ])
    expect(evaluate(lut, 0)).toBeCloseTo(0.4, 3)
    expect(evaluate(lut, 0.1)).toBeCloseTo(0.4, 3)
    expect(evaluate(lut, 1)).toBeCloseTo(0.6, 3)
  })

  test('la tabla compone canal y maestra en ese orden', () => {
    // Dos curvas distintas a propósito: con la misma dos veces, componerlas al
    // revés da el mismo número y la prueba no probaría nada.
    const halve: Curve = [
      { x: 0, y: 0 },
      { x: 1, y: 0.5 },
    ]
    const upperHalf: Curve = [
      { x: 0, y: 0.5 },
      { x: 1, y: 1 },
    ]
    const table = curveTexture({ ...defaultGrade().curves, r: halve, rgb: upperHalf })

    // Rojo: primero la del canal (1 → 0,5) y después la maestra (0,5 → 0,75).
    // Al revés saldría 0,5, que es justo lo que este número descarta.
    expect(table[255 * 4]).toBeCloseTo(191, -1)
    // Verde no tiene curva propia, así que solo pasa por la maestra.
    expect(table[255 * 4 + 1]).toBeCloseTo(255, -1)
  })
})

describe('matemática de las ruedas', () => {
  test('el disco cambia el equilibrio y no el brillo', () => {
    const balance = wheelBalance({ x: 1, y: 0, master: 0 })
    // Suma cero: lo que sube un canal lo bajan los otros.
    expect(balance[0] + balance[1] + balance[2]).toBeCloseTo(0, 6)
    // A la derecha del disco está el rojo.
    expect(balance[0]).toBeGreaterThan(0)
    expect(balance[1]).toBeLessThan(0)
    expect(balance[2]).toBeLessThan(0)
  })

  test('el borde del disco es el límite; más allá no empuja más', () => {
    const rim = wheelBalance({ x: 3, y: 0, master: 0 })
    const edgeOn = wheelBalance({ x: 1, y: 0, master: 0 })
    expect(rim[0]).toBeCloseTo(edgeOn[0], 6)
  })

  test('sin tocar nada las ruedas son la identidad', () => {
    const u = wheelUniforms(defaultGrade().wheels)
    expect(u.offset).toEqual([0, 0, 0])
    expect(u.lift).toEqual([0, 0, 0])
    expect(u.gamma).toEqual([1, 1, 1])
    expect(u.gain).toEqual([1, 1, 1])
  })

  test('ganancia y gamma se miden en pasos, así que suben y bajan por igual', () => {
    const up = wheelUniforms({ ...defaultGrade().wheels, gain: { x: 0, y: 0, master: 1 } })
    const down = wheelUniforms({ ...defaultGrade().wheels, gain: { x: 0, y: 0, master: -1 } })
    expect(up.gain[0] * down.gain[0]).toBeCloseTo(1, 6)
  })
})

describe('grade en el pipeline', () => {
  test('un grade neutro no toca la imagen', async () => {
    const bitmap = await grayRamp()
    const plain = await render(bitmap, edit(bitmap))
    const graded = await render(bitmap, edit(bitmap, {}, {}, defaultGrade()))
    for (const fx of [0.2, 0.5, 0.8]) {
      expect(luminance(pixelAtFraction(graded, fx, 0.5))).toBeCloseTo(
        luminance(pixelAtFraction(plain, fx, 0.5)),
        -1,
      )
    }
  })

  test('una curva en S separa las sombras de las luces', async () => {
    const bitmap = await grayRamp()
    const before = await render(bitmap, edit(bitmap))
    const after = await render(bitmap, edit(bitmap, {}, {}, curves({ rgb: S_CURVE })))

    const darkBefore = luminance(pixelAtFraction(before, 0.2, 0.5))
    const darkAfter = luminance(pixelAtFraction(after, 0.2, 0.5))
    const lightBefore = luminance(pixelAtFraction(before, 0.8, 0.5))
    const lightAfter = luminance(pixelAtFraction(after, 0.8, 0.5))

    expect(darkAfter).toBeLessThan(darkBefore - 4)
    expect(lightAfter).toBeGreaterThan(lightBefore + 4)
  })

  test('una curva de un solo canal mueve ese canal y deja los otros', async () => {
    const bitmap = await flatGray(128)
    const lift: Curve = [
      { x: 0, y: 0.2 },
      { x: 1, y: 1 },
    ]
    const before = pixelAtFraction(await render(bitmap, edit(bitmap)), 0.5, 0.5)
    const after = pixelAtFraction(
      await render(bitmap, edit(bitmap, {}, {}, curves({ r: lift }))),
      0.5,
      0.5,
    )
    expect(after[0]).toBeGreaterThan(before[0] + 10)
    expect(after[1]).toBeCloseTo(before[1], -1)
    expect(after[2]).toBeCloseTo(before[2], -1)
  })

  test('la rueda de sombras pivota en el blanco: cuanto más claro, menos tiñe', async () => {
    const bitmap = await grayRamp()
    // Hacia el azul: 240° en el disco, que es abajo a la izquierda.
    const blue = wheel('lift', { x: Math.cos((240 * Math.PI) / 180), y: Math.sin((240 * Math.PI) / 180) })
    const before = await render(bitmap, edit(bitmap))
    const after = await render(bitmap, edit(bitmap, {}, {}, blue))

    const shiftAt = (fx: number) =>
      pixelAtFraction(after, fx, 0.5)[2] - pixelAtFraction(before, fx, 0.5)[2]

    // Medido en dos puntos que no llegan a saturar el azul: un desplazamiento
    // plano daría lo mismo en los dos, y el recorte contra 255 lo disimularía si
    // se midiera cerca del blanco.
    const dark = shiftAt(0.15)
    const middle = shiftAt(0.55)
    expect(dark).toBeGreaterThan(10)
    expect(middle).toBeLessThan(dark * 0.75)
    expect(middle).toBeGreaterThan(0)
  })

  test('la rueda de luces pivota en el negro', async () => {
    const bitmap = await grayRamp()
    const gain = wheel('gain', { master: 0.5 })
    const before = await render(bitmap, edit(bitmap))
    const after = await render(bitmap, edit(bitmap, {}, {}, gain))

    const darkShift =
      luminance(pixelAtFraction(after, 0.05, 0.5)) - luminance(pixelAtFraction(before, 0.05, 0.5))
    const lightShift =
      luminance(pixelAtFraction(after, 0.7, 0.5)) - luminance(pixelAtFraction(before, 0.7, 0.5))

    expect(lightShift).toBeGreaterThan(10)
    expect(darkShift).toBeLessThan(lightShift / 3)
  })

  test('la rueda de medios deja los dos extremos donde estaban', async () => {
    const bitmap = await grayRamp()
    const gamma = wheel('gamma', { master: 0.6 })
    const before = await render(bitmap, edit(bitmap))
    const after = await render(bitmap, edit(bitmap, {}, {}, gamma))

    expect(luminance(pixelAtFraction(after, 0.5, 0.5))).toBeGreaterThan(
      luminance(pixelAtFraction(before, 0.5, 0.5)) + 10,
    )
    // El blanco es el punto fijo de una potencia; el negro también.
    expect(luminance(pixelAtFraction(after, 0.99, 0.5))).toBeCloseTo(
      luminance(pixelAtFraction(before, 0.99, 0.5)),
      -1,
    )
  })

  test('la base desplaza todo el rango por igual', async () => {
    const bitmap = await grayRamp()
    const offset = wheel('offset', { master: 0.5 })
    const before = await render(bitmap, edit(bitmap))
    const after = await render(bitmap, edit(bitmap, {}, {}, offset))

    const low =
      luminance(pixelAtFraction(after, 0.3, 0.5)) - luminance(pixelAtFraction(before, 0.3, 0.5))
    const high =
      luminance(pixelAtFraction(after, 0.6, 0.5)) - luminance(pixelAtFraction(before, 0.6, 0.5))
    expect(low).toBeGreaterThan(8)
    expect(Math.abs(low - high)).toBeLessThan(low * 0.35)
  })

  test('la tabla de curvas no reemplaza la foto en la GPU', async () => {
    // La tabla y la imagen viven en unidades de textura distintas. Subir la
    // tabla con la unidad de la imagen activa la sustituye, y a partir de ahí el
    // shader dibuja la propia rampa de la tabla en lugar de la fotografía: un
    // degradado de izquierda a derecha, que sobre una rampa pasa desapercibido y
    // sobre cualquier otra imagen es absurdo. De ahí que se mida sobre un campo
    // plano, donde no hay nada que lo disimule.
    const bitmap = await flatGray(140)
    const result = await render(bitmap, edit(bitmap, {}, {}, curves({ rgb: S_CURVE })))
    const left = luminance(pixelAtFraction(result, 0.05, 0.5))
    const right = luminance(pixelAtFraction(result, 0.95, 0.5))
    expect(Math.abs(left - right)).toBeLessThan(3)
  })

  test('una curva plana aplasta el contraste a cero', async () => {
    const bitmap = await grayRamp()
    const flat: Curve = [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ]
    const result = await render(bitmap, edit(bitmap, {}, {}, curves({ rgb: flat })))
    expect(stats(result, 0.3, 0.3).deviation).toBeLessThan(2)
  })
})
