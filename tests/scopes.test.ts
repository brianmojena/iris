import { describe, expect, test } from 'vitest'
import {
  histogram,
  vectorscopeImage,
  VECTOR_TARGETS,
  waveformImage,
} from '../src/lib/scopes'
import type { ScopeSample } from '../src/engine/Renderer'

/** A sample built by hand, so what the scope is measuring is not in doubt. */
function sample(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number?],
): ScopeSample {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b, a] = paint(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a ?? 255
    }
  }
  return { data, width, height }
}

const flat = (level: number, width = 64, height = 48) =>
  sample(width, height, () => [level, level, level])

/** Brightest row of a column of the plot, counted from the top. */
function brightestRow(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  column: number,
): number {
  let best = -1
  let row = 0
  for (let y = 0; y < height; y++) {
    const i = (y * width + column) * 4
    const value = pixels[i] + pixels[i + 1] + pixels[i + 2]
    if (value > best) {
      best = value
      row = y
    }
  }
  return row
}

describe('histograma', () => {
  test('un campo plano cae entero en una casilla', () => {
    const bins = histogram(flat(128))
    expect(bins.r[128]).toBe(64 * 48)
    expect(bins.r[127]).toBe(0)
    expect(bins.luma[128]).toBe(64 * 48)
  })

  test('las esquinas transparentes de un enderezado no se cuentan', () => {
    const half = sample(64, 48, (x) => (x < 32 ? [200, 200, 200] : [0, 0, 0, 0]))
    const bins = histogram(half)
    expect(bins.r[200]).toBe(32 * 48)
    expect(bins.r[0]).toBe(0)
  })

  test('el recorte se informa aparte, no como una barra que aplasta el resto', () => {
    const clipped = sample(100, 10, (x) => (x < 20 ? [0, 0, 0] : x > 89 ? [255, 255, 255] : [120, 120, 120]))
    const bins = histogram(clipped)
    expect(bins.clippedLow).toBeCloseTo(0.2, 2)
    expect(bins.clippedHigh).toBeCloseTo(0.1, 2)
    // El pico ignora los extremos, así que lo marca el gris del medio.
    expect(bins.peak).toBe(70 * 10)
  })
})

describe('forma de onda', () => {
  test('una rampa horizontal se dibuja como una diagonal', () => {
    const ramp = sample(128, 32, (x) => {
      const value = Math.round((x / 127) * 255)
      return [value, value, value]
    })
    const plot = waveformImage(ramp, 128, 128, 'rgb')
    // Oscuro a la izquierda es abajo del todo; claro a la derecha, arriba.
    expect(brightestRow(plot.pixels, plot.width, plot.height, 1)).toBeGreaterThan(
      plot.height * 0.9,
    )
    expect(brightestRow(plot.pixels, plot.width, plot.height, plot.width - 2)).toBeLessThan(
      plot.height * 0.1,
    )
  })

  test('nunca se dibuja más ancho de lo que la muestra puede medir', () => {
    // Pedir mil columnas de una muestra de sesenta y cuatro dejaría el trazo
    // lleno de huecos, que se lee como una señal rota y no como una ampliada.
    const plot = waveformImage(flat(128, 64, 32), 1000, 1000, 'rgb')
    expect(plot.width).toBeLessThanOrEqual(64)
    expect(plot.height).toBeLessThanOrEqual(256)
  })

  test('el parade reparte los tres canales en tres carriles', () => {
    const red = flat(0, 60, 20)
    for (let i = 0; i < red.data.length; i += 4) red.data[i] = 220
    const plot = waveformImage(red, 180, 128, 'parade')
    const lane = plot.width / 3
    // Rojo alto en el primer carril, negro en los otros dos.
    expect(brightestRow(plot.pixels, plot.width, plot.height, Math.floor(lane / 2))).toBeLessThan(
      plot.height * 0.2,
    )
    expect(
      brightestRow(plot.pixels, plot.width, plot.height, Math.floor(lane * 1.5)),
    ).toBeGreaterThan(plot.height * 0.9)
  })
})

describe('vectorscopio', () => {
  test('una imagen neutra se concentra en el centro', () => {
    const plot = vectorscopeImage(flat(140), 128)
    const centre = Math.floor(plot.width / 2)
    const i = (centre * plot.width + centre) * 4
    expect(plot.pixels[i] + plot.pixels[i + 1] + plot.pixels[i + 2]).toBeGreaterThan(300)

    // Y nada cerca del borde.
    const edgeOn = (centre * plot.width + plot.width - 2) * 4
    expect(plot.pixels[edgeOn]).toBeLessThan(40)
  })

  test('las dianas están donde las pone cualquier graticule de barras al 75 %', () => {
    const byLabel = Object.fromEntries(VECTOR_TARGETS.map((t) => [t.label, t]))
    const angle = (label: string) => {
      const degrees = (Math.atan2(byLabel[label].y, byLabel[label].x) * 180) / Math.PI
      return (degrees + 360) % 360
    }
    expect(angle('R')).toBeCloseTo(103, 0)
    expect(angle('Mg')).toBeCloseTo(61, 0)
    expect(angle('B')).toBeCloseTo(347, 0)
    expect(angle('Cy')).toBeCloseTo(283, 0)
    expect(angle('G')).toBeCloseTo(241, 0)
    expect(angle('Yl')).toBeCloseTo(167, 0)
  })

  test('un rojo saturado cae del lado del rojo', () => {
    const red = sample(64, 64, () => [230, 30, 30])
    const plot = vectorscopeImage(red, 128)
    const centre = (plot.width - 1) / 2
    let sumX = 0
    let sumY = 0
    let weight = 0
    for (let y = 0; y < plot.height; y++) {
      for (let x = 0; x < plot.width; x++) {
        const i = (y * plot.width + x) * 4
        const value = plot.pixels[i] + plot.pixels[i + 1] + plot.pixels[i + 2] - 47
        if (value <= 0) continue
        sumX += (x - centre) * value
        sumY += (centre - y) * value
        weight += value
      }
    }
    const degrees = ((Math.atan2(sumY / weight, sumX / weight) * 180) / Math.PI + 360) % 360
    expect(Math.abs(degrees - 103)).toBeLessThan(20)
  })
})
