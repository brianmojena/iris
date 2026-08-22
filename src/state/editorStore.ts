import { create } from 'zustand'
import {
  DEFAULT_ADJUSTMENTS,
  isDefault,
  type AdjustmentKey,
  type Adjustments,
} from '../types/adjustments'
import { loadImageFile, type LoadedImage } from '../lib/decode'
import type { ExportOptions } from '../lib/export'

const HISTORY_LIMIT = 100

export interface Notice {
  kind: 'error' | 'info'
  message: string
}

interface EditorState {
  image: LoadedImage | null
  status: 'empty' | 'loading' | 'ready'
  notice: Notice | null

  adjustments: Adjustments
  /** Snapshot taken when a drag starts, so the whole gesture is one undo step. */
  snapshot: Adjustments | null
  past: Adjustments[]
  future: Adjustments[]

  exportOptions: ExportOptions
  isExporting: boolean

  openFile: (file: File) => Promise<void>

  startEdit: () => void
  setAdjustment: (key: AdjustmentKey, value: number) => void
  endEdit: () => void
  /** Applies a whole new set at once and records a single history entry. */
  applyAdjustments: (next: Adjustments) => void
  resetAdjustments: () => void

  undo: () => void
  redo: () => void

  setExportOptions: (patch: Partial<ExportOptions>) => void
  setExporting: (value: boolean) => void
  notify: (notice: Notice | null) => void
}

function sameAdjustments(a: Adjustments, b: Adjustments): boolean {
  return (Object.keys(a) as AdjustmentKey[]).every((k) => a[k] === b[k])
}

export const useEditor = create<EditorState>((set, get) => ({
  image: null,
  status: 'empty',
  notice: null,

  adjustments: { ...DEFAULT_ADJUSTMENTS },
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
        adjustments: { ...DEFAULT_ADJUSTMENTS },
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
    set({ snapshot: { ...get().adjustments } })
  },

  setAdjustment(key, value) {
    set((state) => ({ adjustments: { ...state.adjustments, [key]: value } }))
  },

  endEdit() {
    const { snapshot, adjustments, past } = get()
    if (!snapshot) return
    if (sameAdjustments(snapshot, adjustments)) {
      set({ snapshot: null })
      return
    }
    set({ snapshot: null, past: [...past, snapshot].slice(-HISTORY_LIMIT), future: [] })
  },

  applyAdjustments(next) {
    const { adjustments, past } = get()
    if (sameAdjustments(adjustments, next)) return
    set({
      adjustments: next,
      snapshot: null,
      past: [...past, adjustments].slice(-HISTORY_LIMIT),
      future: [],
    })
  },

  resetAdjustments() {
    if (isDefault(get().adjustments)) return
    get().applyAdjustments({ ...DEFAULT_ADJUSTMENTS })
  },

  undo() {
    const { past, future, adjustments } = get()
    const previous = past.at(-1)
    if (!previous) return
    set({
      adjustments: previous,
      past: past.slice(0, -1),
      future: [adjustments, ...future].slice(0, HISTORY_LIMIT),
      snapshot: null,
    })
  },

  redo() {
    const { past, future, adjustments } = get()
    const next = future[0]
    if (!next) return
    set({
      adjustments: next,
      past: [...past, adjustments].slice(-HISTORY_LIMIT),
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
