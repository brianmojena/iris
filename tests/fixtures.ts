/**
 * Test images built in code rather than committed as files.
 *
 * A binary fixture is opaque in review, bloats the repository and drifts from
 * whatever it was meant to prove. These are a few lines each, deterministic, and
 * their content is legible right here.
 */

/** mulberry32: tiny, seeded, and identical on every machine. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function toBitmap(width: number, height: number, paint: (data: Uint8ClampedArray) => void) {
  const image = new ImageData(width, height)
  paint(image.data)
  return createImageBitmap(image)
}

/**
 * A perfectly flat field, by default at the luminance where grain is weighted
 * strongest. Nothing of its own to hide a bias behind — which a ramp does.
 */
export function flatGray(level = 115, width = 192, height = 192) {
  return toBitmap(width, height, (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = level
      data[i + 3] = 255
    }
  })
}

/** Mid-grey with a horizontal ramp. Good for exposure and contrast. */
export function grayRamp(width = 256, height = 64) {
  return toBitmap(width, height, (data) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const value = Math.round((x / (width - 1)) * 255)
        data[i] = data[i + 1] = data[i + 2] = value
        data[i + 3] = 255
      }
    }
  })
}

/**
 * Four quadrants of distinct colour. Any flip, rotation or vertical mirror shows
 * up immediately as quadrants trading places.
 */
export const QUADRANTS = {
  topLeft: [220, 40, 40],
  topRight: [40, 180, 60],
  bottomLeft: [50, 70, 210],
  bottomRight: [230, 200, 40],
} as const

export function colorQuadrants(width = 128, height = 96) {
  return toBitmap(width, height, (data) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const top = y < height / 2
        const left = x < width / 2
        const colour = top
          ? left
            ? QUADRANTS.topLeft
            : QUADRANTS.topRight
          : left
            ? QUADRANTS.bottomLeft
            : QUADRANTS.bottomRight
        data[i] = colour[0]
        data[i + 1] = colour[1]
        data[i + 2] = colour[2]
        data[i + 3] = 255
      }
    }
  })
}

/**
 * Left half flat, right half hard vertical stripes, gaussian noise throughout.
 * Separates "removed noise" from "removed detail" — the whole point of an
 * edge-preserving filter.
 */
export function noisyStripes(width = 256, height = 128, sigma = 12) {
  const random = seededRandom(0x1215)
  return toBitmap(width, height, (data) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const base = x < width / 2 ? 128 : Math.floor(x / 16) % 2 === 0 ? 60 : 200
        // Sum of six uniforms is close enough to gaussian for a fixture.
        let noise = 0
        for (let k = 0; k < 6; k++) noise += random()
        const value = base + (noise - 3) * sigma
        data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, value))
        data[i + 3] = 255
      }
    }
  })
}

/** A saturated colour wheel-ish spread, for hue stability under tone work. */
export function colorWheel(size = 128) {
  return toBitmap(size, size, (data) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const angle = Math.atan2(y - size / 2, x - size / 2)
        const hue = ((angle / Math.PI + 1) / 2) * 6
        const c = 1
        const secondary = c * (1 - Math.abs((hue % 2) - 1))
        const [r, g, b] =
          hue < 1
            ? [c, secondary, 0]
            : hue < 2
              ? [secondary, c, 0]
              : hue < 3
                ? [0, c, secondary]
                : hue < 4
                  ? [0, secondary, c]
                  : hue < 5
                    ? [secondary, 0, c]
                    : [c, 0, secondary]
        // Kept off the extremes so tone controls have somewhere to move.
        const level = 0.25 + (Math.hypot(x - size / 2, y - size / 2) / size) * 0.5
        data[i] = Math.round(r * 255 * level + 40)
        data[i + 1] = Math.round(g * 255 * level + 40)
        data[i + 2] = Math.round(b * 255 * level + 40)
        data[i + 3] = 255
      }
    }
  })
}
