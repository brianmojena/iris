# Contributing to Iris

Thanks for looking. This file exists so you can be useful quickly without having
to reverse-engineer the reasoning first.

## Getting set up

```bash
npm install
npm run dev                       # http://localhost:5173
npx playwright install chromium   # once, for the tests
npm test
```

Three commands have to pass before a pull request is ready:

```bash
npm run typecheck
npm test
npm run build
```

There is no CI running these for you. The deploy workflow type-checks as part of
its build, so a type error will block a deploy, but nothing runs the test suite
except you. Please actually run it.

## Where things are

The interesting part is the render pipeline. Everything else is a control surface
attached to it.

An edit is a **serialisable object** — `Adjustments`, `Grade` and `Geometry`. No
tool anywhere touches pixels; tools write into that object and the renderer reads
it. If you find yourself wanting to mutate image data directly, that is a strong
sign the change belongs in a shader instead.

```
src/engine/     the GPU: context, passes, GLSL
src/types/      the edit model — adjustments, grade, geometry, presets
src/lib/        decoding, storage, export, maths, curves, scopes, labels
src/state/      one Zustand store: edit, history, session
src/i18n/       dictionaries and language detection
src/components/ the interface
tests/          render regression, in a real browser
```

Everything renders in the working colour space — Display P3 where the browser
supports it, sRGB otherwise. Anything that reads pixels back has to say which
space it wants them in, or the numbers will not mean what you assume.

Preview and export run through the same `Renderer` at different sizes. Please
keep it that way — a second render path is a second thing to keep in sync, and it
will eventually disagree with what the user was looking at.

### Adding an adjustment

1. Add the key to `Adjustments` and `DEFAULT_ADJUSTMENTS`.
2. Add a spec to `ADJUSTMENT_SPECS` with its range and group.
3. Add its label to **both** dictionaries in `src/i18n/`. Leaving one out is a
   type error, so you will not forget.
4. Add the uniform to the relevant shader and wire it in `Renderer`.
5. Add a test that asserts the direction it moves the image.

Nothing else. The panel, the history label, the persistence and the undo all pick
it up on their own.

### Adding a language

Copy `src/i18n/es.ts`, translate the values, and register it in
`src/i18n/index.ts`. The dictionary is typed against the Spanish one, so a
missing key will not compile. Numbers go through `Intl.NumberFormat`, so decimal
separators follow automatically.

## Tests

Tests run in a headless Chromium because the pipeline is WebGL2 and there is
nothing to assert about it in a simulated DOM. Each test renders a known image
through the export path and checks pixel statistics.

Two habits worth keeping:

**Build fixtures in code.** `tests/fixtures.ts` generates images from a seeded
generator. A committed binary is opaque in review and drifts from what it was
meant to prove.

**Prove the test can fail.** Before trusting a new regression test, reintroduce
the bug and confirm it goes red. This is not ceremony — doing it here found a
grain test that detected nothing, because it measured across a gradient whose own
slope masked exactly the bias it was looking for. A test that cannot fail is
worse than no test, because it buys confidence it has not earned.

Thresholds should be placed where they actually separate correct from broken, and
the comment should say where the measured values sit on either side. Tightening a
threshold until it passes is how a suite becomes decorative.

## Style

The code is in English; the interface speaks whatever the dictionaries say.

Comments explain **why**, not what. The what is already in the code. A comment
earns its place when it records a decision someone would otherwise undo — a cap
that looks arbitrary, an ordering that looks accidental, a workaround for
something surprising. There are several of these in the shaders and each one cost
real time to learn.

Prefer deleting a comment that restates the line below it.

## Pull requests

Say what changed and why. If it touches the pipeline, say what you rendered to
convince yourself it works — a number is worth more than an adjective.

Small and focused beats large and complete. If a change needs a paragraph of
justification, that paragraph belongs in the commit message.
