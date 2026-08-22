import type { AdjustmentKey, Adjustments } from './adjustments'
import type { Geometry } from './geometry'

/**
 * Everything the user has done to the photo. Colour and framing travel together
 * so that one undo steps back over one action, whichever panel it came from.
 *
 * Lives in its own module rather than beside the store: the history labeller
 * needs this type, and the store needs the labeller.
 */
export interface Edit {
  adjustments: Adjustments
  geometry: Geometry
}

export function sameGeometry(a: Geometry, b: Geometry): boolean {
  return (
    a.rotation === b.rotation &&
    a.angle === b.angle &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    a.aspect === b.aspect &&
    a.crop.cx === b.crop.cx &&
    a.crop.cy === b.crop.cy &&
    a.crop.width === b.crop.width &&
    a.crop.height === b.crop.height
  )
}

export function changedAdjustments(a: Adjustments, b: Adjustments): AdjustmentKey[] {
  return (Object.keys(a) as AdjustmentKey[]).filter((key) => a[key] !== b[key])
}

// Compared by value, not reference: a gesture that ends where it started should
// not leave an undo step that appears to do nothing.
export function sameEdit(a: Edit, b: Edit): boolean {
  return (
    sameGeometry(a.geometry, b.geometry) &&
    changedAdjustments(a.adjustments, b.adjustments).length === 0
  )
}
