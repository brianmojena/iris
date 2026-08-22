/**
 * One half of a separable Gaussian blur — the caller runs it twice, horizontally
 * then vertically. Two 1D passes cost 2n samples where a true 2D kernel costs
 * n², which is the difference between a usable slider and a slideshow.
 */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
/** One texel along the axis being blurred, zero along the other. */
uniform vec2 u_direction;
/** Blur radius in pixels. */
uniform float u_radius;

const int TAPS = 12;

void main() {
  float radius = max(u_radius, 0.001);
  float sigma = radius * 0.5;
  float twoSigmaSquared = 2.0 * sigma * sigma;
  // Named "stride" rather than "step": shadowing the built-in step() is legal
  // but makes the next reader look twice.
  float stride = radius / float(TAPS);

  vec4 sum = vec4(0.0);
  float weightSum = 0.0;

  for (int i = -TAPS; i <= TAPS; i++) {
    float offset = float(i) * stride;
    float weight = exp(-offset * offset / twoSigmaSquared);
    sum += texture(u_image, v_uv + u_direction * offset) * weight;
    weightSum += weight;
  }

  fragColor = sum / weightSum;
}
`
