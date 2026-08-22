/**
 * Edge-preserving denoise: a 5×5 bilateral filter.
 *
 * A plain blur removes noise and detail alike. Weighting each neighbour by how
 * far its colour is from the centre, on top of the usual distance falloff, means
 * flat areas average together while edges — where the colour difference is large
 * — barely mix at all.
 */
export const DENOISE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_amount; // 0..1

void main() {
  vec4 centre = texture(u_image, v_uv);

  // How much colour difference still counts as "the same surface".
  float range = 0.05 + u_amount * 0.10;
  float twoRangeSquared = 2.0 * range * range;

  vec3 sum = vec3(0.0);
  float weightSum = 0.0;

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 offset = vec2(float(x), float(y));
      // Not "sample": that is a reserved word in GLSL ES 3.00.
      vec4 neighbour = texture(u_image, v_uv + offset * u_texel);

      // Spatial term, sigma ≈ 1.5 px.
      float spatial = exp(-dot(offset, offset) / 4.5);
      vec3 difference = neighbour.rgb - centre.rgb;
      float rangeWeight = exp(-dot(difference, difference) / twoRangeSquared);

      // Transparent neighbours are outside the frame after straightening; they
      // must not bleed their colour into the edge.
      float weight = spatial * rangeWeight * neighbour.a;
      sum += neighbour.rgb * weight;
      weightSum += weight;
    }
  }

  vec3 filtered = weightSum > 1e-5 ? sum / weightSum : centre.rgb;
  fragColor = vec4(mix(centre.rgb, filtered, u_amount), centre.a);
}
`
