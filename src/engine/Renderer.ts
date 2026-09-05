import { Program } from './gl/program'
import { RenderTarget } from './gl/target'
import { QUAD_VERT } from './shaders/quad.vert'
import { ADJUSTMENTS_FRAG } from './shaders/adjustments.frag'
import { DENOISE_FRAG } from './shaders/denoise.frag'
import { BLUR_FRAG } from './shaders/blur.frag'
import { FINISH_FRAG } from './shaders/finish.frag'
import { needsEffectPasses, type Adjustments } from '../types/adjustments'
import { outputSize, sourceTransform, type CropRect } from '../types/geometry'
import type { Edit } from '../types/edit'
import { CURVE_SIZE, defaultGrade, hasCurves, hasWheels, wheelUniforms, type Curves } from '../types/grade'
import { secondaryUniforms } from '../types/secondary'
import { curveTexture } from '../lib/curve'
import { dict } from '../i18n'
import { LUMA, workingSpace, type ColorSpace } from '../lib/colorSpace'

/** Blur radius in source pixels when the slider is at 100. */
const MAX_BLUR_RADIUS = 40

/** Longest edge of the proxy the scopes measure. */
const SCOPE_EDGE = 224

/**
 * Texture units. Named rather than written as bare numbers because binding is
 * global state: a texture uploaded while the wrong unit is active replaces
 * whatever that unit was holding, and the photograph is what unit 0 holds.
 */
const IMAGE_UNIT = 0
const CURVE_UNIT = 1

/**
 * Slider units are chosen for humans; the shader wants -1..1. This is the only
 * place that knows about the conversion.
 */
function toUniforms(a: Adjustments) {
  return {
    u_exposure: a.exposure,
    u_contrast: a.contrast / 100,
    u_highlights: a.highlights / 100,
    u_shadows: a.shadows / 100,
    u_whites: a.whites / 100,
    u_blacks: a.blacks / 100,
    u_temperature: a.temperature / 100,
    u_tint: a.tint / 100,
    u_vibrance: a.vibrance / 100,
    u_saturation: a.saturation / 100,
  }
}

export class RendererError extends Error {}

export interface RenderOptions {
  bypass?: boolean
  cropOverride?: CropRect
  /**
   * Draws one secondary's matte in black and white instead of the picture. It is
   * the only way to see what a key is actually selecting, and every grading desk
   * has the same button.
   */
  matteView?: number | null
  /** Stops before the secondaries. The colour picker reads what they key on. */
  primaryOnly?: boolean
}

/** Raw pixels of the graded image at thumbnail size, for the scopes. */
export interface ScopeSample {
  data: Uint8Array
  width: number
  height: number
}

/**
 * Owns the GL context and every pass the editor can run.
 *
 * The renderer keeps the *full resolution* image in a texture and draws it into
 * whatever viewport it is given. Screen preview and final export are therefore
 * the exact same code path at different sizes — there is no second "export
 * renderer" that could drift out of sync with what the user sees.
 *
 * Colour work is one pass. Sharpening, denoise and blur need neighbouring
 * pixels, so when any of them is in play the chain grows: colour into an
 * off-screen target, then the spatial passes, then a final pass to the screen.
 * Passes that have nothing to do are skipped, so an untouched photo still costs
 * a single draw.
 */
export class Renderer {
  private readonly gl: WebGL2RenderingContext
  private readonly base: Program
  private readonly denoise: Program
  private readonly blur: Program
  private readonly finish: Program
  private readonly vao: WebGLVertexArrayObject
  private readonly targets: RenderTarget[] = []
  private texture: WebGLTexture | null = null
  private sourceWidth = 0
  private sourceHeight = 0

  /** The baked curve table, and the object it was baked from. */
  private curveLut: WebGLTexture | null = null
  private curveSource: Curves | null = null
  private scopeTarget: RenderTarget | null = null

  private readonly colorSpace: ColorSpace

