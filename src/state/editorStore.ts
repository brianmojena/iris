import { create } from 'zustand'
import { DEFAULT_ADJUSTMENTS, isDefault, type AdjustmentKey } from '../types/adjustments'
import { defaultGeometry, isDefaultGeometry, type Geometry } from '../types/geometry'
import { freshEdit, normaliseEdit, sameEdit, type Edit } from '../types/edit'
import {
  cloneGrade,
  defaultGrade,
  isNeutralGrade,
  type Curve,
  type CurveChannel,
  type Wheel,
  type WheelKey,
} from '../types/grade'
import {
  cloneSecondary,
  defaultSecondary,
  qualifierFromColour,
  MAX_SECONDARIES,
  type Correction,
  type PowerWindow,
  type Qualifier,
  type Secondary,
} from '../types/secondary'
import { BUILT_IN_PRESETS, type Preset } from '../types/presets'
import { INITIAL_LABEL, describeChange, type StepLabel } from '../lib/describe'
import { dict, fill } from '../i18n'
import { loadImageFile, decodeBlob, type LoadedImage } from '../lib/decode'
import { LUMA, workingSpace, type ColorSpace } from '../lib/colorSpace'
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
  /** Structured, not worded: see StepLabel. */
  label: StepLabel
}

export interface EditorState {
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

  /**
   * Which secondary the panel and the canvas are both pointed at, and whether
   * the canvas is showing its matte instead of the picture.
   *
   * Deliberately not part of `Edit`: it is where the user is looking, not
   * something they did to the photograph, and it has no business in the history
   * or in a saved session.
   */
  gradeTab: 'primary' | 'selective'
  activeSecondary: string | null
  matteView: boolean
  /** The eyedropper is armed and the next tap on the photo will key off it. */
  picking: boolean

  exportOptions: ExportOptions
  isExporting: boolean

  restoreSession: () => Promise<void>
  openFile: (file: File) => Promise<void>

  startEdit: () => void
  setAdjustment: (key: AdjustmentKey, value: number) => void
  setGeometry: (patch: Partial<Geometry>) => void
  setWheel: (key: WheelKey, patch: Partial<Wheel>) => void
  setCurve: (channel: CurveChannel, curve: Curve) => void
  endEdit: () => void
  /** Applies a change and records it as a single history entry immediately. */
  commit: (patch: Partial<Edit>, label?: StepLabel) => void
  addSecondary: () => void
  removeSecondary: (id: string) => void
  setSecondary: (id: string, patch: Partial<Secondary>) => void
  setQualifier: (id: string, patch: Partial<Qualifier>) => void
  setWindow: (id: string, patch: Partial<PowerWindow>) => void
  setCorrection: (id: string, patch: Partial<Correction>) => void

  setGradeTab: (tab: 'primary' | 'selective') => void
  setActiveSecondary: (id: string | null) => void
  setMatteView: (value: boolean) => void
  setPicking: (value: boolean) => void
  /** Applied by the canvas once it has read the colour under the pointer. */
  pickColour: (rgb: [number, number, number]) => void

