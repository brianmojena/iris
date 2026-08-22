/**
 * Full-screen quad. Positions arrive in clip space already, so the vertex stage
 * only has to hand the texture coordinate over.
 *
 * Whether Y needs flipping depends on where the pixels came from. A decoded
 * image is stored top-down, while GL texture space runs bottom-up, so the first
 * pass has to flip. Every pass after that reads a framebuffer, which is already
 * in GL orientation — flipping again would stand the picture on its head.
 */
export const QUAD_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

/** 1.0 when this pass reads the decoded image, 0.0 when it reads a framebuffer. */
uniform float u_flipY;

void main() {
  float upward = a_position.y * 0.5 + 0.5;
  v_uv = vec2(a_position.x * 0.5 + 0.5, mix(upward, 1.0 - upward, u_flipY));
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`
