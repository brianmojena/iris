/**
 * An off-screen surface a pass can draw into and the next pass can read from.
 *
 * Eight bits per channel, deliberately. Half-float intermediates would carry a
 * little more precision through the chain, but a 24 megapixel export needs three
 * of these live at once, and at eight bytes per pixel that is over half a
 * gigabyte of GPU memory for a file the user expects to just save. The data here
 * is display-referred and already in 0..1; the dither in the final pass covers
 * the banding that the extra bits would have prevented.
 */
export class RenderTarget {
  readonly texture: WebGLTexture
  private readonly framebuffer: WebGLFramebuffer
  private width = 0
  private height = 0

  constructor(private readonly gl: WebGL2RenderingContext) {
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) throw new Error('No se pudo reservar memoria en la GPU.')

    this.texture = texture
    this.framebuffer = framebuffer

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }

  /** Allocates or reallocates storage. A no-op when the size is unchanged. */
  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return
    const gl = this.gl

    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    this.width = width
    this.height = height
  }

  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer)
    this.gl.viewport(0, 0, this.width, this.height)
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture)
    this.gl.deleteFramebuffer(this.framebuffer)
  }
}
