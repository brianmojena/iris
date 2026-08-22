import { describe, expect, test } from 'vitest'
import { edit, pixelAtFraction, render } from './render'
import { LUMA, hasWideGamutContent, supportsWideGamut, workingSpace } from '../src/lib/colorSpace'
import { renderToBlob } from '../src/lib/export'
import { DEFAULT_ADJUSTMENTS } from '../src/types/adjustments'
import { defaultGeometry } from '../src/types/geometry'

/** A photo holding colours sRGB cannot reach. */
async function wideGamutImage(size = 64) {
  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext('2d', { colorSpace: 'display-p3' })!
  context.fillStyle = 'color(display-p3 1 0 0)'
  context.fillRect(0, 0, size / 2, size)
  context.fillStyle = 'color(display-p3 0 1 0)'
  context.fillRect(size / 2, 0, size / 2, size)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return createImageBitmap(blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'none' })
}

/** An ordinary photo, entirely inside sRGB. */
async function narrowGamutImage(size = 64) {
  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgb(200, 90, 40)'
  context.fillRect(0, 0, size, size)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return createImageBitmap(blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'none' })
}

describe('gestión de color', () => {
  test('los pesos de luminancia suman uno en cada espacio', () => {
    for (const weights of Object.values(LUMA)) {
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4)
    }
  })

  test('los pesos de P3 y sRGB no son los mismos', () => {
    // Distintas primarias, distinta luminancia. Usar los de sRGB sobre datos P3
    // desequilibra en silencio todo el rango tonal.
    expect(LUMA['display-p3'][0]).not.toBe(LUMA.srgb[0])
  })

  /**
   * La regresión de la gama.
   *
   * Antes de gestionar color, el búfer de dibujo era sRGB y un rojo P3 puro
   * llegaba a pantalla como su vecino más cercano en sRGB: [233, 52, 36] donde
   * debía dar [255, 0, 0]. Medido en P3, que es donde la diferencia existe.
   */
  test('una foto de gama ancha conserva sus colores', async () => {
    if (!supportsWideGamut()) return
    const bitmap = await wideGamutImage()
    const result = await render(bitmap, edit(bitmap), 'display-p3')

    const red = pixelAtFraction(result, 0.15, 0.5)
    const green = pixelAtFraction(result, 0.85, 0.5)
    expect(red[0]).toBeGreaterThan(250)
    expect(red[1]).toBeLessThan(8)
    expect(green[1]).toBeGreaterThan(250)
    expect(green[0]).toBeLessThan(8)
  })

  test('una foto sRGB corriente atraviesa el pipeline sin alterarse', async () => {
    const bitmap = await narrowGamutImage()
    const result = await render(bitmap, edit(bitmap))
    const [r, g, b] = pixelAtFraction(result, 0.5, 0.5)
    // Un nivel de margen por el dither de salida.
    expect(Math.abs(r - 200)).toBeLessThan(3)
    expect(Math.abs(g - 90)).toBeLessThan(3)
    expect(Math.abs(b - 40)).toBeLessThan(3)
  })

  test('la detección distingue gama ancha de gama normal', async () => {
    if (!supportsWideGamut()) return
    expect(await hasWideGamutContent(await wideGamutImage())).toBe(true)
    expect(await hasWideGamutContent(await narrowGamutImage())).toBe(false)
  })

  test('exportar en Display P3 etiqueta el archivo y conserva la gama', async () => {
    if (workingSpace() !== 'display-p3') return
    const bitmap = await wideGamutImage()
    const blob = await renderToBlob(
      bitmap,
      { adjustments: DEFAULT_ADJUSTMENTS, geometry: defaultGeometry(64, 64) },
      { format: 'image/png', quality: 1, maxEdge: null, colorSpace: 'display-p3' },
    )
    const header = new TextDecoder('latin1').decode(
      new Uint8Array(await blob.arrayBuffer()).slice(0, 800),
    )
    expect(header.includes('iCCP') || header.includes('cICP')).toBe(true)

    const decoded = await createImageBitmap(blob, { colorSpaceConversion: 'default' })
    const canvas = new OffscreenCanvas(64, 64)
    const context = canvas.getContext('2d', { colorSpace: 'display-p3' })!
    context.drawImage(decoded, 0, 0)
    const [r] = context.getImageData(8, 8, 1, 1, { colorSpace: 'display-p3' }).data
    expect(r).toBeGreaterThan(250)
  })

  test('exportar en sRGB reduce la gama, que es lo pedido', async () => {
    if (workingSpace() !== 'display-p3') return
    const bitmap = await wideGamutImage()
    const blob = await renderToBlob(
      bitmap,
      { adjustments: DEFAULT_ADJUSTMENTS, geometry: defaultGeometry(64, 64) },
      { format: 'image/png', quality: 1, maxEdge: null, colorSpace: 'srgb' },
    )
    const decoded = await createImageBitmap(blob, { colorSpaceConversion: 'default' })
    const canvas = new OffscreenCanvas(64, 64)
    const context = canvas.getContext('2d', { colorSpace: 'display-p3' })!
    context.drawImage(decoded, 0, 0)
    const [r, g] = context.getImageData(8, 8, 1, 1, { colorSpace: 'display-p3' }).data
    // El rojo sRGB, leído en P3, es el vecino apagado: ni saturado ni puro.
    expect(r).toBeLessThan(245)
    expect(g).toBeGreaterThan(30)
  })
})
