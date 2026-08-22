# Iris

*English · [Español](README.es.md)*

A photo editor that runs entirely in your browser. No server, no accounts, and no
image ever leaves your device.

**[Try it →](https://brianmojena.github.io/iris/)**

```bash
npm install
npm run dev
```

## What it does

Fifteen controls across light, colour, detail and effects. Colour-managed:
it works in Display P3, so a wide-gamut photo keeps the colours it arrived with. A crop editor with
fixed ratios, straightening, quarter turns and flips. A navigable history panel.
Your own presets alongside six that ship with it. Your session comes back on its
own when you return. The interface speaks English and Spanish.

## How it is built

Everything happens on the GPU. The edit itself is a flat, serialisable object
(`src/types/adjustments.ts`); no tool touches pixels, they only write into that
object. Non-destructive editing, history and presets all fall out of that for
free.

```
src/
  engine/
    Renderer.ts              GL context, source texture, the chain of passes
    gl/program.ts            compile, link, cache uniform locations
    gl/target.ts             off-screen surfaces between passes
    shaders/                 the pipeline, in GLSL
  i18n/                      dictionaries and language detection
  lib/
    decode.ts                opening files, HEIC, EXIF orientation
    storage.ts               session and presets in IndexedDB
    describe.ts              names each history step from the diff
    export.ts                full-size render and download
    matrix.ts                3×3 affine, in the order WebGL expects
    crop.ts                  handle dragging and aspect ratios
  types/geometry.ts          framing: turns, flips, straightening, crop
  state/editorStore.ts       state, history, undo and redo
  components/                the interface
```

Preview and export go through the **same** `Renderer` at different sizes. There
is no second render path that could drift from what you see on screen.

### The colour pipeline

The order mirrors a raw processor:

1. Decode to linear light.
2. Exposure and white balance, which only mean anything physical in linear.
3. Encode back to display gamma.
4. Tonal range, contrast and saturation, which are perceptual.

Three decisions that were expensive to arrive at, all documented in the shader:

- Tone controls move **luminance** and rebuild the colour by scaling. Adding a
  flat offset looks simpler but sends apparent chroma through the roof when
  highlights are recovered.
- That scaling is **capped when brightening** (`MAX_GAIN`). Without the cap,
  lifting a near-black pixel demands a factor of 20 or more, the channels clip at
  different points and the hue flips.
- Chroma **decays with how far the pixel travelled**. Keeping it intact while
  compressing the range produces a textbook neon split-tone.

### The framing

Crop, rotation, flip and straightening all resolve into **a single 3×3 matrix**
that the shader applies to texture coordinates. No pixels are moved and there are
no intermediate steps: the image is sampled once, from the original, whatever the
combination of transforms. The angled edge left by straightening is smoothed with
`fwidth`, which gives the footprint of one output pixel measured in source space.

Two decisions that are not obvious:

- `geometry.crop` stores **what the user asked for**, not what is shown. The real
  framing is computed on the fly by fitting it to the tilted rectangle. If the
  stored value were trimmed instead, moving the straighten slider back and forth
  would eat the photo a slice at a time, because fitting only knows how to
  shrink.
- The flip is applied **after** the quarter turns, so "flip horizontally" always
  mirrors left-to-right on screen no matter how many turns have accumulated. It
  also negates the straightening angle, so the whole composition is mirrored and
  not just its contents.

### The passes

Colour resolves in a single pass. Sharpening, noise reduction and blur cannot:
they need neighbouring pixels, so when any of them is in play the chain grows —
colour into an off-screen texture, then the spatial passes, then a final pass to
the screen. Passes with nothing to do are skipped, so a photo with no effects
still costs a single `drawArrays`. With the full chain at 3 MP, dragging a slider
holds 60 fps.

The intermediate surfaces are eight bits per channel on purpose. Half floats
would carry a little more precision, but a 24 megapixel export needs three of
them live at once, and at eight bytes per pixel that is over half a gigabyte of
GPU memory for a file the user expects to simply save.

Two details that were expensive to find:

- Drawing into a framebuffer **flips Y** relative to drawing into the canvas. The
  vertex shader flips the coordinate to compensate for bitmaps being stored top
  down; with two passes that flip was applied once too often. It is a uniform
  now, and only the pass that reads the original bitmap flips.
- Grain is attenuated by the preview's downscaling. Without that, the preview
  showed far heavier grain than the exported file ended up with.

And a correction: during development a shift in mean brightness was blamed on the
noise hash, and that was **wrong**. It was caused by the Y flip above — the
measurement was reading a region that, inverted, showed different content. The
tests in phase 6 exposed it by showing that the "bad" hash fails nothing. The
current hash stays for a different and honest reason: the precision of `sin()`
varies between drivers, and avoiding it makes grain reproducible on any GPU.

### Colour management

Iris works in **Display P3** wherever the browser allows it. P3 contains sRGB
entirely, so an ordinary photo loses nothing by being processed there, while a
photo from a modern phone keeps the colours it actually has.

What was actually broken was narrower than it looked. Decoding was already fine:
`createImageBitmap` with `colorSpaceConversion: 'default'` preserves the source
gamut — it is `'none'` that loses it, by handing back raw values stripped of the
tag that said what they meant. The loss happened later, in WebGL: a drawing
buffer defaults to sRGB, so a pure P3 red reached the screen as
`[233, 52, 36]` instead of `[255, 0, 0]`. Every adjustment was then being made
against a rendition the file never contained.

Setting `drawingBufferColorSpace` and `unpackColorSpace` fixes it. Two details
came with that:

- **Luminance weights depend on the primaries.** Every tone control works on
  luminance, and P3's weights are `(0.229, 0.692, 0.079)` against sRGB's
  `(0.213, 0.715, 0.072)`. They are a uniform now, not a constant in the shader.
- **Export renders in the working space and converts afterwards**, never by
  changing what the pipeline computed. Preview and export keep running identical
  shader maths; only the final encoding differs.

Export defaults to **sRGB**, because that is what every previous export was and
what every viewer handles. Display P3 is one click away, and the dialog says so
only when the photo really does hold colours sRGB would clip — a warning that
fires on every photo is a warning nobody reads. That test measures actual pixel
content rather than trusting the ICC tag, because plenty of P3-tagged files sit
entirely inside sRGB and lose nothing on the way out.

### History and the session

History is **one list with a pointer**, not two stacks. Undo and redo move the
pointer; the panel lets you jump to any step by clicking it. Editing from a
middle point discards the branch that was ahead, which is what every editor does
and what people expect.

Each step's label — "Exposure +0.30", "Rotated right" — is **derived from the
diff** between states rather than passed in by hand at every call site. A label
written by hand eventually tells a different story from what the step did.

Closing the tab saves the original file, exactly as it arrived, to IndexedDB
along with the complete list of steps. Saving only the final state would bring
the photo back but leave undo pointing at nothing, and "you are where you left
off" would stop being true the moment you pressed ⌘Z. Writes are debounced:
saving on every slider tick would mean serialising a multi-megabyte blob dozens
of times a second.

Storage is a convenience, never a requirement. In private browsing, with a full
disk, or with IndexedDB disabled, every operation swallows its failure and the
editor carries on in memory.

### The languages

No library: one typed dictionary per language, about 130 strings. Spanish is the
source of truth and English is typed against its shape, so **forgetting a
translation is a build error** rather than a blank label in production. The
browser's language is detected and an explicit choice is remembered.

What required actual thought:

- History labels are **written to disk**, so they cannot be finished text: a
  session recorded in Spanish would still be speaking Spanish after a switch to
  English. What is stored is a descriptor — which control, which value — and the
  panel turns it into words as it draws.
- Numbers are written differently in each language. Controls show `+0,60` in
  Spanish and `+0.60` in English, via `Intl.NumberFormat`. It is the kind of
  small wrongness that makes an interface feel translated rather than written.

## Tests

```bash
npx playwright install chromium   # once
npm test
```

Thirty-seven tests running in a headless Chromium, in under a second. There are
no interface tests: the risk in this project lives in the shaders and the
geometry, and there is nothing meaningful to assert about those in a simulated
DOM. Each test renders a known image through the same path the export button uses
and checks pixel statistics.

Test images are built in code from a seeded generator rather than committed as
files: a binary in the repository is opaque in review and drifts from whatever it
was meant to prove.

The tests were validated by **reintroducing the real bugs** that came up during
development, to confirm they fail when they should. That exercise found two
things: the grain test was detecting nothing, because it measured across a
gradient whose own slope masked the bias; and one of the diagnoses in this README
was false (see the note under "The passes").

## Formats

In: JPEG, PNG, WebP, AVIF, and HEIC from an iPhone. HEIC decoding uses
WebAssembly loaded on demand — about 700 KB gzipped, downloaded only the first
time you open such a file.

Out: JPEG, WebP or PNG, with quality and maximum size configurable. The size
shown in the dialog is the real one, not an estimate.

Images beyond the GPU's maximum texture size are reduced on opening, and you are
told so.

## Shortcuts

| | |
|---|---|
| `⌘Z` / `⇧⌘Z` | Undo and redo |
| `⌘E` | Export |
| `\` | Hold to see the original |
| `C` | Enter and leave the crop editor |
| `Esc` | Leave the crop editor |
| Double-click a slider | Return it to its default |
| Double-click the photo | Toggle between fit and 200% |
| `←` `→` on a slider | Fine adjustment (`⇧` for steps of ten) |
| Paste | Opens an image from the clipboard |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: the pipeline is the
interesting part, the tests are fast, and comments explain *why* rather than
what.

## Licence

[MIT](LICENSE) — Copyright (c) 2026 Brian Mojena.

Use it, modify it and distribute it freely, commercially included. All that is
asked is that you keep the copyright notice.
