import { MAX_COLORS, MAX_LIGHTS, MAX_NOISE_BANDS } from "./config";

/**
 * Faithful port of Stripe's hero shaders (bundle 4925: vertex module #2,
 * fragment module #0). Vertex: a flat plane is Y-displaced by simplex noise, then
 * twisted by three axis-rotations `freq * expStep(uv, power)` where
 * `expStep(x,n) = exp2(-exp2(n)*pow(x,n))` is a falloff (rotation concentrated at
 * the uv=0 edge), with diagonal axes + an animated X wobble. Fragment: Stripe uses
 * NO normal-based lighting — "thickness" comes from `pdy`, a foreshorten/fold
 * detector built from `dFdy(uv)`, used to lift flat areas toward white
 * (`col += (1-pdy)*0.25`) and to localise the striations. Striations are subtle
 * high-frequency simplex noise ADDED to the colour, colour-matched via (1-blue)
 * and end-weighted via a parabola — so they blend rather than stripe.
 * Our additions: gradient stops/types for colour, and an optional additive light
 * layer (kept gentle so the default reads like Stripe).
 */

const simplex2d = /* glsl */ `
vec3 permute3(vec3 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

export const vertexShader = /* glsl */ `
${simplex2d}

uniform float uTime, uSpeed, uSeed;
uniform float uLength, uWidth, uWidthTaper, uFoldRadius, uFoldGap, uFoldCenter;
uniform float uDispFreqX, uDispFreqZ, uDispAmount;
uniform float uTwFreqX, uTwFreqY, uTwFreqZ, uTwPowX, uTwPowY, uTwPowZ;
uniform vec3 uScale, uRotation, uPosition;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;

// Stripe's expStep: a falloff from 1 (at x=0) toward 0, sharpness set by n. The
// max() guards pow(0, n) (= Infinity → NaN) so negative n is safe — negative n
// just concentrates the twist toward the OTHER end instead.
float expStep(float x, float n){ return exp2(-exp2(n) * pow(max(x, 1.0e-3), n)); }

// Stripe's rotationMatrix (mat4), used row-vector style: pos = (vec4(pos,1) * R).xyz
mat4 rotationMatrix(vec3 axis, float angle){
  axis = normalize(axis);
  float s = sin(angle), c = cos(angle), oc = 1.0 - c;
  return mat4(
    oc*axis.x*axis.x + c,        oc*axis.x*axis.y - axis.z*s, oc*axis.z*axis.x + axis.y*s, 0.0,
    oc*axis.x*axis.y + axis.z*s, oc*axis.y*axis.y + c,        oc*axis.y*axis.z - axis.x*s, 0.0,
    oc*axis.z*axis.x - axis.y*s, oc*axis.y*axis.z + axis.x*s, oc*axis.z*axis.z + c,        0.0,
    0.0, 0.0, 0.0, 1.0
  );
}

