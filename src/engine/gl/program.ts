import { dict } from '../../i18n'

export class ShaderError extends Error {}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new ShaderError(dict().notices.shaderFailed)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'error desconocido'
    gl.deleteShader(shader)
    throw new ShaderError(log)
  }
  return shader
}

/**
 * A linked program plus a lazily populated uniform-location cache. Looking a
 * uniform up by name every frame is a synchronous GL call, so we memoise.
 */
export class Program {
  readonly handle: WebGLProgram
  private readonly locations = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource)
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!program) throw new ShaderError(dict().notices.programFailed)

    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'error desconocido'
      gl.deleteProgram(program)
      throw new ShaderError(log)
    }
    this.handle = program
  }

  use(): void {
    this.gl.useProgram(this.handle)
  }

  private location(name: string): WebGLUniformLocation | null {
    let loc = this.locations.get(name)
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.handle, name)
      this.locations.set(name, loc)
    }
    return loc
  }

  setFloat(name: string, value: number): void {
    const loc = this.location(name)
    if (loc) this.gl.uniform1f(loc, value)
  }

  setVec2(name: string, x: number, y: number): void {
    const loc = this.location(name)
    if (loc) this.gl.uniform2f(loc, x, y)
  }

  setVec3(name: string, x: number, y: number, z: number): void {
    const loc = this.location(name)
    if (loc) this.gl.uniform3f(loc, x, y, z)
  }

  setInt(name: string, value: number): void {
    const loc = this.location(name)
    if (loc) this.gl.uniform1i(loc, value)
  }

  /** A whole `vec4[]` in one call; `values` is four floats per element. */
  setVec4Array(name: string, values: Float32Array): void {
    const loc = this.location(name)
    if (loc) this.gl.uniform4fv(loc, values)
  }

  setMat3(name: string, value: Float32Array): void {
    const loc = this.location(name)
    if (loc) this.gl.uniformMatrix3fv(loc, false, value)
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle)
  }
}
