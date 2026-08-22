import { Program } from './gl/program'
import { RenderTarget } from './gl/target'
import { QUAD_VERT } from './shaders/quad.vert'
import { ADJUSTMENTS_FRAG } from './shaders/adjustments.frag'
import { DENOISE_FRAG } from './shaders/denoise.frag'
import { BLUR_FRAG } from './shaders/blur.frag'
import { FINISH_FRAG } from './shaders/finish.frag'
import { needsEffectPasses, type Adjustments } from '../types/adjustments'
import { outputSize, sourceTransform, type CropRect, type Geometry } from '../types/geometry'
import { identity } from '../lib/matrix'
import { dict } from '../i18n'

/** Blur radius in source pixels when the slider is at 100. */
const MAX_BLUR_RADIUS = 40

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
  geometry?: Geometry
  cropOverride?: CropRect
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

  constructor(private readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null

    if (!gl) throw new RendererError(dict().notices.noWebgl)
    this.gl = gl

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

    gl.bindTexture(gl.TEXTURE_2D, texture)
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
  render(
    adjustments: Adjustments,
    width: number,
    height: number,
    options: RenderOptions = {},
  ): void {
    if (!this.texture) return

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    // The comparison view shows the untouched original, effects included.
    const spatial = !options.bypass && needsEffectPasses(adjustments)

    if (!spatial) {
      this.toScreen(width, height)
      this.drawBase(adjustments, width, height, options, true)
      return
    }

    // Full resolution of the framed result, so blur and grain look the same in
    // the preview as they will in the exported file.
    const full = options.geometry
      ? outputSize(options.geometry, this.sourceWidth, this.sourceHeight).width
      : this.sourceWidth
    const pixelScale = width / Math.max(full, 1)

    const targets = this.ensureTargets(adjustments, width, height)

    targets[0].bind()
    this.drawBase(adjustments, width, height, options, false)
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
    this.draw()
  }

  /** True once the context has been lost; the app rebuilds the renderer then. */
  isContextLost(): boolean {
    return this.gl.isContextLost()
  }

  // --- internals -----------------------------------------------------------

  private drawBase(
    adjustments: Adjustments,
    width: number,
    height: number,
    options: RenderOptions,
    ownsDithering: boolean,
  ): void {
    this.base.use()
    // The only pass that reads the decoded bitmap, so the only one that flips.
    this.base.setFloat('u_flipY', 1)
    this.bindTexture(0, this.texture!)
    this.base.setInt('u_image', 0)
    this.base.setFloat('u_bypass', options.bypass ? 1 : 0)
    this.base.setFloat('u_dither', ownsDithering ? 1 : 0)
    this.base.setVec2('u_resolution', width, height)
    this.base.setMat3(
      'u_transform',
      options.geometry
        ? sourceTransform(options.geometry, this.sourceWidth, this.sourceHeight, options.cropOverride)
        : identity(),
    )

    for (const [name, value] of Object.entries(toUniforms(adjustments))) {
      this.base.setFloat(name, value)
    }
    this.draw()
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
    this.base.dispose()
    this.denoise.dispose()
    this.blur.dispose()
    this.finish.dispose()
    this.gl.deleteVertexArray(this.vao)
  }
}
