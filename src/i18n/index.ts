import { create } from 'zustand'
import { es, type Dictionary } from './es'
import { en } from './en'

export type LocaleCode = 'es' | 'en'

const DICTIONARIES: Record<LocaleCode, Dictionary> = { es, en }
export const LOCALES: LocaleCode[] = ['es', 'en']

const STORAGE_KEY = 'iris.locale'

/**
 * Honours an explicit choice first, then the browser's own preference. Anything
 * that is not Spanish falls to English, which is the wider net of the two.
 */
function detect(): LocaleCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'es' || saved === 'en') return saved
  } catch {
    /* storage can be blocked; the browser language still works */
  }
  const preferred = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return preferred.toLowerCase().startsWith('es') ? 'es' : 'en'
}

interface LocaleState {
  locale: LocaleCode
  dictionary: Dictionary
  setLocale: (locale: LocaleCode) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detect(),
  dictionary: DICTIONARIES[detect()],
  setLocale(locale) {
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      /* the choice just will not survive a reload */
    }
    document.documentElement.lang = locale
    set({ locale, dictionary: DICTIONARIES[locale] })
  },
}))

/** For React. Re-renders the component when the language changes. */
export function useDict(): Dictionary {
  return useLocaleStore((state) => state.dictionary)
}

export function useLocale(): LocaleCode {
  return useLocaleStore((state) => state.locale)
}

/**
 * For everything that is not a component — the store, the decoder, the renderer.
 * Reads the language at the moment it is called, which is what an error message
 * wants: the words the user is reading right now.
 */
export function dict(): Dictionary {
  return useLocaleStore.getState().dictionary
}

export function currentLocale(): LocaleCode {
  return useLocaleStore.getState().locale
}

/** Fills `{name}` placeholders. Deliberately the whole templating engine. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}

/**
 * Numbers in the reader's own convention: Spanish writes 0,60 where English
 * writes 0.60. Slider readouts are full of these, and getting it wrong is the
 * kind of small wrongness that makes an interface feel translated rather than
 * written.
 */
export function formatNumber(value: number, decimals: number, locale?: string): string {
  return format(value, decimals, locale, value === 0 ? 'never' : 'exceptZero')
}

/**
 * The same, without the leading sign. For quantities that are counts rather than
 * offsets — a percentage of clipped pixels is not "+2,3 %" of anything.
 */
export function formatPlain(value: number, decimals: number, locale?: string): string {
  return format(value, decimals, locale, 'never')
}

function format(
  value: number,
  decimals: number,
  locale: string | undefined,
  signDisplay: 'never' | 'exceptZero',
): string {
  const resolved = locale ?? currentLocale()
  return new Intl.NumberFormat(resolved === 'es' ? 'es-ES' : 'en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay,
  }).format(value)
}