  resetAdjustments: () => void
  resetGrade: () => void
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

/**
 * The colour space a photo should export in unless told otherwise.
 *
 * It follows the picture rather than sticking as a preference, because unlike
 * format or quality this is not a matter of taste — it is a property of what is
 * in the file. A photo carrying colours sRGB cannot hold would lose them on the
 * way out; one that fits inside sRGB gains nothing from a wider tag and only
 * takes on the risk of some service stripping the profile and leaving the
 * numbers to be read as something they are not.
 */
function defaultColorSpace(image: LoadedImage): ColorSpace {
  return image.wideGamut ? 'display-p3' : 'srgb'
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

  gradeTab: 'primary',
  activeSecondary: null,
  matteView: false,
  picking: false,

  exportOptions: { format: 'image/jpeg', quality: 0.92, maxEdge: null, colorSpace: 'srgb' },
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
        // A session written by an older build has no grade in it; filling that
        // in here means the rest of the app never has to wonder.
        const history = saved.history.map((entry) => ({
          ...entry,
          edit: normaliseEdit(entry.edit, image.bitmap.width, image.bitmap.height),
        }))
        const index = Math.min(Math.max(saved.index, 0), history.length - 1)
        set({
          image,
          status: 'ready',
          edit: history[index].edit,
          history,
          index,
          snapshot: null,
          exportOptions: { ...get().exportOptions, colorSpace: defaultColorSpace(image) },
          notice: { kind: 'info', message: dict().notices.sessionRestored },
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
        exportOptions: { ...get().exportOptions, colorSpace: defaultColorSpace(image) },
        notice: image.downscaled
          ? {
              kind: 'info',
              message: fill(dict().notices.downscaled, {
                width: image.bitmap.width,
                height: image.bitmap.height,
              }),
            }
          : null,
      })
    } catch (error) {
      set({
        status: previous ? 'ready' : 'empty',
        notice: {
          kind: 'error',
          message: error instanceof Error ? error.message : dict().notices.openFailed,
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

  // Both of these replace the object rather than editing it in place: the
  // renderer decides whether to rebuild the curve table by comparing references,
  // and every history entry is holding one of these.
  setWheel(key, patch) {
    set((state) => ({
      edit: {
        ...state.edit,
        grade: {
          ...state.edit.grade,
          wheels: { ...state.edit.grade.wheels, [key]: { ...state.edit.grade.wheels[key], ...patch } },
        },
      },
    }))
  },

  setCurve(channel, curve) {
    set((state) => ({
      edit: {
        ...state.edit,
        grade: {
          ...state.edit.grade,
          curves: { ...state.edit.grade.curves, [channel]: curve },
        },
      },
    }))
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
    get().commit({ adjustments: { ...DEFAULT_ADJUSTMENTS } }, { kind: 'adjustmentsReset' })
  },

  // --- secondaries ---------------------------------------------------------

  addSecondary() {
    const { edit } = get()
    if (edit.grade.secondaries.length >= MAX_SECONDARIES) return
    const secondary = defaultSecondary(`s${Date.now().toString(36)}`)
    get().commit(
      {
        grade: {
          ...edit.grade,
          secondaries: [...edit.grade.secondaries, secondary],
        },
      },
      { kind: 'secondaryAdded', index: edit.grade.secondaries.length },
    )
    // A new secondary is one you are about to dial, so point everything at it.
    set({ activeSecondary: secondary.id, matteView: false })
  },

  removeSecondary(id) {
    const { edit } = get()
    const index = edit.grade.secondaries.findIndex((s) => s.id === id)
    if (index < 0) return
    const secondaries = edit.grade.secondaries.filter((s) => s.id !== id)
    get().commit({ grade: { ...edit.grade, secondaries } }, { kind: 'secondaryRemoved', index })
    set({
      activeSecondary: secondaries[Math.min(index, secondaries.length - 1)]?.id ?? null,
      matteView: false,
    })
  },

  setSecondary(id, patch) {
    patchSecondary(set, id, (s) => ({ ...s, ...patch }))
  },

  setQualifier(id, patch) {
    patchSecondary(set, id, (s) => ({ ...s, qualifier: { ...s.qualifier, ...patch } }))
  },

  setWindow(id, patch) {
    patchSecondary(set, id, (s) => ({ ...s, window: { ...s.window, ...patch } }))
  },

  setCorrection(id, patch) {
    patchSecondary(set, id, (s) => ({ ...s, correction: { ...s.correction, ...patch } }))
  },

  setGradeTab(tab) {
    set({ gradeTab: tab, matteView: tab === 'selective' ? get().matteView : false })
  },

  setActiveSecondary(id) {
    set({ activeSecondary: id })
  },

  setMatteView(value) {
    set({ matteView: value })
  },

  setPicking(value) {
    set({ picking: value })
  },

  pickColour(rgb) {
    const { activeSecondary, edit } = get()
    if (!activeSecondary) return
    const target = edit.grade.secondaries.find((s) => s.id === activeSecondary)
    if (!target) return
    set({ picking: false })
    // One shot, one step: this is a click, not a drag, so it records itself.
    get().startEdit()
    get().setQualifier(activeSecondary, qualifierFromColour(rgb, LUMA[workingSpace()]))
    get().endEdit()
  },

  resetGrade() {
    if (isNeutralGrade(get().edit.grade)) return
    get().commit({ grade: defaultGrade() }, { kind: 'gradeReset' })
    set({ activeSecondary: null, matteView: false })
  },

  resetGeometry() {
    const { image, edit } = get()
    if (!image) return
    const { width, height } = image.bitmap
    if (isDefaultGeometry(edit.geometry, width, height)) return
    get().commit({ geometry: defaultGeometry(width, height) }, { kind: 'geometryReset' })
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
        ...stored.map((p) => ({
          id: p.id,
          name: p.name,
          adjustments: p.adjustments,
          grade: p.grade,
          builtIn: false,
        })),
      ],
    })
  },

  applyPreset(preset) {
    // A preset is a whole look, grade included. One that carries no grade of its
    // own clears the wheels and curves rather than leaving somebody else's work
    // sitting underneath it.
    get().commit(
      {
        adjustments: { ...preset.adjustments },
        grade: preset.grade ? cloneGrade(preset.grade) : defaultGrade(),
      },
      { kind: 'preset', presetId: preset.id, name: preset.name },
    )
  },

  async createPreset(name) {
    const trimmed = name.trim()
    if (!trimmed) return
    const preset = {
      id: `user-${Date.now().toString(36)}`,
      name: trimmed,
      adjustments: { ...get().edit.adjustments },
      grade: cloneGrade(get().edit.grade),
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
 * Which secondary everything is pointed at, as an index into the list.
 *
 * One definition, used by both the panel and the canvas. `activeSecondary` is
 * transient — it does not survive a reload, and it can name a secondary that has
 * since been deleted — so the fallback to the first one has to be the same rule
 * in both places or the panel ends up editing one secondary while the canvas
 * draws the window of another.
 */
export function activeSecondaryIndex(state: EditorState): number {
  const list = state.edit.grade.secondaries
  if (list.length === 0) return -1
  const found = list.findIndex((s) => s.id === state.activeSecondary)
  return found >= 0 ? found : 0
}

/**
 * Rewrites one secondary in place, leaving the rest of the list alone.
 *
 * Like every other live edit this only touches `edit`; the history step is cut
 * by `endEdit` when the gesture finishes, so dragging a qualifier through fifty
 * values is still one thing to undo.
 */
function patchSecondary(
  set: (updater: (state: EditorState) => Partial<EditorState>) => void,
  id: string,
  change: (secondary: Secondary) => Secondary,
): void {
  set((state) => ({
    edit: {
      ...state.edit,
      grade: {
        ...state.edit.grade,
        secondaries: state.edit.grade.secondaries.map((s) =>
          s.id === id ? change(cloneSecondary(s)) : s,
        ),
      },
    },
  }))
}

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
  label: StepLabel,
): void {
  const { history, index } = get()
  const trimmed = [...history.slice(0, index + 1), { edit, label }].slice(-HISTORY_LIMIT)
  set({ history: trimmed, index: trimmed.length - 1 })
  scheduleSave(trimmed, trimmed.length - 1)
}
