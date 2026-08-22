/**
 * Minimal 3×3 affine maths, column-major so the arrays can be handed straight to
 * `uniformMatrix3fv` without transposing.
 *
 *   [ m0 m3 m6 ]
 *   [ m1 m4 m7 ]
 *   [ m2 m5 m8 ]
 */
export type Mat3 = Float32Array

export function identity(): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Float32Array(9)
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] =
        a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2]
    }
  }
  return out
}

/**
 * `compose(a, b, c)` is a·b·c — the transform that applies c first, then b, then
 * a, which is the order you read them backwards off the page.
 */
export function compose(...matrices: Mat3[]): Mat3 {
  return matrices.reduce((acc, m) => multiply(acc, m))
}

export function translation(tx: number, ty: number): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, tx, ty, 1])
}

export function scaling(sx: number, sy: number): Mat3 {
  return new Float32Array([sx, 0, 0, 0, sy, 0, 0, 0, 1])
}

/** Counter-clockwise in maths convention, clockwise on a y-down screen. */
export function rotation(radians: number): Mat3 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1])
}

/** The 2×2 linear part, written row by row as it reads on paper. */
export function linear(a: number, b: number, c: number, d: number): Mat3 {
  return new Float32Array([a, c, 0, b, d, 0, 0, 0, 1])
}

export function apply(m: Mat3, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[3] * y + m[6], y: m[1] * x + m[4] * y + m[7] }
}
