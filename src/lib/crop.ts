import { MIN_CROP, fitCrop, turnedSize, type CropRect, type Geometry } from '../types/geometry'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

export const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw']
export const EDGE_HANDLES: Handle[] = ['n', 'e', 's', 'w']

/**
 * Reshapes a crop to a locked ratio, keeping its centre and roughly the amount
 * of the picture it framed — jumping to the largest possible rectangle would
 * throw away a composition the user had already set up.
 */
export function applyAspect(
  crop: CropRect,
  aspect: number,
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  const area = crop.width * crop.height
  const width = Math.sqrt(area * aspect)
  return fitCrop({ ...crop, width, height: width / aspect }, geometry, sourceWidth, sourceHeight)
}

/** The ratio a preset resolves to for this image, or null when free. */
export function resolveAspect(
  ratio: number | null | 'original',
  geometry: Geometry,
  sourceWidth: number,
  sourceHeight: number,
): number | null {
  if (ratio === null) return null
  if (ratio !== 'original') return ratio
  const turned = turnedSize(geometry, sourceWidth, sourceHeight)
  return turned.width / turned.height
}

/**
 * Resizes a crop by dragging one handle. Deltas arrive in crop units, already
 * converted from screen pixels by the overlay.
 *
 * A locked ratio anchors on whichever edges the handle is not dragging, so the
 * rectangle grows out of the opposite corner rather than the centre.
 */
export function resizeCrop(
  crop: CropRect,
  handle: Handle,
  deltaX: number,
  deltaY: number,
  aspect: number | null,
): CropRect {
  if (handle === 'move') {
    return { ...crop, cx: crop.cx + deltaX, cy: crop.cy + deltaY }
  }

  let left = crop.cx - crop.width / 2
  let right = crop.cx + crop.width / 2
  let top = crop.cy - crop.height / 2
  let bottom = crop.cy + crop.height / 2

  const movesLeft = handle.includes('w')
  const movesRight = handle.includes('e')
  const movesTop = handle.startsWith('n')
  const movesBottom = handle.startsWith('s')

  if (movesLeft) left = Math.min(left + deltaX, right - MIN_CROP)
  if (movesRight) right = Math.max(right + deltaX, left + MIN_CROP)
  if (movesTop) top = Math.min(top + deltaY, bottom - MIN_CROP)
  if (movesBottom) bottom = Math.max(bottom + deltaY, top + MIN_CROP)

  let width = right - left
  let height = bottom - top

  if (aspect) {
    if (movesLeft || movesRight) {
      // Horizontal drag leads; height follows.
      height = Math.max(MIN_CROP, width / aspect)
      if (movesTop) top = bottom - height
      else if (movesBottom) bottom = top + height
      else {
        const centre = (top + bottom) / 2
        top = centre - height / 2
        bottom = centre + height / 2
      }
    } else {
      width = Math.max(MIN_CROP, height * aspect)
      const centre = (left + right) / 2
      left = centre - width / 2
      right = centre + width / 2
    }
    width = right - left
    height = bottom - top
  }

  return { cx: (left + right) / 2, cy: (top + bottom) / 2, width, height }
}
