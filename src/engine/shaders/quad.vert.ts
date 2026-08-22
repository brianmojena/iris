/**
 * Full-screen quad. Positions arrive in clip space already, so the vertex stage
 * only has to hand the texture coordinate over — with Y flipped, because image
 * data is top-down while GL texture space is bottom-up.
 */
export const QUAD_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`
