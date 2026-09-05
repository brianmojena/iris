/**
 * The single-pass adjustment stage.
 *
 * Ordering matters and mirrors how a raw processor works:
 *   1. decode to linear light
 *   2. exposure and white balance   (physically meaningful in linear)
 *   3. encode back to display gamma
 *   4. tone controls and contrast   (perceptually meaningful in gamma)
 *   5. the grade: colour wheels, then curves
 *   6. vibrance and saturation, which finish whatever the grade left
 *   7. the secondaries, each reaching only what its matte covers
 *
 * Every uniform is normalised to roughly -1..1 on the CPU side, so the shader
 * never has to know about slider ranges.
 */
export const ADJUSTMENTS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
/** Maps this pass's texture coordinates onto the source image. */
uniform mat3 u_transform;

uniform float u_exposure;    // EV stops
uniform float u_contrast;    // -1..1
uniform float u_highlights;  // -1..1
uniform float u_shadows;     // -1..1
uniform float u_whites;      // -1..1
uniform float u_blacks;      // -1..1
uniform float u_temperature; // -1..1
uniform float u_tint;        // -1..1
uniform float u_vibrance;    // -1..1
uniform float u_saturation;  // -1..1

// --- grade ---------------------------------------------------------------
uniform vec3  u_offset;      // added flat,        neutral 0
uniform vec3  u_lift;        // pivots at white,   neutral 0
uniform vec3  u_gamma;       // exponent base,     neutral 1
uniform vec3  u_gain;        // pivots at black,   neutral 1
uniform float u_hasWheels;   // 1.0 when any wheel has been moved

/** All four tone curves baked into one row: R, G and B already composed with the master. */
uniform sampler2D u_curves;
uniform float u_hasCurves;
#define CURVE_SIZE 256.0

// --- secondaries ---------------------------------------------------------
// Packed into vec4 arrays rather than an array of structs: a struct array costs
// a uniform location lookup and a driver call per member per slot on every
// frame, and this is seven uniform4fv calls instead.
#define MAX_SECONDARIES 4
uniform int  u_secondaryCount;
uniform vec4 u_secHue[MAX_SECONDARIES];   // centre, range, softness, qualifier on
uniform vec4 u_secSat[MAX_SECONDARIES];   // low, high, softness, inverted
uniform vec4 u_secLum[MAX_SECONDARIES];   // low, high, softness, window shape
uniform vec4 u_secWinA[MAX_SECONDARIES];  // cx, cy, half width, half height
uniform vec4 u_secWinB[MAX_SECONDARIES];  // cos, sin, feather, -
uniform vec4 u_secCorrA[MAX_SECONDARIES]; // exposure, contrast, temperature, tint
uniform vec4 u_secCorrB[MAX_SECONDARIES]; // saturation, hue, apply, -

/** Width over height of what is being drawn, so a window rotates rigidly. */
uniform float u_aspect;
/** Index of the secondary whose matte to draw instead of the picture; -1 for none. */
uniform int u_matteView;

uniform float u_bypass;      // 1.0 renders the untouched original
uniform vec2  u_resolution;  // for output dithering
/** 1.0 when this pass writes straight to the screen and owns the dithering. */
uniform float u_dither;

/** Luminance weights of the working space; the primaries decide them. */
uniform vec3 u_luma;
#define LUMA u_luma

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

/** Channel gains that warm or cool the image without shifting overall brightness. */
vec3 whiteBalance(vec3 c, float temp, float tint) {
  vec3 gain = vec3(
    1.0 + temp * 0.35 + tint * 0.12,
    1.0 - tint * 0.22,
    1.0 - temp * 0.35 + tint * 0.12
  );
  gain /= max(dot(gain, LUMA), 1e-4);
  return c * gain;
}

/** How far a pixel may be brightened by scaling before the rest is added flat. */
const float MAX_GAIN = 1.75;

/**
 * Moves a pixel to a new luminance while disturbing its colour as little as
 * possible.
 *
 * Scaling the RGB triple keeps the ratios between channels, so hue and relative
 * saturation survive — that is the right move when darkening. Brightening is
 * different: scaling multiplies absolute chroma by the same factor, so lifting a
 * near-black pixel nine stops turns a grey rock neon. So gain is capped and the
 * remaining brightness is added flat, which desaturates slightly — precisely how
 * opened-up shadows look on real film and in every raw processor.
 */
vec3 retarget(vec3 c, float lum, float target) {
  float gain = clamp(target / max(lum, 1e-4), 0.0, MAX_GAIN);
  vec3 scaled = c * gain;
  vec3 result = scaled + (target - dot(scaled, LUMA));

  // Large tonal moves desaturate. A recovered highlight keeps its chroma while
  // losing brightness, which reads as a lurid orange; an opened shadow gains
  // brightness with its chroma multiplied, which reads as lurid teal. Together
  // they produce a neon split-tone. Real film and real raw processors both bleed
  // colour as they compress, so chroma is pulled back in proportion to how far
  // the pixel travelled — mid-tones, which barely move, are left alone.
  float travel = abs(log2(max(target, 1e-4) / max(lum, 1e-4)));
  float keep = 1.0 / (1.0 + 0.55 * travel);
  return mix(vec3(dot(result, LUMA)), result, keep);
}

