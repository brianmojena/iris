import { compose, linear, rotation, scaling, translation, type Mat3 } from '../lib/matrix'

/**
 * A crop rectangle, axis-aligned in *straightened space* — the frame you see
 * after the image has been flipped, quarter-turned and straightened.
 *
 * Everything is normalised against the straightened image's **width**, for both
 * axes. Using one unit for both keeps the numbers isotropic, so `width / height`
 * is the aspect ratio directly and no conversion is needed to lock one.
 */
export interface CropRect {
  /** Centre of the crop, offset from the centre of the image. */
  cx: number
  cy: number
  width: number
  height: number
}

export interface Geometry {
  /** Quarter turns clockwise: 0, 90, 180 or 270. */
  rotation: number
  /** Fine straightening in degrees, -45..45. */
  angle: number
  flipH: boolean
  flipV: boolean
  crop: CropRect
  /** Locked width/height ratio, or null when the crop is free. */
  aspect: number | null
}

export interface AspectPreset {
  id: string
  label: string
  /** null is free, 'original' follows the source image. */
  ratio: number | null | 'original'
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Libre', ratio: null },
  { id: 'original', label: 'Original', ratio: 'original' },
  { id: 'square', label: '1:1', ratio: 1 },
  { id: 'portrait45', label: '4:5', ratio: 4 / 5 },
  { id: 'photo32', label: '3:2', ratio: 3 / 2 },
  { id: 'wide169', label: '16:9', ratio: 16 / 9 },
  { id: 'story', label: '9:16', ratio: 9 / 16 },
]

/** Dimensions of the image after flips and quarter turns, before straightening. */
export function turnedSize(
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const quarter = ((geometry.rotation % 360) + 360) % 360
  return quarter === 90 || quarter === 270
    ? { width: sourceHeight, height: sourceWidth }
    : { width: sourceWidth, height: sourceHeight }
}

export function defaultGeometry(sourceWidth: number, sourceHeight: number): Geometry {
  return {
    rotation: 0,
    angle: 0,
    flipH: false,
    flipV: false,
    crop: { cx: 0, cy: 0, width: 1, height: sourceHeight / sourceWidth },
    aspect: null,
  }
}

export function isDefaultGeometry(
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  const base = defaultGeometry(sourceWidth, sourceHeight)
  return (
    geometry.rotation === 0 &&
    geometry.angle === 0 &&
    !geometry.flipH &&
    !geometry.flipV &&
    Math.abs(geometry.crop.cx) < 1e-4 &&
    Math.abs(geometry.crop.cy) < 1e-4 &&
    Math.abs(geometry.crop.width - base.crop.width) < 1e-4 &&
    Math.abs(geometry.crop.height - base.crop.height) < 1e-4
  )
}

/** Pixel dimensions of the cropped result, at full source resolution. */
export function outputSize(
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const turned = turnedSize(geometry, sourceWidth, sourceHeight)
  const crop = effectiveCrop(geometry, sourceWidth, sourceHeight)
  return {
    width: Math.max(1, Math.round(crop.width * turned.width)),
    height: Math.max(1, Math.round(crop.height * turned.width)),
  }
}

/** Bounding box of the straightened image, in crop units. */
export function straightenedBounds(
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const turned = turnedSize(geometry, sourceWidth, sourceHeight)
  const w = 1
  const h = turned.height / turned.width
  const radians = (geometry.angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  return { width: w * cos + h * sin, height: w * sin + h * cos }
}

/** Undoes a quarter turn: straightened frame back to flipped-source frame. */
function unturn(quarterTurns: number): Mat3 {
  const quarter = ((quarterTurns % 360) + 360) % 360
  // The image was turned clockwise, so a screen point maps back by turning the
  // opposite way. Written out rather than derived, because the sign of a 90°
  // turn on a y-down axis is exactly the kind of thing that silently flips.
  switch (quarter) {
    case 90:
      return linear(0, 1, -1, 0)
    case 180:
      return linear(-1, 0, 0, -1)
    case 270:
      return linear(0, -1, 1, 0)
    default:
      return linear(1, 0, 0, 1)
  }
}

/**
 * Builds the map from output texture coordinates to source texture coordinates.
 *
 * Read it bottom-up: an output pixel is placed inside the crop, scaled into
 * straightened pixels, un-straightened, un-turned, un-flipped, and finally
 * expressed as a fraction of the source image.
 *
 * `cropOverride` lets the crop editor render the whole straightened image
 * (corners and all) through this same path instead of a parallel one.
 */
export function sourceTransform(
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
  cropOverride?: CropRect,
): Mat3 {
  const crop = cropOverride ?? effectiveCrop(geometry, sourceWidth, sourceHeight)
  const turned = turnedSize(geometry, sourceWidth, sourceHeight)
  const radians = (geometry.angle * Math.PI) / 180

  return compose(
    translation(0.5, 0.5),
    scaling(1 / sourceWidth, 1 / sourceHeight),
    unturn(geometry.rotation),
    scaling(geometry.flipH ? -1 : 1, geometry.flipV ? -1 : 1),
    rotation(-radians),
    scaling(turned.width, turned.width),
    translation(crop.cx, crop.cy),
    scaling(crop.width, crop.height),
    translation(-0.5, -0.5),
  )
}

/**
 * Turns the image a quarter clockwise (or anticlockwise) and carries the crop
 * with it, so the same content stays framed. The normalisation unit changes when
 * width and height swap, hence the trip through pixels and back.
 */
export function rotateQuarter(
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
  direction: 1 | -1,
): Geometry {
  const before = turnedSize(geometry, sourceWidth, sourceHeight).width
  const rotation = (((geometry.rotation + 90 * direction) % 360) + 360) % 360
  const after = turnedSize({ ...geometry, rotation }, sourceWidth, sourceHeight).width

  const { cx, cy, width, height } = geometry.crop
  // Clockwise sends (x, y) to (-y, x); anticlockwise the other way.
  const px = direction === 1 ? -cy * before : cy * before
  const py = direction === 1 ? cx * before : -cx * before

  return {
    ...geometry,
    rotation,
    aspect: geometry.aspect ? 1 / geometry.aspect : null,
    crop: {
      cx: px / after,
      cy: py / after,
      width: (height * before) / after,
      height: (width * before) / after,
    },
  }
}

/**
 * Mirrors the picture. The straightening angle is negated and the crop centre
 * mirrored along with it: flipping should reverse the whole composition, not
 * slide the subject out of a frame that stays put.
 */
export function flipGeometry(geometry: Geometry, axis: 'horizontal' | 'vertical'): Geometry {
  return axis === 'horizontal'
    ? {
        ...geometry,
        flipH: !geometry.flipH,
        angle: -geometry.angle,
        crop: { ...geometry.crop, cx: -geometry.crop.cx },
      }
    : {
        ...geometry,
        flipV: !geometry.flipV,
        angle: -geometry.angle,
        crop: { ...geometry.crop, cy: -geometry.crop.cy },
      }
}

/** Smallest crop we allow, as a fraction of the straightened image width. */
export const MIN_CROP = 0.05

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

function rotate(x: number, y: number, radians: number) {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: c * x - s * y, y: s * x + c * y }
}