void main(){
  vUv = uv;
  float t = uTime * uSpeed + uSeed;
  float taper = 1.0 - uWidthTaper * (1.0 - sin(uv.x * 3.14159265));

  // --- FLAT sheet (previous approach — kept for revert) ---
  // vec3 pos = vec3(position.x * uLength, 0.0, position.z * uWidth * taper);

  // --- Hairpin fold (Stripe's folded()): the strip doubles back on itself along
  // its length into two layers separated in Y by ~2*uFoldRadius, joined by a
  // semicircular U-bend (half-length uFoldGap) at uFoldCenter along the length.
  // Off-centre → a long main sweep + a short folded-over tip (Stripe-like), not a
  // symmetric middle crease. uFoldRadius = 0 → effectively flat.
  float halfLen = 0.5 * uLength;
  float L = position.x * uLength;                 // length coordinate, [-halfLen, halfLen]
  float wpos = position.z * uWidth * taper;       // across the width
  float r = uFoldRadius;
  float bend = max(uFoldGap, 1.0e-3);
  float c = clamp(uFoldCenter, -1.0, 1.0) * halfLen;   // where the fold happens
  vec3 pos;
  if (L < c - bend) {
    pos = vec3(L, r, wpos);                       // long arm, at +r
  } else if (L < c + bend) {                      // U-bend (semicircle, +r → -r)
    float a = 1.57079633 - (L - (c - bend)) / (2.0 * bend) * 3.14159265;
    pos = vec3((c - bend) + r * cos(a), r * sin(a), wpos);
  } else {
    pos = vec3(2.0 * c - L, -r, wpos);            // short folded-over arm, at -r
  }
  pos.y += uDispAmount * snoise(vec2(pos.x * uDispFreqX + t, pos.z * uDispFreqZ + t));

  // Stripe's three-axis twist: expStep falloff concentrates the rotation at the uv
  // edges; diagonal axes; the X twist gets a slow animated noise wobble.
  float twistXNoise = snoise(vec2(uv.y * 2.0, t));
  float twistXMotion = uTwFreqX - twistXNoise * 0.1;
  mat4 rotA = rotationMatrix(vec3(0.5, 0.0, 0.5), uTwFreqY * expStep(uv.x, uTwPowY));
  mat4 rotB = rotationMatrix(vec3(0.0, 0.5, 0.5), twistXMotion * expStep(uv.y, uTwPowX));
  mat4 rotC = rotationMatrix(vec3(0.5, 0.0, 0.5), uTwFreqZ * expStep(uv.y, uTwPowZ));
  pos = (vec4(pos, 1.0) * rotA).xyz;
  pos = (vec4(pos, 1.0) * rotB).xyz;
  pos = (vec4(pos, 1.0) * rotC).xyz;

  // Our transform (scale / rotate° / position).
  pos *= uScale;
  pos = (vec4(pos, 1.0) * rotationMatrix(vec3(1.0, 0.0, 0.0), radians(uRotation.x))).xyz;
  pos = (vec4(pos, 1.0) * rotationMatrix(vec3(0.0, 1.0, 0.0), radians(uRotation.y))).xyz;
  pos = (vec4(pos, 1.0) * rotationMatrix(vec3(0.0, 0.0, 1.0), radians(uRotation.z))).xyz;
  pos += uPosition;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;
  vViewDir = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const fragmentShader = /* glsl */ `
#define MAX_COLORS ${MAX_COLORS}
#define MAX_LIGHTS ${MAX_LIGHTS}
#define MAX_NOISE_BANDS ${MAX_NOISE_BANDS}
#define PI 3.14159265359

${simplex2d}

uniform vec3 uColors[MAX_COLORS];
uniform float uColorPos[MAX_COLORS];
uniform int uColorCount;
uniform int uGradType;
uniform float uGradAngle;
uniform float uGradShift;
uniform float uHueShift;
uniform float uLayerHue;
uniform float uContrast;
uniform float uSaturation;
uniform float uFiberCount;
uniform float uFiberThickness;
uniform float uTexture;
uniform float uGlowAmount;
uniform float uGlowPower;
uniform float uGlowRamp;
uniform float uEdgeFade;
uniform float uOpacity;
uniform vec2 uResolution;
uniform float uAmbient;
uniform int uNumLights;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform float uLightIntensity[MAX_LIGHTS];
uniform int uNumNoiseBands;
uniform vec4 uNoiseBandBounds[MAX_NOISE_BANDS];  // (startX, endX, startY, endY)
uniform vec4 uNoiseBandParams[MAX_NOISE_BANDS];  // (feather, strength, frequency, colorAttenuation)
uniform float uNoiseBandParaPow[MAX_NOISE_BANDS];

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// ---- Stripe colour helpers (verbatim from the hero shader) ----
vec3 contrastFn(vec3 v, float a){ return (v - 0.5) * a + 0.5; }
vec3 desaturate(vec3 color, float factor){
  vec3 gray = vec3(dot(vec3(0.299, 0.587, 0.114), color));
  return mix(color, gray, factor);
}
vec3 hueShift(vec3 color, float shift){
  vec3 g = vec3(0.57735);
  vec3 proj = g * dot(g, color);
  vec3 U = color - proj;
  vec3 W = cross(g, U);
  return U * cos(shift) + W * sin(shift) + proj;
}
float parabola(float x, float k){ return pow(4.0 * x * (1.0 - x), k); }
float mapLinear(float v, float a, float b, float c, float d){ return c + (v - a) * (d - c) / (b - a); }

// Our gradient: interpolate stops by their positions (uColorPos sorted ascending).
vec3 grad(float u){
  u = clamp(u, 0.0, 1.0);
  vec3 col = uColors[0];
  for (int i = 0; i < MAX_COLORS - 1; i++){
    if (i >= uColorCount - 1) break;
    float p0 = uColorPos[i];
    float p1 = uColorPos[i + 1];
    if (u >= p0){
      float t = clamp((u - p0) / max(p1 - p0, 1e-5), 0.0, 1.0);
      col = mix(uColors[i], uColors[i + 1], t);
    }
  }
  return col;
}

// Map a surface uv to the 0–1 gradient coordinate per gradient type. uGradShift
// adds a low-frequency simplex warp so the colour varies in 2D (along the length
// as well as across the width) — approximating Stripe's 2D palette texture instead
// of flat 1-D bands.
float gradCoord(vec2 uv){
  float warp = uGradShift * snoise(uv * 1.6 + 4.0);
  if (uGradType == 1){ return clamp(length(uv - 0.5) * 2.0 + warp, 0.0, 1.0); }    // radial
  if (uGradType == 2){ return fract(atan(uv.y - 0.5, uv.x - 0.5) / (2.0 * PI) + 0.5 + warp); } // conic
  vec2 dir = vec2(sin(uGradAngle), cos(uGradAngle));                              // linear, angled
  return clamp(dot(uv - 0.5, dir) + 0.5 + warp, 0.0, 1.0);
}

// Stripe's striations: a subtle high-frequency simplex-noise grain ADDED to the
// colour — colour-matched (weaker where blue is high), only near folds (pdy), and
// concentrated toward the ends (parabola). Blends instead of striping.
vec3 surfaceStreaks(vec2 uv, vec3 color, float pdy){
  float strength = uFiberThickness;          // Stripe: 0.2
  float freq = uFiberCount;                   // Stripe: 600
  float colorAtten = 0.9;
  float paraPow = 3.0;
  // Noise bands (Stripe's USE_NOISE_BANDS): inside each rectangular uv region the
  // fiber params are overridden, so the streaks vary per region instead of uniform.
  for (int i = 0; i < MAX_NOISE_BANDS; i++) {
    if (i >= uNumNoiseBands) break;
    vec4 b = uNoiseBandBounds[i];
    vec4 prm = uNoiseBandParams[i];
    float feather = max(prm.x, 1.0e-4);
    float blend =
      smoothstep(b.x - feather, b.x, uv.x) * (1.0 - smoothstep(b.y, b.y + feather, uv.x)) *
      smoothstep(b.z - feather, b.z, uv.y) * (1.0 - smoothstep(b.w, b.w + feather, uv.y));
    strength = mix(strength, prm.y, blend);
    freq = mix(freq, prm.z, blend);
    colorAtten = mix(colorAtten, prm.w, blend);
    paraPow = mix(paraPow, uNoiseBandParaPow[i], blend);
  }
  // Stripe packs the high frequency along the axis ACROSS the wave so the streaks
  // run ALONG its length. Our uv is transposed vs theirs (our uv.x = length), so we
  // put the high frequency on uv.y (our width) → length-wise fibers, not cross bars.
  float p = 1.0 - parabola(uv.y, paraPow);
  float n0 = snoise(vec2(uv.y * 0.1, uv.x * 0.5));
  float n1 = snoise(vec2(uv.y * (freq + freq * 0.5 * n0), uv.x * 4.0 * n0));
  n1 = mapLinear(n1, -1.0, 1.0, 0.0, 1.0);
  color += n1 * strength * (1.0 - color.b * colorAtten) * pdy * p;
  return color;
}

void main(){
  // pdy: a foreshortening / fold detector from the screen-space uv derivative.
  // It drives BOTH the volume shading and where the streaks appear — this is what
  // gives Stripe's wave its thickness without any normal-based lighting.
  float pdy = dFdy(vUv).y * uResolution.y * uGlowAmount;
  pdy = clamp(mapLinear(pdy, -1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  pdy = pow(pdy, uGlowPower);
  pdy = clamp(smoothstep(0.0, uGlowRamp, pdy), 0.0, 1.0);

  // Colour from our gradient, then the noise streaks.
  vec3 col = grad(gradCoord(vUv));
  col = surfaceStreaks(vUv, col, pdy);

  col = contrastFn(col, uContrast);
  col = desaturate(col, 1.0 - uSaturation);
  col = hueShift(col, radians(uHueShift + uLayerHue));

  // Stripe's volume cue: lift the flat (low-pdy) areas toward white → thickness.
  // (Stripe uses 0.25 on a black matte; eased here since we composite on white.)
  col += (1.0 - pdy) * 0.22;

  // Optional positionable lights (our feature) — additive & gentle, on top of the
  // Stripe base so the default still reads like Stripe. A finely-subdivided mesh
  // keeps this derivative normal smooth.
  if (uNumLights > 0) {
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    vec3 Vd = normalize(vViewDir);
    if (dot(N, Vd) < 0.0) N = -N;
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= uNumLights) break;
      vec3 L = normalize(uLightPos[i] - vWorldPos);
      vec3 lc = uLightColor[i] * uLightIntensity[i];
      float diff = max(dot(N, L), 0.0);
      float spec = pow(max(dot(N, normalize(L + Vd)), 0.0), 28.0);
      col += col * diff * lc * 0.16 + spec * lc * 0.10;
    }
  }
  col *= mix(0.78, 1.12, clamp(uAmbient, 0.0, 1.0));   // ambient = overall level

  if (uTexture > 0.001) col *= 1.0 + (hash(vUv * 850.0) - 0.5) * uTexture * 0.25;

  // Soft long edges + optional viewport-edge fade.
  float ribEdge = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
  float alpha = uOpacity * ribEdge;
  if (uEdgeFade > 0.001) {
    vec2 sc = gl_FragCoord.xy / max(uResolution, vec2(1.0));
    float vig =
      smoothstep(0.0, uEdgeFade, sc.x) * (1.0 - smoothstep(1.0 - uEdgeFade, 1.0, sc.x)) *
      smoothstep(0.0, uEdgeFade, sc.y) * (1.0 - smoothstep(1.0 - uEdgeFade, 1.0, sc.y));
    alpha *= vig;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
}
`;

// ---- Post pass: viewport-edge soft-focus blur + dither grain ----

export const postVertexShader = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const postFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uBlurAmount;
uniform int uBlurSamples;
uniform float uGrainAmount;
uniform float uTime;
varying vec2 vUv;

float random2(vec2 st){ return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453); }

