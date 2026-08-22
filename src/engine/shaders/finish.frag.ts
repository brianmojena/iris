/**
 * The last pass: sharpening, the blur mix, vignette, grain and dithering.
 *
 * These are bundled into one pass because none of them needs more than a single
 * texel neighbourhood, and every extra full-screen pass costs a full read and
 * write of the image.
 */
export const FINISH_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
/** The blurred copy; bound to the image itself when the blur slider is at zero. */
uniform sampler2D u_blurred;
uniform vec2 u_texel;
uniform vec2 u_resolution;

uniform float u_sharpness; // 0..1
uniform float u_blur;      // 0..1
uniform float u_vignette;  // -1..1
uniform float u_grain;     // 0..1
/** Render size over full export size, so grain keeps a sane cell at any zoom. */
uniform float u_pixelScale;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/** 3×3 Gaussian, the reference blur for the unsharp mask. */
vec3 softened(vec2 uv) {
  vec3 sum =
      texture(u_image, uv + vec2(-u_texel.x, -u_texel.y)).rgb * 1.0
    + texture(u_image, uv + vec2(0.0, -u_texel.y)).rgb * 2.0
    + texture(u_image, uv + vec2(u_texel.x, -u_texel.y)).rgb * 1.0
    + texture(u_image, uv + vec2(-u_texel.x, 0.0)).rgb * 2.0
    + texture(u_image, uv).rgb * 4.0
    + texture(u_image, uv + vec2(u_texel.x, 0.0)).rgb * 2.0
    + texture(u_image, uv + vec2(-u_texel.x, u_texel.y)).rgb * 1.0
    + texture(u_image, uv + vec2(0.0, u_texel.y)).rgb * 2.0
    + texture(u_image, uv + vec2(u_texel.x, u_texel.y)).rgb * 1.0;
  return sum / 16.0;
}

/**
 * Hash noise, uniform on 0..1.
 *
 * Not the usual sin-dot-fract one-liner. Measured on a flat field the two are
 * equivalent, so this is not a bug fix — it is about portability. The precision
 * of sin() is driver-dependent, and a grain pattern that changes character
 * between GPUs is a grain pattern you cannot judge.
 */
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec4 source = texture(u_image, v_uv);
  vec3 c = source.rgb;

  // --- sharpening ---------------------------------------------------------
  if (u_sharpness > 0.0) {
    vec3 detail = c - softened(v_uv);
    // Capping the detail before it is amplified is what keeps a hard edge from
    // growing a white halo along its bright side.
    detail = clamp(detail, -0.25, 0.25);
    c += detail * u_sharpness * 1.5;
  }

  // --- creative blur ------------------------------------------------------
  if (u_blur > 0.0) {
    c = mix(c, texture(u_blurred, v_uv).rgb, u_blur);
  }

  // --- vignette -----------------------------------------------------------
  if (abs(u_vignette) > 0.0) {
    // Measured on a square so the falloff stays circular on a wide crop.
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 centred = (v_uv - 0.5) * vec2(max(aspect, 1.0), max(1.0 / aspect, 1.0));
    float radial = length(centred) / length(vec2(max(aspect, 1.0), max(1.0 / aspect, 1.0)) * 0.5);
    float falloff = smoothstep(0.35, 1.05, radial);

    c = u_vignette > 0.0
      ? c * (1.0 - u_vignette * falloff * 0.85)
      : c + (-u_vignette) * falloff * 0.35 * (1.0 - c);
  }

  // --- grain --------------------------------------------------------------
  if (u_grain > 0.0) {
    // A grain cell is 1.6 source pixels. In a zoomed-out preview that is less
    // than one rendered pixel, so it is clamped to avoid aliasing — and the
    // amplitude is scaled by the same factor, because shrinking an image
    // averages its grain down by exactly that much. Without the second half the
    // preview shows far heavier grain than the exported file has.
    float cellInRender = 1.6 * u_pixelScale;
    float cell = max(1.0, cellInRender);
    float shrinkage = min(1.0, cellInRender);
    float noise = (hash(floor(gl_FragCoord.xy / cell)) - 0.5) * shrinkage;
    // Film grain is strongest in the mid-tones and all but vanishes at either end.
    float luminance = dot(clamp(c, 0.0, 1.0), LUMA);
    float weight = 1.0 - smoothstep(0.0, 1.0, abs(luminance - 0.45) * 2.0);
    c += noise * u_grain * 0.16 * weight;
  }

  c = clamp(c, 0.0, 1.0);
  // Breaks up the banding that 8-bit output would otherwise show in smooth skies.
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;

  fragColor = vec4(clamp(c, 0.0, 1.0), source.a);
}
`
