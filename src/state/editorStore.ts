import { create } from 'zustand'
import {
  DEFAULT_ADJUSTMENTS,
  isDefault,
  type AdjustmentKey,
  type Adjustments,
} from '../types/adjustments'
import { defaultGeometry, isDefaultGeometry, type Geometry } from '../types/geometry'
import { loadImageFile, type LoadedImage } from '../lib/decode'
import type { ExportOptions } from '../lib/export'

const HISTORY_LIMIT = 100

export interface Notice {
  kind: 'error' | 'info'
  message: string
}

/**
 * Everything the user has done to the photo. Colour and framing travel together
 * so that one undo steps back over one action, whichever panel it came from.
 */
export interface Edit {
  adjustments: Adjustments
  geometry: Geometry
}

interface EditorState {
  image: LoadedImage | null
  status: 'empty' | 'loading' | 'ready'
  notice: Notice | null

  edit: Edit
  /** Snapshot taken when a drag starts, so the whole gesture is one undo step. */
  snapshot: Edit | null
  past: Edit[]
  future: Edit[]

  exportOptions: ExportOptions
  isExporting: boolean

  openFile: (file: File) => Promise<void>

  startEdit: () => void
  setAdjustment: (key: AdjustmentKey, value: number) => void
  setGeometry: (patch: Partial<Geometry>) => void
  endEdit: () => void
  /** Applies a change and records it as a single history entry immediately. */
  commit: (patch: Partial<Edit>) => void
  resetAdjustments: () => void
  resetGeometry: () => void

  undo: () => void
  redo: () => void

  setExportOptions: (patch: Partial<ExportOptions>) => void
  setExporting: (value: boolean) => void
  notify: (notice: Notice | null) => void
}

function sameGeometry(a: Geometry, b: Geometry): boolean {
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

// Compared by value, not reference: a gesture that ends where it started should
// not leave an undo step that appears to do nothing.
function sameEdit(a: Edit, b: Edit): boolean {
  if (!sameGeometry(a.geometry, b.geometry)) return false
  return (Object.keys(a.adjustments) as AdjustmentKey[]).every(
    (k) => a.adjustments[k] === b.adjustments[k],
  )
}

function freshEdit(width: number, height: number): Edit {
  return { adjustments: { ...DEFAULT_ADJUSTMENTS }, geometry: defaultGeometry(width, height) }
}

export const useEditor = create<EditorState>((set, get) => ({
  image: null,
  status: 'empty',
  notice: null,

  edit: freshEdit(1, 1),
  snapshot: null,
  past: [],
  future: [],

  exportOptions: { format: 'image/jpeg', quality: 0.92, maxEdge: null },
  isExporting: false,

  async openFile(file) {
    const previous = get().image
    set({ status: 'loading', notice: null })
    try {
      const image = await loadImageFile(file)
      previous?.bitmap.close()
      set({
        image,
        status: 'ready',
        edit: freshEdit(image.bitmap.width, image.bitmap.height),
        snapshot: null,
        past: [],
        future: [],
        notice: image.downscaled
          ? {
              kind: 'info',
              message: `La imagen se redujo a ${image.bitmap.width}×${image.bitmap.height} px para poder procesarla en tu GPU.`,
            }
          : null,
      })
    } catch (error) {
      set({
        status: previous ? 'ready' : 'empty',
        notice: {
          kind: 'error',
          message: error instanceof Error ? error.message : 'No se pudo abrir la imagen.',
        },
      })
    }
  },

  startEdit() {
    if (get().snapshot) return
    set({ snapshot: get().edit })
  },

  setAdjustment(key, value) {
    set((state) => ({
      edit: { ...state.edit, adjustments: { ...state.edit.adjustments, [key]: value } },
    }))
  },

  setGeometry(patch) {
    set((state) => ({ edit: { ...state.edit, geometry: { ...state.edit.geometry, ...patch } } }))
  },

  endEdit() {
    const { snapshot, edit, past } = get()
    if (!snapshot) return
    if (sameEdit(snapshot, edit)) {
      set({ snapshot: null })
      return
    }
    set({ snapshot: null, past: [...past, snapshot].slice(-HISTORY_LIMIT), future: [] })
  },

  commit(patch) {
    const { edit, past } = get()
    const next = { ...edit, ...patch }
    if (sameEdit(edit, next)) return
    set({
      edit: next,
      snapshot: null,
      past: [...past, edit].slice(-HISTORY_LIMIT),
      future: [],
    })
  },

  resetAdjustments() {
    if (isDefault(get().edit.adjustments)) return
    get().commit({ adjustments: { ...DEFAULT_ADJUSTMENTS } })
  },

  resetGeometry() {
    const { image, edit } = get()
    if (!image) return
    const { width, height } = image.bitmap
    if (isDefaultGeometry(edit.geometry, width, height)) return
    get().commit({ geometry: defaultGeometry(width, height) })
  },

  undo() {
    const { past, future, edit } = get()
    const previous = past.at(-1)
    if (!previous) return
    set({
      edit: previous,
      past: past.slice(0, -1),
      future: [edit, ...future].slice(0, HISTORY_LIMIT),
      snapshot: null,
    })
  },

  redo() {
    const { past, future, edit } = get()
    const next = future[0]
    if (!next) return
    set({
      edit: next,
      past: [...past, edit].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      snapshot: null,
    })
  },

  setExportOptions(patch) {
    set((state) => ({ exportOptions: { ...state.exportOptions, ...patch } }))
  },

  setExporting(value) {
    set({ isExporting: value })
  },

  notify(notice) {
    set({ notice })
  },
}))