// Stripe's angular (spin) blur: rotate the sample coord around the centre and
// accumulate — a tangential smear that grows toward the edges. Carries alpha so a
// transparent background survives the post pass.
vec4 blurAngular(sampler2D tex, vec2 uv, float angle, int samples){
  vec4 total = vec4(0.0);
  vec2 coord = uv - 0.5;
  float dist = 1.0 / float(samples);
  vec2 dir = vec2(cos(angle * dist), sin(angle * dist));
  mat2 rot = mat2(dir.x, dir.y, -dir.y, dir.x);
  for (int i = 0; i < 64; i++){
    if (i >= samples) break;
    total += texture2D(tex, coord + 0.5);
    coord = rot * coord;
  }
  return total * dist;
}

void main(){
  vec4 sceneColor = texture2D(tDiffuse, vUv);
  vec4 blurColor = blurAngular(tDiffuse, vUv, uBlurAmount, uBlurSamples);
  // Stripe weights the spin blur to the top & bottom, keeping a sharp middle band.
  float sharp = clamp((smoothstep(0.0, 0.7, vUv.y) - smoothstep(0.2, 1.0, vUv.y)) * 1.8, 0.0, 1.0);
  vec4 color = mix(blurColor, sceneColor, sharp);
  color.rgb += mix(uGrainAmount, -uGrainAmount, random2(gl_FragCoord.xy * 0.01 + fract(uTime))) * (4.0 / 255.0);
  gl_FragColor = color;   // preserve alpha → transparent background works
}
`;
