import { create } from 'zustand'
import { DEFAULT_ADJUSTMENTS, isDefault, type AdjustmentKey } from '../types/adjustments'
import { defaultGeometry, isDefaultGeometry, type Geometry } from '../types/geometry'
import { sameEdit, type Edit } from '../types/edit'
import { BUILT_IN_PRESETS, type Preset } from '../types/presets'
import { INITIAL_LABEL, describeChange } from '../lib/describe'
import { loadImageFile, decodeBlob, type LoadedImage } from '../lib/decode'
import * as storage from '../lib/storage'
import type { ExportOptions } from '../lib/export'

const HISTORY_LIMIT = 200
/** How long the editor waits after the last change before writing to disk. */
const SAVE_DEBOUNCE_MS = 700

export type { Edit }

export interface Notice {
  kind: 'error' | 'info'
  message: string
}

export interface HistoryEntry {
  edit: Edit
  label: string
}

interface EditorState {
  image: LoadedImage | null
  status: 'empty' | 'loading' | 'ready'
  notice: Notice | null

  /** The live edit. Equal to history[index].edit except mid-drag. */
  edit: Edit
  /**
   * One list plus a pointer rather than two stacks: the history panel lets you
   * click any step, and jumping to an arbitrary index is what that needs.
   */
  history: HistoryEntry[]
  index: number
  /** Snapshot taken when a drag starts, so the whole gesture is one undo step. */
  snapshot: Edit | null

  presets: Preset[]

  exportOptions: ExportOptions
  isExporting: boolean

  restoreSession: () => Promise<void>
  openFile: (file: File) => Promise<void>

  startEdit: () => void
  setAdjustment: (key: AdjustmentKey, value: number) => void
  setGeometry: (patch: Partial<Geometry>) => void
  endEdit: () => void
  /** Applies a change and records it as a single history entry immediately. */
  commit: (patch: Partial<Edit>, label?: string) => void
  resetAdjustments: () => void
  resetGeometry: () => void

  undo: () => void
  redo: () => void
  jumpTo: (index: number) => void

  loadPresets: () => Promise<void>
  applyPreset: (preset: Preset) => void
  createPreset: (name: string) => Promise<void>
  removePreset: (id: string) => Promise<void>

  setExportOptions: (patch: Partial<ExportOptions>) => void
  setExporting: (value: boolean) => void
  notify: (notice: Notice | null) => void
}

function freshEdit(width: number, height: number): Edit {
  return { adjustments: { ...DEFAULT_ADJUSTMENTS }, geometry: defaultGeometry(width, height) }
}

/** The file the current session was restored from or opened with. */
let sessionFile: { blob: Blob; name: string } | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
/**
 * Guards the restore against a second caller.
 *
 * The check for an already-loaded image happens before the first await, so two
 * calls arriving together both get past it — which React's StrictMode does on
 * every mount in development. Decoding twice is wasted work, and on a HEIC
 * session that is eight seconds of it.
 */
let restoring: Promise<void> | null = null

/**
 * Writes the session after things go quiet.
 *
 * Saving on every slider tick would mean serialising a multi-megabyte blob
 * dozens of times a second; waiting for a pause costs nothing the user can feel
 * and turns a storm of writes into one.
 */
function scheduleSave(history: HistoryEntry[], index: number): void {
  if (!sessionFile) return
  clearTimeout(saveTimer)
  const { blob, name } = sessionFile
  saveTimer = setTimeout(() => {
    void storage.saveSession({ file: blob, fileName: name, history, index, savedAt: Date.now() })
  }, SAVE_DEBOUNCE_MS)
}

