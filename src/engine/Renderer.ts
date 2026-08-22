import { Program } from './gl/program'
import { QUAD_VERT } from './shaders/quad.vert'
import { ADJUSTMENTS_FRAG } from './shaders/adjustments.frag'
import type { Adjustments } from '../types/adjustments'
import { sourceTransform, type CropRect, type Geometry } from '../types/geometry'
import { identity } from '../lib/matrix'

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

/**
 * Owns the GL context and the single quad every pass draws through.
 *
 * The renderer keeps the *full resolution* image in a texture and simply draws
 * it into whatever viewport it is given. Screen preview and final export are
 * therefore the exact same code path at different sizes — there is no second
 * "export renderer" that could drift out of sync with what the user sees.
 */
export class Renderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: Program
  private readonly vao: WebGLVertexArrayObject
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

    if (!gl) throw new RendererError('Tu navegador no soporta WebGL2.')
    this.gl = gl

    this.program = new Program(gl, QUAD_VERT, ADJUSTMENTS_FRAG)

    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new RendererError('No se pudo reservar memoria en la GPU.')

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
    if (!texture) throw new RendererError('No se pudo crear la textura.')

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
    options: { bypass?: boolean; geometry?: Geometry; cropOverride?: CropRect } = {},
  ): void {
    const gl = this.gl
    if (!this.texture) return

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    this.program.use()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    this.program.setInt('u_image', 0)
    this.program.setFloat('u_bypass', options.bypass ? 1 : 0)
    this.program.setVec2('u_resolution', width, height)
    this.program.setMat3(
      'u_transform',
      options.geometry
        ? sourceTransform(
            options.geometry,
            this.sourceWidth,
            this.sourceHeight,
            options.cropOverride,
          )
        : identity(),
    )

    for (const [name, value] of Object.entries(toUniforms(adjustments))) {
      this.program.setFloat(name, value)
    }

    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)
  }

  /** True once the context has been lost; the app rebuilds the renderer then. */
  isContextLost(): boolean {
    return this.gl.isContextLost()
  }

  private disposeTexture(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture)
      this.texture = null
    }
  }

  dispose(): void {
    this.disposeTexture()
    this.program.dispose()
    this.gl.deleteVertexArray(this.vao)
  }
}