/**
 * Recovers or opens up one end of the tonal range. The mask keeps the other end
 * and the mid-tones anchored, so pulling highlights down does not grey out skin.
 */
vec3 toneRegion(vec3 c, float amount, float mask) {
  if (abs(amount) < 1e-5) return c;
  float lum = dot(c, LUMA);
  // Headroom left in the direction we are pushing, so we ease out near 0 and 1.
  float room = amount > 0.0 ? (1.0 - lum) : lum;
  return retarget(c, lum, lum + amount * mask * room * 0.75);
}

/** Symmetric S-curve. Blending towards smoothstep keeps it from clipping hard. */
vec3 applyContrast(vec3 c, float k) {
  if (abs(k) < 1e-5) return c;
  vec3 steeper = smoothstep(vec3(0.0), vec3(1.0), c);
  vec3 flatter = c * 0.55 + 0.225;
  return k >= 0.0 ? mix(c, steeper, k) : mix(c, flatter, -k);
}

/**
 * Lift, gamma, gain and offset — the four handles every grading desk has had
 * since telecine, in the order they are wired there.
 *
 * Each one is deliberately anchored somewhere different, which is the whole
 * reason there are four: offset moves the entire range, lift pivots at white so
 * it lands on the shadows, gain pivots at black so it lands on the highlights,
 * and gamma leaves both ends nailed down and bends what is between them.
 */
vec3 applyWheels(vec3 c) {
  c += u_offset;
  c += u_lift * (1.0 - c);
  c *= u_gain;
  return pow(max(c, 0.0), 1.0 / u_gamma);
}

/**
 * One fetch per channel out of the baked table.
 *
 * The coordinate is squeezed onto the centres of the first and last texel:
 * sampling at 0.0 and 1.0 lands half a texel outside the row, and with linear
 * filtering that clamps and quietly flattens both ends of every curve.
 */
vec3 applyCurves(vec3 c) {
  vec3 x = c * ((CURVE_SIZE - 1.0) / CURVE_SIZE) + 0.5 / CURVE_SIZE;
  return vec3(
    texture(u_curves, vec2(x.r, 0.5)).r,
    texture(u_curves, vec2(x.g, 0.5)).g,
    texture(u_curves, vec2(x.b, 0.5)).b
  );
}

// --- secondaries ---------------------------------------------------------

vec3 rgbToHsv(vec3 c) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsvToRgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}

/** A band with shoulders on both sides. Softness is in the band's own units. */
float softBand(float value, float low, float high, float softness) {
  float s = max(softness, 1e-4);
  return smoothstep(low - s, low + s, value) * (1.0 - smoothstep(high - s, high + s, value));
}

/**
 * The same, around a circle. The distance is measured the short way round, so a
 * band centred on red picks up both the oranges and the magentas beside it
 * rather than stopping dead at the seam where the hue wraps.
 */
float hueKey(float hue, float centre, float range, float softness) {
  if (range >= 0.5) return 1.0;
  float d = abs(fract(hue - centre + 0.5) - 0.5);
  return 1.0 - smoothstep(range, range + max(softness, 1e-4), d);
}

/**
 * The geometric part of the matte.
 *
 * Everything is measured in fractions of the image's *height*, x included. In
 * plain 0..1 coordinates a rotation shears the shape as soon as the picture is
 * not square, and a circle turned forty-five degrees comes out an egg.
 */
float windowKey(int shape, vec4 a, vec4 b, vec2 uv) {
  if (shape == 0) return 1.0;
  vec2 p = (uv - a.xy) * vec2(u_aspect, 1.0);
  vec2 turned = vec2(p.x * b.x + p.y * b.y, -p.x * b.y + p.y * b.x);
  vec2 radii = max(a.zw, vec2(1e-4));
  vec2 unit = turned / radii;
  float d = shape == 1 ? length(unit) : max(abs(unit.x), abs(unit.y));
  // The drawn shape is where the matte reaches zero; feather says how far back
  // inside it the falloff begins, so one outline describes the whole thing.
  return 1.0 - smoothstep(1.0 - max(b.z, 1e-3), 1.0, d);
}

float matteFor(int i, vec3 c, vec2 uv) {
  vec4 h = u_secHue[i];
  vec4 s = u_secSat[i];
  vec4 l = u_secLum[i];

  float key = 1.0;
  if (h.w > 0.5) {
    vec3 hsv = rgbToHsv(c);
    // Brightness is read as luminance rather than HSV's value, which is only
    // the largest channel: by that measure a saturated blue is as bright as
    // white, and "select the light parts" would select the sky.
    key = hueKey(hsv.x, h.x, h.y, h.z)
        * softBand(hsv.y, s.x, s.y, s.z)
        * softBand(dot(c, LUMA), l.x, l.y, l.z);
  }
  key *= windowKey(int(l.w + 0.5), u_secWinA[i], u_secWinB[i], uv);
  return s.w > 0.5 ? 1.0 - key : key;
}

