import { describe, expect, test } from 'vitest'
import { colorQuadrants, flatGray, grayRamp, noisyStripes } from './fixtures'
import { edit, imageMean, luminance, pixelAtFraction, render, stats } from './render'

/** Contraste del escalón entre franjas contiguas en la mitad derecha. */
function stripeContrast(image: Awaited<ReturnType<typeof render>>): number {
  const y = Math.round(image.height / 2)
  let dark = 0
  let darkCount = 0
  let light = 0
  let lightCount = 0
  for (let x = Math.round(image.width * 0.55); x < image.width - 4; x++) {
    const withinStripe = x % 16 > 5 && x % 16 < 11
    if (!withinStripe) continue
    const value = luminance([
      image.data[(y * image.width + x) * 4],
      image.data[(y * image.width + x) * 4 + 1],
      image.data[(y * image.width + x) * 4 + 2],
    ])
    if (Math.floor(x / 16) % 2 === 0) {
      dark += value
      darkCount++
    } else {
      light += value
      lightCount++
    }
  }
  return Math.abs(light / lightCount - dark / darkCount)
}

describe('detalle y efectos', () => {
  test('la reducción de ruido limpia lo plano y respeta los bordes', async () => {
    const bitmap = await noisyStripes()
    const base = await render(bitmap, edit(bitmap))
    const cleaned = await render(bitmap, edit(bitmap, { denoise: 100 }))

    const noiseBefore = stats(base, 0.1, 0.5, 40).deviation
    const noiseAfter = stats(cleaned, 0.1, 0.5, 40).deviation
    expect(noiseAfter).toBeLessThan(noiseBefore * 0.5)

    // El escalón entre franjas es la prueba de que preserva bordes.
    expect(stripeContrast(cleaned)).toBeGreaterThan(stripeContrast(base) * 0.95)
  })

  test('la nitidez sube la energía de gradiente', async () => {
    const bitmap = await noisyStripes()
    const base = await render(bitmap, edit(bitmap))
    const sharp = await render(bitmap, edit(bitmap, { sharpness: 100 }))
    expect(stats(sharp, 0.6, 0.5, 40).gradient).toBeGreaterThan(
      stats(base, 0.6, 0.5, 40).gradient * 1.15,
    )
  })

  test('el desenfoque la baja', async () => {
    const bitmap = await noisyStripes()
    const base = await render(bitmap, edit(bitmap))
    const blurred = await render(bitmap, edit(bitmap, { blur: 70 }))
    expect(stats(blurred, 0.6, 0.5, 40).gradient).toBeLessThan(
      stats(base, 0.6, 0.5, 40).gradient * 0.6,
    )
  })

  /**
   * La invariante del grano: ruido simétrico añade textura y nada más.
   *
   * Cualquier sesgo en el generador, o un peso mal aplicado, se ve aquí como un
   * desplazamiento del brillo medio de una superficie lisa.
   */
  test('el grano añade textura sin mover el brillo medio', async () => {
    // Campo plano a propósito: sobre un degradado, su propia pendiente enmascara
    // un sesgo en el ruido y el test deja de detectar precisamente lo que busca.
    const bitmap = await flatGray()
    const base = await render(bitmap, edit(bitmap))
    const grainy = await render(bitmap, edit(bitmap, { grain: 100 }))

    // Ruido simétrico no puede desplazar la media de la imagen entera.
    expect(Math.abs(imageMean(grainy) - imageMean(base))).toBeLessThan(2)
    // Pero sí tiene que haber añadido textura.
    expect(stats(grainy, 0.3, 0.3, 64).deviation).toBeGreaterThan(
      stats(base, 0.3, 0.3, 64).deviation + 3,
    )
  })

  test('la viñeta oscurece las esquinas y deja el centro', async () => {
    const bitmap = await grayRamp(200, 200)
    const base = await render(bitmap, edit(bitmap))
    const vignetted = await render(bitmap, edit(bitmap, { vignette: 80 }))

    const centreBefore = luminance(pixelAtFraction(base, 0.5, 0.5))
    const centreAfter = luminance(pixelAtFraction(vignetted, 0.5, 0.5))
    expect(Math.abs(centreAfter - centreBefore)).toBeLessThan(6)

    const cornerBefore = luminance(pixelAtFraction(base, 0.5, 0.02))
    const cornerAfter = luminance(pixelAtFraction(vignetted, 0.5, 0.02))
    expect(cornerAfter).toBeLessThan(cornerBefore * 0.75)
  })

  test('la viñeta negativa aclara en vez de oscurecer', async () => {
    const bitmap = await grayRamp(200, 200)
    const base = await render(bitmap, edit(bitmap))
    const lifted = await render(bitmap, edit(bitmap, { vignette: -80 }))
    expect(luminance(pixelAtFraction(lifted, 0.5, 0.02))).toBeGreaterThan(
      luminance(pixelAtFraction(base, 0.5, 0.02)),
    )
  })

  /**
   * La regresión del volteo en Y.
   *
   * Dibujar a un framebuffer invierte Y respecto a dibujar al lienzo. Activar
   * cualquier efecto alarga la cadena de pasadas, y con el volteo aplicado una
   * vez de más la imagen salía del revés — sin que nada fallara ruidosamente.
   */
  test('activar un efecto no cambia la orientación de la imagen', async () => {
    const bitmap = await colorQuadrants()
    const single = await render(bitmap, edit(bitmap))
    // Viñeta al mínimo: dispara la cadena multipasada sin alterar el centro.
    const multi = await render(bitmap, edit(bitmap, { vignette: 1 }))

    for (const [fx, fy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      const before = pixelAtFraction(single, fx, fy)
      const after = pixelAtFraction(multi, fx, fy)
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(after[channel] - before[channel])).toBeLessThan(12)
      }
    }
  })

  test('la cadena completa de efectos deja la imagen en pie', async () => {
    const bitmap = await colorQuadrants(160, 120)
    const result = await render(
      bitmap,
      edit(bitmap, { denoise: 60, blur: 30, sharpness: 40, grain: 20, vignette: 30 }),
    )
    expect([result.width, result.height]).toEqual([160, 120])
    // Cada cuadrante conserva su canal dominante pese a las cinco pasadas.
    const topLeft = pixelAtFraction(result, 0.25, 0.25)
    expect(topLeft[0]).toBeGreaterThan(topLeft[1])
    const bottomLeft = pixelAtFraction(result, 0.25, 0.75)
    expect(bottomLeft[2]).toBeGreaterThan(bottomLeft[0])
  })
})