  /**
   * `colorSpace` is the space the drawing buffer presents in and that uploaded
   * images are converted to. It defaults to the widest the browser supports;
   * the export path overrides it only when asked for something narrower.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    colorSpace: ColorSpace = workingSpace(),
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null

    if (!gl) throw new RendererError(dict().notices.noWebgl)
    this.gl = gl
    this.colorSpace = colorSpace

    // Without these two the buffer is sRGB, and a wide-gamut photo is silently
    // rendered as its nearest sRGB neighbour. Guarded because older browsers do
    // not know the properties at all.
    try {
      if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = colorSpace
      if ('unpackColorSpace' in gl) gl.unpackColorSpace = colorSpace
    } catch {
      /* stays sRGB, which is the correct fallback */
    }

    this.base = new Program(gl, QUAD_VERT, ADJUSTMENTS_FRAG)
    this.denoise = new Program(gl, QUAD_VERT, DENOISE_FRAG)
    this.blur = new Program(gl, QUAD_VERT, BLUR_FRAG)
    this.finish = new Program(gl, QUAD_VERT, FINISH_FRAG)

    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new RendererError(dict().notices.gpuMemory)

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    // Two triangles covering clip space.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.vao = vao

    // Built even when no curve has been drawn: the sampler is bound on every
    // pass, and a sampler pointing at nothing is undefined behaviour on some
    // drivers even inside a branch that is never taken.
    this.curveLut = gl.createTexture()
    if (!this.curveLut) throw new RendererError(dict().notices.textureFailed)
    this.bindTexture(CURVE_UNIT, this.curveLut)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    this.uploadCurves(defaultGrade().curves)
  }

  get width(): number {
    return this.sourceWidth
  }

  get height(): number {
    return this.sourceHeight
  }

  get hasImage(): boolean {
    return this.texture !== null
  }

  /** Uploads a decoded image. Replaces whatever was loaded before. */
  setImage(source: ImageBitmap): void {
    const gl = this.gl
    this.disposeTexture()

    const texture = gl.createTexture()
    if (!texture) throw new RendererError(dict().notices.textureFailed)

    this.bindTexture(IMAGE_UNIT, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    this.texture = texture
    this.sourceWidth = source.width
    this.sourceHeight = source.height
  }

  /**
   * Draws the current image into a canvas of `width`×`height` device pixels.
   *
   * `geometry` decides which part of the source lands on screen; omit it and the
   * whole image is drawn untransformed. `cropOverride` renders a different
   * rectangle than the one stored — the crop editor uses it to show the entire
   * straightened image while the stored crop is still just a selection.
   * `bypass` skips the colour pipeline for the before/after comparison.
   */
  render(edit: Edit, width: number, height: number, options: RenderOptions = {}): void {
    if (!this.texture) return
    const adjustments = edit.adjustments

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    // The comparison view shows the untouched original, effects included. The
    // matte view skips the spatial chain too: grain and a vignette laid over a
    // mask would be describing the picture, not the selection.
    const spatial =
      !options.bypass && options.matteView == null && needsEffectPasses(adjustments)

    if (!spatial) {
      this.toScreen(width, height)
      this.drawBase(edit, width, height, options, true)
      return
    }

    // Full resolution of the framed result, so blur and grain look the same in
    // the preview as they will in the exported file.
    const full = outputSize(edit.geometry, this.sourceWidth, this.sourceHeight).width
    const pixelScale = width / Math.max(full, 1)

    const targets = this.ensureTargets(adjustments, width, height)

    targets[0].bind()
    this.drawBase(edit, width, height, options, false)
    let current = targets[0]

    if (adjustments.denoise > 0) {
      targets[1].bind()
      this.denoise.use()
      this.denoise.setFloat('u_flipY', 0)
      this.bindTexture(0, current.texture)
      this.denoise.setInt('u_image', 0)
      this.denoise.setVec2('u_texel', 1 / width, 1 / height)
      this.denoise.setFloat('u_amount', adjustments.denoise / 100)
      this.draw()
      current = targets[1]
    }

    let blurred = current
    if (adjustments.blur > 0) {
      // Radius is defined against the exported size, then scaled to whatever
      // resolution this pass is running at.
      const radius = Math.max(1, (adjustments.blur / 100) * MAX_BLUR_RADIUS * pixelScale)
      // The scratch holds the horizontal pass; the vertical one lands in
      // whichever of the first two targets is not holding the live image.
      const scratch = targets[2]
      const destination = current === targets[0] ? targets[1] : targets[0]

      scratch.bind()
      this.blur.use()
      this.blur.setFloat('u_flipY', 0)
      this.bindTexture(0, current.texture)
      this.blur.setInt('u_image', 0)
      this.blur.setVec2('u_direction', 1 / width, 0)
      this.blur.setFloat('u_radius', radius)
      this.draw()

      destination.bind()
      this.bindTexture(0, scratch.texture)
      this.blur.setInt('u_image', 0)
      this.blur.setVec2('u_direction', 0, 1 / height)
      this.blur.setFloat('u_radius', radius)
      this.draw()
      blurred = destination
    }

    this.toScreen(width, height)
    this.finish.use()
    this.finish.setFloat('u_flipY', 0)
    this.bindTexture(0, current.texture)
    this.bindTexture(1, blurred.texture)
    this.finish.setInt('u_image', 0)
    this.finish.setInt('u_blurred', 1)
    this.finish.setVec2('u_texel', 1 / width, 1 / height)
    this.finish.setVec2('u_resolution', width, height)
    this.finish.setFloat('u_sharpness', adjustments.sharpness / 100)
    this.finish.setFloat('u_blur', adjustments.blur / 100)
    this.finish.setFloat('u_vignette', adjustments.vignette / 100)
    this.finish.setFloat('u_grain', adjustments.grain / 100)
    this.finish.setFloat('u_pixelScale', pixelScale)
    this.finish.setVec3('u_luma', ...LUMA[this.colorSpace])
    this.draw()
  }

  /**
   * Renders the colour pipeline at thumbnail size and hands back the pixels.
   *
   * Only the colour pass runs. Sharpening, denoise and blur are spatial and mean
   * nothing at two hundred pixels across, and grain would fill a waveform with
   * noise that is not in the photograph at the size anybody will view it. So the
   * scopes measure the grade, which is what they are there to help you set.
   */
  readScope(edit: Edit, options: RenderOptions = {}, maxEdge = SCOPE_EDGE): ScopeSample | null {
    if (!this.texture) return null
    const framed = outputSize(edit.geometry, this.sourceWidth, this.sourceHeight)
    const scale = Math.min(1, maxEdge / Math.max(framed.width, framed.height, 1))
    const width = Math.max(1, Math.round(framed.width * scale))
    const height = Math.max(1, Math.round(framed.height * scale))

    const target = (this.scopeTarget ??= new RenderTarget(this.gl))
    target.resize(width, height)
    target.bind()
    // Never the matte: the scopes measure the photograph, and a plot that
    // silently switched to describing a mask would be read as the photograph.
    this.drawBase(edit, width, height, { ...options, matteView: null }, false)

    const data = new Uint8Array(width * height * 4)
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    return { data, width, height }
  }

  /**
   * The colour at a point of the framed image, in 0..1 coordinates with the
   * origin top left.
   *
   * Read from the scope proxy rather than from a one-pixel render: the proxy has
   * already averaged a small neighbourhood, which is what an eyedropper wants —
   * picking the literal pixel under the cursor hands back whatever grain
   * happened to be there. The secondaries are skipped, because what the picker
   * is for is telling a qualifier which colour to key on, and that is the colour
   * before any of them ran.
   */
  pick(edit: Edit, u: number, v: number, options: RenderOptions = {}): [number, number, number] | null {
    const sample = this.readScope(edit, { ...options, primaryOnly: true })
    if (!sample) return null
    const x = Math.min(sample.width - 1, Math.max(0, Math.round(u * (sample.width - 1))))
    // Framebuffer rows come back bottom up, and this coordinate is top down.
    const y = Math.min(sample.height - 1, Math.max(0, Math.round((1 - v) * (sample.height - 1))))
    const at = (y * sample.width + x) * 4
    return [sample.data[at], sample.data[at + 1], sample.data[at + 2]]
  }

  /** True once the context has been lost; the app rebuilds the renderer then. */
  isContextLost(): boolean {
    return this.gl.isContextLost()
  }

  // --- internals -----------------------------------------------------------

  private drawBase(
    edit: Edit,
    width: number,
    height: number,
    options: RenderOptions,
    ownsDithering: boolean,
  ): void {
    const { adjustments, grade } = edit
    this.base.use()
    // The only pass that reads the decoded bitmap, so the only one that flips.
    this.base.setFloat('u_flipY', 1)
    this.bindTexture(IMAGE_UNIT, this.texture!)
    this.base.setInt('u_image', IMAGE_UNIT)
    this.base.setFloat('u_bypass', options.bypass ? 1 : 0)
    this.base.setFloat('u_dither', ownsDithering ? 1 : 0)
    this.base.setVec2('u_resolution', width, height)
    this.base.setVec3('u_luma', ...LUMA[this.colorSpace])
    this.base.setMat3(
      'u_transform',
      sourceTransform(edit.geometry, this.sourceWidth, this.sourceHeight, options.cropOverride),
    )

    for (const [name, value] of Object.entries(toUniforms(adjustments))) {
      this.base.setFloat(name, value)
    }

    // --- grade -------------------------------------------------------------
    const wheels = hasWheels(grade.wheels)
    this.base.setFloat('u_hasWheels', wheels ? 1 : 0)
    if (wheels) {
      const u = wheelUniforms(grade.wheels)
      this.base.setVec3('u_offset', ...u.offset)
      this.base.setVec3('u_lift', ...u.lift)
      this.base.setVec3('u_gamma', ...u.gamma)
      this.base.setVec3('u_gain', ...u.gain)
    }

    // --- secondaries -------------------------------------------------------
    const secondaries = secondaryUniforms(options.primaryOnly ? [] : grade.secondaries)
    this.base.setInt('u_secondaryCount', secondaries.count)
    this.base.setInt('u_matteView', options.primaryOnly ? -1 : (options.matteView ?? -1))
    this.base.setFloat('u_aspect', width / Math.max(height, 1))
    if (secondaries.count > 0) {
      this.base.setVec4Array('u_secHue', secondaries.hue)
      this.base.setVec4Array('u_secSat', secondaries.saturation)
      this.base.setVec4Array('u_secLum', secondaries.luminance)
      this.base.setVec4Array('u_secWinA', secondaries.windowA)
      this.base.setVec4Array('u_secWinB', secondaries.windowB)
      this.base.setVec4Array('u_secCorrA', secondaries.correctionA)
      this.base.setVec4Array('u_secCorrB', secondaries.correctionB)
    }

    // Compared by identity, not by value: the store replaces the curves object
    // on every change and never edits one in place, so a matching reference is
    // proof the table on the GPU is still the right one.
    this.bindTexture(CURVE_UNIT, this.curveLut!)
    if (this.curveSource !== grade.curves) this.uploadCurves(grade.curves)
    this.base.setFloat('u_hasCurves', hasCurves(grade.curves) ? 1 : 0)
    this.base.setInt('u_curves', CURVE_UNIT)

    this.draw()
  }

  private uploadCurves(curves: Curves): void {
    const gl = this.gl
    this.bindTexture(CURVE_UNIT, this.curveLut!)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      CURVE_SIZE,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      curveTexture(curves, CURVE_SIZE),
    )
    this.curveSource = curves
  }

  /** Allocates only the targets this combination of effects actually needs. */
  private ensureTargets(adjustments: Adjustments, width: number, height: number): RenderTarget[] {
    // Blur needs a scratch surface on top of the image it is reading, denoise
    // needs somewhere to write, everything else works off the base alone.
    const needed = adjustments.blur > 0 ? 3 : adjustments.denoise > 0 ? 2 : 1
    while (this.targets.length < needed) {
      this.targets.push(new RenderTarget(this.gl))
    }
    for (let i = 0; i < needed; i++) this.targets[i].resize(width, height)
    return this.targets
  }

  private toScreen(width: number, height: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private bindTexture(unit: number, texture: WebGLTexture): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }

  private draw(): void {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)
  }

  private disposeTexture(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture)
      this.texture = null
    }
  }

  dispose(): void {
    this.disposeTexture()
    for (const target of this.targets) target.dispose()
    this.targets.length = 0
    this.scopeTarget?.dispose()
    this.scopeTarget = null
    if (this.curveLut) this.gl.deleteTexture(this.curveLut)
    this.curveLut = null
    this.base.dispose()
    this.denoise.dispose()
    this.blur.dispose()
    this.finish.dispose()
    this.gl.deleteVertexArray(this.vao)
  }
}
