import { DEFAULT_ADJUSTMENTS, type AdjustmentKey, type Adjustments } from './adjustments'
import { defaultGeometry, type Geometry } from './geometry'
import { defaultGrade, sameGrade, type Grade } from './grade'
import { MAX_SECONDARIES } from './secondary'
import { normaliseCurve } from '../lib/curve'

/**
 * Everything the user has done to the photo. Colour and framing travel together
 * so that one undo steps back over one action, whichever panel it came from.
 *
 * Lives in its own module rather than beside the store: the history labeller
 * needs this type, and the store needs the labeller.
 */
export interface Edit {
  adjustments: Adjustments
  /** Colour wheels and tone curves. See types/grade. */
  grade: Grade
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
    sameGrade(a.grade, b.grade) &&
    changedAdjustments(a.adjustments, b.adjustments).length === 0
  )
}

export function freshEdit(width: number, height: number): Edit {
  return {
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    grade: defaultGrade(),
    geometry: defaultGeometry(width, height),
  }
}

/**
 * Brings an edit read back from storage up to the current shape.
 *
 * Sessions and presets outlive the version of the app that wrote them, and the
 * grade did not exist when the first ones were saved. Filling the gap here is
 * cheaper than having every reader defend itself, and it means an old session
 * opens as the photograph its owner left rather than as an error.
 */
export function normaliseEdit(edit: Partial<Edit>, width: number, height: number): Edit {
  const base = freshEdit(width, height)
  const grade = edit.grade
  return {
    adjustments: { ...base.adjustments, ...edit.adjustments },
    geometry: { ...base.geometry, ...edit.geometry },
    grade: grade
      ? {
          wheels: { ...base.grade.wheels, ...grade.wheels },
          curves: {
            rgb: normaliseCurve(grade.curves?.rgb ?? base.grade.curves.rgb),
            r: normaliseCurve(grade.curves?.r ?? base.grade.curves.r),
            g: normaliseCurve(grade.curves?.g ?? base.grade.curves.g),
            b: normaliseCurve(grade.curves?.b ?? base.grade.curves.b),
          },
          secondaries: (grade.secondaries ?? []).slice(0, MAX_SECONDARIES),
        }
      : base.grade,
  }
}