/** The compact correction a secondary carries, applied at full strength. */
vec3 correct(vec3 c, vec4 a, vec4 b) {
  vec3 lin = srgbToLinear(c);
  lin *= exp2(a.x);
  lin = whiteBalance(lin, a.z, a.w);
  vec3 result = clamp(linearToSrgb(lin), 0.0, 1.0);
  result = clamp(applyContrast(result, a.y), 0.0, 1.0);

  if (abs(b.y) > 1e-5) {
    vec3 hsv = rgbToHsv(result);
    hsv.x = fract(hsv.x + b.y);
    result = hsvToRgb(hsv);
  }

  float grey = dot(result, LUMA);
  return clamp(mix(vec3(grey), result, 1.0 + b.x), 0.0, 1.0);
}

/** Cheap hash used to break up 8-bit banding in smooth gradients. */
float dither(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
}

void main() {
  vec2 uv = (u_transform * vec3(v_uv, 1.0)).xy;

  // Straightening leaves the source rectangle at an angle, so the output has
  // corners with nothing behind them. fwidth gives the footprint of one output
  // pixel in source space, which turns the cut into a clean antialiased edge
  // instead of a staircase.
  vec2 edge = min(uv, 1.0 - uv);
  vec2 feather = max(fwidth(uv), vec2(1e-6));
  float coverage = min(smoothstep(0.0, feather.x, edge.x), smoothstep(0.0, feather.y, edge.y));
  if (coverage <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec4 src = texture(u_image, clamp(uv, 0.0, 1.0));

  // The comparison view keeps the framing and drops only the colour work.
  if (u_bypass > 0.5) {
    fragColor = vec4(src.rgb, src.a * coverage);
    return;
  }

  vec3 c = src.rgb;

  // --- linear light ------------------------------------------------------
  vec3 lin = srgbToLinear(c);
  lin *= exp2(u_exposure);
  lin = whiteBalance(lin, u_temperature, u_tint);
  c = linearToSrgb(lin);

  // --- tonal range -------------------------------------------------------
  float lum = dot(c, LUMA);
  c = toneRegion(c, u_highlights, smoothstep(0.45, 1.0, lum));
  c = toneRegion(c, u_shadows, 1.0 - smoothstep(0.0, 0.55, lum));

  // Whites and blacks are endpoint moves: weighted to the ends of the range and
  // routed through the same hue-preserving remap as the tone regions.
  lum = dot(c, LUMA);
  float endpoints =
      u_whites * 0.30 * smoothstep(0.25, 1.0, lum)
    + u_blacks * 0.30 * (1.0 - smoothstep(0.0, 0.75, lum));
  c = retarget(c, lum, lum + endpoints);

  c = applyContrast(clamp(c, 0.0, 1.0), u_contrast);

  // --- grade -------------------------------------------------------------
  // Wheels before curves: the wheels set where the three channels sit relative
  // to each other, and the curves are then drawn against what you can see.
  if (u_hasWheels > 0.5) c = clamp(applyWheels(clamp(c, 0.0, 1.0)), 0.0, 1.0);
  if (u_hasCurves > 0.5) c = applyCurves(clamp(c, 0.0, 1.0));

  // --- colour ------------------------------------------------------------
  c = clamp(c, 0.0, 1.0);
  float grey = dot(c, LUMA);

  if (abs(u_vibrance) > 1e-5) {
    // Pixels that are already vivid get pushed less than muted ones.
    float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    float weight = u_vibrance > 0.0 ? (1.0 - chroma) : 1.0;
    c = mix(vec3(grey), c, 1.0 + u_vibrance * weight);
  }

  c = mix(vec3(grey), c, 1.0 + u_saturation);
  c = clamp(c, 0.0, 1.0);

  // --- secondaries -------------------------------------------------------
  // Last, so each one keys on the colour the photograph actually has by now
  // rather than on something two stages out of date.
  for (int i = 0; i < MAX_SECONDARIES; i++) {
    if (i >= u_secondaryCount) break;
    bool apply = u_secCorrB[i].z > 0.5;
    bool preview = u_matteView == i;
    if (!apply && !preview) continue;

    float matte = matteFor(i, c, v_uv);
    if (preview) {
      fragColor = vec4(vec3(matte), src.a * coverage);
      return;
    }
    if (matte > 0.001) c = mix(c, correct(c, u_secCorrA[i], u_secCorrB[i]), matte);
  }

  c += u_dither * dither(gl_FragCoord.xy / max(u_resolution, vec2(1.0))) / 255.0;

  fragColor = vec4(clamp(c, 0.0, 1.0), src.a * coverage);
}
`
