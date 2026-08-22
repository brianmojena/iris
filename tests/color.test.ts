import { describe, expect, test } from 'vitest'
import { colorWheel, grayRamp } from './fixtures'
import { chroma, edit, luminance, pixelAtFraction, render, stats } from './render'

/** sRGB to linear, so exposure can be checked in the space it actually works in. */
function toLinear(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Mean chroma over a grid of samples. */
function meanChroma(image: Awaited<ReturnType<typeof render>>): number {
  let total = 0
  let count = 0
  for (let fy = 0.1; fy < 0.95; fy += 0.1) {
    for (let fx = 0.1; fx < 0.95; fx += 0.1) {
      total += chroma(pixelAtFraction(image, fx, fy))
      count++
    }
  }
  return total / count
}

describe('pipeline de color', () => {
  test('los valores por defecto no tocan la imagen', async () => {
    const bitmap = await grayRamp()
    const result = await render(bitmap, edit(bitmap))
    for (const fx of [0.2, 0.5, 0.8]) {
      const expected = fx * 255
      // Un nivel de margen por el dither de salida.
      expect(luminance(pixelAtFraction(result, fx, 0.5))).toBeCloseTo(expected, -1)
    }
  })

  test('exposición +1 duplica la luz lineal', async () => {
    const bitmap = await grayRamp()
    const base = await render(bitmap, edit(bitmap))
    const brighter = await render(bitmap, edit(bitmap, { exposure: 1 }))
    // Un punto suficientemente lejos del blanco para que quepa un paso entero.
    const before = toLinear(luminance(pixelAtFraction(base, 0.35, 0.5)))
    const after = toLinear(luminance(pixelAtFraction(brighter, 0.35, 0.5)))
    expect(after / before).toBeGreaterThan(1.8)
    expect(after / before).toBeLessThan(2.2)
  })

  test('el contraste separa oscuros y claros', async () => {
    const bitmap = await grayRamp()
    const base = await render(bitmap, edit(bitmap))
    const punchy = await render(bitmap, edit(bitmap, { contrast: 60 }))
    const spread = (image: typeof base) =>
      luminance(pixelAtFraction(image, 0.8, 0.5)) - luminance(pixelAtFraction(image, 0.2, 0.5))
    expect(spread(punchy)).toBeGreaterThan(spread(base) * 1.1)
  })

  test('saturación -100 deja la imagen sin color', async () => {
    const bitmap = await colorWheel()
    const result = await render(bitmap, edit(bitmap, { saturation: -100 }))
    expect(meanChroma(result)).toBeLessThan(0.02)
  })

  test('la temperatura mueve rojo y azul en direcciones opuestas', async () => {
    const bitmap = await grayRamp()
    const warm = await render(bitmap, edit(bitmap, { temperature: 60 }))
    const cool = await render(bitmap, edit(bitmap, { temperature: -60 }))
    const [warmR, , warmB] = pixelAtFraction(warm, 0.5, 0.5)
    const [coolR, , coolB] = pixelAtFraction(cool, 0.5, 0.5)
    expect(warmR).toBeGreaterThan(warmB)
    expect(coolB).toBeGreaterThan(coolR)
  })

  /**
   * La regresión del split-tone de neón.
   *
   * Recuperar altas luces y abrir sombras a la vez comprime el rango. La
   * reconstrucción del color escala el triplete RGB, lo que multiplica el croma
   * por el mismo factor; sin acotarlo, un píxel casi negro se llevaba una
   * ganancia enorme y la foto entera viraba a fosforescente.
   *
   * Los umbrales están puestos donde separan de verdad: hoy el peor píxel se
   * amplifica 1,21× y la media 1,06×, mientras que la versión con el fallo
   * llegaba al tope de ganancia de 4×. Hay holgura por ambos lados.
   */
  test('comprimir el rango tonal no dispara el color', async () => {
    const bitmap = await colorWheel()
    const base = await render(bitmap, edit(bitmap))
    const compressed = await render(bitmap, edit(bitmap, { highlights: -80, shadows: 60 }))

    expect(meanChroma(compressed)).toBeLessThan(meanChroma(base) * 1.15)

    let worst = 1
    for (let fy = 0.08; fy < 0.95; fy += 0.06) {
      for (let fx = 0.08; fx < 0.95; fx += 0.06) {
        const before = chroma(pixelAtFraction(base, fx, fy))
        const after = chroma(pixelAtFraction(compressed, fx, fy))
        if (before > 0.02) worst = Math.max(worst, after / before)
      }
    }
    expect(worst).toBeLessThan(1.5)
  })

  test('abrir sombras al máximo no invierte ningún tono', async () => {
    const bitmap = await colorWheel()
    const base = await render(bitmap, edit(bitmap))
    const lifted = await render(bitmap, edit(bitmap, { shadows: 100 }))
    // El orden relativo de los canales es la firma del tono: si se invierte,
    // el rojo se ha vuelto cian.
    for (const [fx, fy] of [
      [0.2, 0.3],
      [0.7, 0.3],
      [0.3, 0.8],
      [0.8, 0.7],
    ]) {
      const before = pixelAtFraction(base, fx, fy)
      const after = pixelAtFraction(lifted, fx, fy)
      const dominantBefore = before.slice(0, 3).indexOf(Math.max(...before.slice(0, 3)))
      const dominantAfter = after.slice(0, 3).indexOf(Math.max(...after.slice(0, 3)))
      expect(dominantAfter).toBe(dominantBefore)
    }
  })

  test('la intensidad respeta lo ya saturado más que la saturación', async () => {
    const bitmap = await colorWheel()
    const vibrant = await render(bitmap, edit(bitmap, { vibrance: 60 }))
    const saturated = await render(bitmap, edit(bitmap, { saturation: 60 }))
    expect(meanChroma(vibrant)).toBeLessThan(meanChroma(saturated))
  })

  test('el dither rompe el bandeado sin cambiar el brillo medio', async () => {
    const bitmap = await grayRamp()
    const result = await render(bitmap, edit(bitmap))
    const region = stats(result, 0.4, 0.2, 32)
    // El degradado ya tiene pendiente propia; lo que se comprueba es que el
    // ruido añadido es diminuto.
    expect(region.deviation).toBeLessThan(15)
  })
})
