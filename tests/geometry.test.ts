import { describe, expect, test } from 'vitest'
import { QUADRANTS, colorQuadrants } from './fixtures'
import { edit, pixelAtFraction, render } from './render'
import {
  defaultGeometry,
  effectiveCrop,
  flipGeometry,
  isCropInside,
  outputSize,
  rotateQuarter,
} from '../src/types/geometry'
import { apply, compose, identity, rotation, scaling, translation } from '../src/lib/matrix'

/** Which fixture quadrant a colour came from, or null if it is something else. */
function quadrantOf(pixel: number[]): string | null {
  for (const [name, colour] of Object.entries(QUADRANTS)) {
    if (colour.every((channel, i) => Math.abs(channel - pixel[i]) < 12)) return name
  }
  return null
}

describe('matrices', () => {
  test('componer con la identidad no cambia nada', () => {
    const m = compose(translation(3, -2), scaling(2, 2))
    const same = compose(identity(), m, identity())
    expect([...same]).toEqual([...m])
  })

  test('una rotación y su inversa devuelven el punto de partida', () => {
    const there = rotation(0.7)
    const back = rotation(-0.7)
    const point = apply(compose(back, there), 12, -5)
    expect(point.x).toBeCloseTo(12, 4)
    expect(point.y).toBeCloseTo(-5, 4)
  })

  test('compose aplica de derecha a izquierda', () => {
    // Escalar y luego desplazar no es lo mismo que desplazar y luego escalar.
    const scaleThenMove = apply(compose(translation(10, 0), scaling(2, 2)), 1, 0)
    const moveThenScale = apply(compose(scaling(2, 2), translation(10, 0)), 1, 0)
    expect(scaleThenMove.x).toBe(12)
    expect(moveThenScale.x).toBe(22)
  })
})

describe('encuadre', () => {
  test('el recorte determina el tamaño de salida', async () => {
    const bitmap = await colorQuadrants(200, 100)
    const geometry = defaultGeometry(200, 100)
    const cropped = { ...geometry, crop: { cx: 0, cy: 0, width: 0.5, height: 0.25 } }
    expect(outputSize(cropped, 200, 100)).toEqual({ width: 100, height: 50 })

    const result = await render(bitmap, edit(bitmap, {}, cropped))
    expect([result.width, result.height]).toEqual([100, 50])
  })

  test('voltear en horizontal intercambia los lados exactamente', async () => {
    const bitmap = await colorQuadrants()
    const base = await render(bitmap, edit(bitmap))
    const geometry = flipGeometry(defaultGeometry(bitmap.width, bitmap.height), 'horizontal')
    const flipped = await render(bitmap, edit(bitmap, {}, geometry))

    expect(quadrantOf(pixelAtFraction(base, 0.25, 0.25))).toBe('topLeft')
    expect(quadrantOf(pixelAtFraction(flipped, 0.25, 0.25))).toBe('topRight')
    expect(quadrantOf(pixelAtFraction(flipped, 0.75, 0.75))).toBe('bottomLeft')
  })

  test('voltear en vertical intercambia arriba y abajo', async () => {
    const bitmap = await colorQuadrants()
    const geometry = flipGeometry(defaultGeometry(bitmap.width, bitmap.height), 'vertical')
    const flipped = await render(bitmap, edit(bitmap, {}, geometry))
    expect(quadrantOf(pixelAtFraction(flipped, 0.25, 0.25))).toBe('bottomLeft')
  })

  test('girar 90° a la derecha lleva la esquina superior izquierda arriba a la derecha', async () => {
    const bitmap = await colorQuadrants(120, 80)
    const geometry = rotateQuarter(defaultGeometry(120, 80), 120, 80, 1)
    const turned = await render(bitmap, edit(bitmap, {}, geometry))

    expect([turned.width, turned.height]).toEqual([80, 120])
    expect(quadrantOf(pixelAtFraction(turned, 0.75, 0.25))).toBe('topLeft')
    expect(quadrantOf(pixelAtFraction(turned, 0.25, 0.75))).toBe('bottomRight')
  })

  test('cuatro giros vuelven al punto de partida', async () => {
    const bitmap = await colorQuadrants()
    let geometry = defaultGeometry(bitmap.width, bitmap.height)
    for (let i = 0; i < 4; i++) {
      geometry = rotateQuarter(geometry, bitmap.width, bitmap.height, 1)
    }
    const result = await render(bitmap, edit(bitmap, {}, geometry))
    expect(quadrantOf(pixelAtFraction(result, 0.25, 0.25))).toBe('topLeft')
    expect(quadrantOf(pixelAtFraction(result, 0.75, 0.75))).toBe('bottomRight')
  })

  test('enderezar deja el recorte dentro y sin esquinas vacías', async () => {
    const bitmap = await colorQuadrants(200, 140)
    const geometry = { ...defaultGeometry(200, 140), angle: 12 }
    expect(isCropInside(effectiveCrop(geometry, 200, 140), geometry, 200, 140)).toBe(true)

    const result = await render(bitmap, edit(bitmap, {}, geometry))
    // Cada esquina del resultado tiene que ser imagen opaca, no transparencia.
    for (const [fx, fy] of [
      [0.01, 0.01],
      [0.99, 0.01],
      [0.01, 0.99],
      [0.99, 0.99],
    ]) {
      expect(pixelAtFraction(result, fx, fy)[3]).toBe(255)
    }
  })

  /**
   * La regresión del enderezado que se comía la foto.
   *
   * Ajustar el recorte al rectángulo inclinado solo sabe encoger, así que si
   * eso se guardara, mover el control de ida y vuelta iría recortando cada vez.
   */
  test('inclinar y volver a cero recupera el encuadre entero', () => {
    const base = defaultGeometry(2400, 1200)
    const tilted = { ...base, angle: 15 }
    const straight = { ...base, angle: 0 }

    expect(effectiveCrop(tilted, 2400, 1200).width).toBeLessThan(base.crop.width)
    expect(effectiveCrop(straight, 2400, 1200).width).toBeCloseTo(base.crop.width, 6)
  })

  test('la proporción bloqueada sobrevive a un giro, invertida', () => {
    const geometry = { ...defaultGeometry(2000, 1000), aspect: 16 / 9 }
    const turned = rotateQuarter(geometry, 2000, 1000, 1)
    expect(turned.aspect).toBeCloseTo(9 / 16, 6)
  })
})