export const useEditor = create<EditorState>((set, get) => ({
  image: null,
  status: 'empty',
  notice: null,

  edit: freshEdit(1, 1),
  history: [{ edit: freshEdit(1, 1), label: INITIAL_LABEL }],
  index: 0,
  snapshot: null,

  presets: BUILT_IN_PRESETS,

  exportOptions: { format: 'image/jpeg', quality: 0.92, maxEdge: null },
  isExporting: false,

  restoreSession() {
    if (restoring) return restoring
    restoring = (async () => {
      const saved = await storage.loadSession()
      if (!saved || get().image) return
      set({ status: 'loading' })
      try {
        const image = await decodeBlob(saved.file, saved.fileName)
        sessionFile = { blob: saved.file, name: saved.fileName }
        const index = Math.min(Math.max(saved.index, 0), saved.history.length - 1)
        set({
          image,
          status: 'ready',
          edit: saved.history[index].edit,
          history: saved.history,
          index,
          snapshot: null,
          notice: { kind: 'info', message: 'Recuperada la sesión anterior.' },
        })
      } catch {
        // A session we cannot decode is worse than no session.
        void storage.clearSession()
        set({ status: 'empty' })
      }
    })()
    return restoring
  },

  async openFile(file) {
    const previous = get().image
    set({ status: 'loading', notice: null })
    try {
      const image = await loadImageFile(file)
      previous?.bitmap.close()
      const edit = freshEdit(image.bitmap.width, image.bitmap.height)
      const history = [{ edit, label: INITIAL_LABEL }]
      sessionFile = { blob: file, name: file.name }
      clearTimeout(saveTimer)
      void storage.saveSession({ file, fileName: file.name, history, index: 0, savedAt: Date.now() })
      set({
        image,
        status: 'ready',
        edit,
        history,
        index: 0,
        snapshot: null,
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
    const { snapshot, edit } = get()
    if (!snapshot) return
    set({ snapshot: null })
    if (sameEdit(snapshot, edit)) return
    record(set, get, edit, describeChange(snapshot, edit))
  },

  commit(patch, label) {
    const { edit } = get()
    const next = { ...edit, ...patch }
    if (sameEdit(edit, next)) return
    set({ edit: next, snapshot: null })
    record(set, get, next, label ?? describeChange(edit, next))
  },

  resetAdjustments() {
    if (isDefault(get().edit.adjustments)) return
    get().commit({ adjustments: { ...DEFAULT_ADJUSTMENTS } }, 'Ajustes restablecidos')
  },

  resetGeometry() {
    const { image, edit } = get()
    if (!image) return
    const { width, height } = image.bitmap
    if (isDefaultGeometry(edit.geometry, width, height)) return
    get().commit({ geometry: defaultGeometry(width, height) }, 'Encuadre restablecido')
  },

  undo() {
    get().jumpTo(get().index - 1)
  },

  redo() {
    get().jumpTo(get().index + 1)
  },

  jumpTo(index) {
    const { history } = get()
    if (index < 0 || index >= history.length) return
    set({ index, edit: history[index].edit, snapshot: null })
    scheduleSave(history, index)
  },

  async loadPresets() {
    const stored = await storage.listPresets()
    set({
      presets: [
        ...BUILT_IN_PRESETS,
        ...stored.map((p) => ({ id: p.id, name: p.name, adjustments: p.adjustments, builtIn: false })),
      ],
    })
  },

  applyPreset(preset) {
    get().commit({ adjustments: { ...preset.adjustments } }, `Preajuste: ${preset.name}`)
  },

  async createPreset(name) {
    const trimmed = name.trim()
    if (!trimmed) return
    const preset = {
      id: `user-${Date.now().toString(36)}`,
      name: trimmed,
      adjustments: { ...get().edit.adjustments },
      createdAt: Date.now(),
    }
    await storage.savePreset(preset)
    await get().loadPresets()
  },

  async removePreset(id) {
    await storage.deletePreset(id)
    await get().loadPresets()
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

/**
 * Appends a step, discarding anything that was ahead of the pointer.
 *
 * Editing after an undo abandons the branch you had undone, which is what every
 * editor does and what people expect.
 */
function record(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  edit: Edit,
  label: string,
): void {
  const { history, index } = get()
  const trimmed = [...history.slice(0, index + 1), { edit, label }].slice(-HISTORY_LIMIT)
  set({ history: trimmed, index: trimmed.length - 1 })
  scheduleSave(trimmed, trimmed.length - 1)
}