interface Bounds {
  halfWidth: number
  halfHeight: number
  radians: number
}

function boundsOf(geometry: Geometry, sourceWidth: number, sourceHeight: number): Bounds {
  const turned = turnedSize(geometry, sourceWidth, sourceHeight)
  return {
    halfWidth: 0.5,
    halfHeight: turned.height / turned.width / 2,
    radians: (geometry.angle * Math.PI) / 180,
  }
}

function corners(crop: CropRect): { x: number; y: number }[] {
  const a = crop.width / 2
  const b = crop.height / 2
  return [
    { x: -a, y: -b },
    { x: a, y: -b },
    { x: a, y: b },
    { x: -a, y: b },
  ]
}

/**
 * Is every corner of the crop still on the image?
 *
 * The image is a rectangle rotated by the straightening angle, so the test is
 * done in the un-rotated frame where it is axis-aligned again.
 */
export function isCropInside(
  crop: CropRect,
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  const { halfWidth, halfHeight, radians } = boundsOf(geometry, sourceWidth, sourceHeight)
  const epsilon = 1e-6
  return corners(crop).every((corner) => {
    const p = rotate(crop.cx + corner.x, crop.cy + corner.y, -radians)
    return Math.abs(p.x) <= halfWidth + epsilon && Math.abs(p.y) <= halfHeight + epsilon
  })
}

/**
 * Pulls a crop back onto the image: the centre is clamped first, then the whole
 * rectangle shrinks about that centre until every corner fits. Shrinking keeps
 * the aspect ratio, which is what makes straightening feel like the frame is
 * closing in rather than reshaping itself.
 */
export function fitCrop(
  crop: CropRect,
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  const { halfWidth, halfHeight, radians } = boundsOf(geometry, sourceWidth, sourceHeight)

  const centre = rotate(crop.cx, crop.cy, -radians)
  centre.x = clamp(centre.x, -halfWidth, halfWidth)
  centre.y = clamp(centre.y, -halfHeight, halfHeight)

  let scale = 1
  for (const corner of corners(crop)) {
    const d = rotate(corner.x, corner.y, -radians)
    // centre + scale·d must stay within ±half on each axis.
    if (d.x > 1e-9) scale = Math.min(scale, (halfWidth - centre.x) / d.x)
    else if (d.x < -1e-9) scale = Math.min(scale, (-halfWidth - centre.x) / d.x)
    if (d.y > 1e-9) scale = Math.min(scale, (halfHeight - centre.y) / d.y)
    else if (d.y < -1e-9) scale = Math.min(scale, (-halfHeight - centre.y) / d.y)
  }
  scale = clamp(scale, 0, 1)

  const back = rotate(centre.x, centre.y, radians)
  return {
    cx: back.x,
    cy: back.y,
    width: Math.max(MIN_CROP, crop.width * scale),
    height: Math.max(MIN_CROP, crop.height * scale),
  }
}


/**
 * The crop as it is actually drawn.
 *
 * `geometry.crop` records what the user asked for and is never trimmed by a
 * straightening change — otherwise nudging the angle back and forth would eat
 * the picture a slice at a time, since fitting can only ever shrink. Tilting
 * narrows what is reachable; letting go of the tilt gives it back.
 */
export function effectiveCrop(
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  return isCropInside(geometry.crop, geometry, sourceWidth, sourceHeight)
    ? geometry.crop
    : fitCrop(geometry.crop, geometry, sourceWidth, sourceHeight)
}
