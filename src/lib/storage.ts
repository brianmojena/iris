import type { Edit } from '../types/edit'
import type { StepLabel } from './describe'

const DATABASE = 'iris'
const VERSION = 1
const SESSION_STORE = 'session'
const PRESET_STORE = 'presets'
const SESSION_KEY = 'current'

export interface StoredSession {
  /** The file exactly as it arrived, so a restore is bit-identical. */
  file: Blob
  fileName: string
  /**
   * The whole step list, not just the final state. Restoring without it would
   * bring the picture back but leave undo pointing at nothing, and "you are
   * where you left off" would stop being true the moment you pressed ⌘Z.
   * Plain JSON: a couple of hundred kilobytes at the history limit.
   */
  history: { edit: Edit; label: StepLabel }[]
  index: number
  savedAt: number
}

export interface StoredPreset {
  id: string
  name: string
  /** Only colour and effects; a preset must never move somebody's crop. */
  adjustments: Edit['adjustments']
  createdAt: number
}

let connection: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE)
      if (!db.objectStoreNames.contains(PRESET_STORE)) {
        db.createObjectStore(PRESET_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return connection
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = action(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

/**
 * Storage is a convenience, never a requirement.
 *
 * Private browsing, a full disk or a browser that refuses IndexedDB must not
 * stop somebody editing a photo, so every call here swallows its failure and
 * the editor carries on in memory.
 */
async function attempt<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

export function saveSession(session: StoredSession): Promise<void> {
  return attempt(
    () => run(SESSION_STORE, 'readwrite', (s) => s.put(session, SESSION_KEY)).then(() => undefined),
    undefined,
  )
}

export function loadSession(): Promise<StoredSession | null> {
  return attempt(
    () => run<StoredSession | undefined>(SESSION_STORE, 'readonly', (s) => s.get(SESSION_KEY)),
    undefined,
  ).then((value) => value ?? null)
}

export function clearSession(): Promise<void> {
  return attempt(
    () => run(SESSION_STORE, 'readwrite', (s) => s.delete(SESSION_KEY)).then(() => undefined),
    undefined,
  )
}

export function listPresets(): Promise<StoredPreset[]> {
  return attempt(
    () => run<StoredPreset[]>(PRESET_STORE, 'readonly', (s) => s.getAll()),
    [],
  ).then((presets) => presets.sort((a, b) => a.createdAt - b.createdAt))
}

export function savePreset(preset: StoredPreset): Promise<void> {
  return attempt(
    () => run(PRESET_STORE, 'readwrite', (s) => s.put(preset)).then(() => undefined),
    undefined,
  )
}

export function deletePreset(id: string): Promise<void> {
  return attempt(
    () => run(PRESET_STORE, 'readwrite', (s) => s.delete(id)).then(() => undefined),
    undefined,
  )
}
