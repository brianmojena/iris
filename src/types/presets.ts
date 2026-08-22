import { DEFAULT_ADJUSTMENTS, type Adjustments } from './adjustments'

export interface Preset {
  id: string
  name: string
  adjustments: Adjustments
  /** Factory presets ship with the app and cannot be deleted or overwritten. */
  builtIn: boolean
}

function preset(id: string, name: string, changes: Partial<Adjustments>): Preset {
  return { id, name, adjustments: { ...DEFAULT_ADJUSTMENTS, ...changes }, builtIn: true }
}

/**
 * A handful of starting points so the panel is not empty on first run.
 *
 * Deliberately restrained: every one of these is something a photographer would
 * reach for, not a filter that stamps a look over the picture. They are stored
 * as complete adjustment sets so that applying one is a single history step and
 * never depends on what was already set.
 */
export const BUILT_IN_PRESETS: Preset[] = [
  preset('warm', 'Cálido', {
    temperature: 18,
    vibrance: 14,
    highlights: -12,
    shadows: 10,
  }),
  preset('cool', 'Frío', {
    temperature: -20,
    tint: -6,
    contrast: 8,
    blacks: -8,
  }),
  preset('punch', 'Contrastado', {
    contrast: 32,
    highlights: -22,
    shadows: 18,
    whites: 12,
    blacks: -14,
    vibrance: 18,
    sharpness: 30,
  }),
  preset('matte', 'Mate', {
    contrast: -14,
    blacks: 26,
    highlights: -10,
    saturation: -12,
    grain: 18,
  }),
  preset('bw', 'Blanco y negro', {
    saturation: -100,
    contrast: 20,
    highlights: -16,
    shadows: 14,
    sharpness: 25,
  }),
  preset('film', 'Película', {
    contrast: 12,
    blacks: 16,
    temperature: 8,
    vibrance: -8,
    saturation: 6,
    grain: 34,
    vignette: 22,
  }),
]
