import { MAX_COLORS, MAX_LIGHTS, MAX_MESH_POINTS, MAX_NOISE_BANDS } from "./config";

/**
 * The wave shaders. Vertex: a flat plane is Y-displaced by simplex noise, then
 * twisted by three axis-rotations `freq * expStep(uv, power)` where
 * `expStep(x,n) = exp2(-exp2(n)*pow(x,n))` is a falloff (rotation concentrated at
 * the uv=0 edge), with diagonal axes + an animated X wobble. Fragment: uses NO
 * normal-based lighting — "thickness" comes from `crease`, a foreshorten/fold
 * detector built from `dFdy(uv)`, used to lift flat areas toward white
 * (`col += (1-crease)*0.25`) and to localise the striations. Striations are subtle
 * high-frequency simplex noise ADDED to the colour, colour-matched via (1-blue)
 * and end-weighted via a parabola — so they blend rather than form hard lines.
 * Our additions: gradient stops/types for colour, and an optional additive light
 * layer (kept gentle so the default look is preserved).
 */

// Noise function: xxHash-seeded unit-vector gradients + a Gustavson simplex. It uses
// GLSL ES 3.00 integer ops (floatBitsToUint, unsigned bit-shifts) — available with no
// glslVersion change because three compiles non-raw ShaderMaterials as "#version 300 es"
// already. `hash` returns a vec2 here — the cheap grain hash in the fragment is named
// `grainHash` to avoid clashing with it.
const simplex2d = /* glsl */ `
float xxhash(vec2 x){
  uvec2 t = floatBitsToUint(x);
  uint h = 0xc2b2ae3du * t.x + 0x165667b9u;
  h = (h << 17u | h >> 15u) * 0x27d4eb2fu;
  h += 0xc2b2ae3du * t.y;
  h = (h << 17u | h >> 15u) * 0x27d4eb2fu;
  h ^= h >> 15u;
  h *= 0x85ebca77u;
  h ^= h >> 13u;
  h *= 0xc2b2ae3du;
  h ^= h >> 16u;
  return uintBitsToFloat(h >> 9u | 0x3f800000u) - 1.0;
}
vec2 hash(vec2 x){
  float k = 6.283185307 * xxhash(x);
  return vec2(cos(k), sin(k));
}
float simplexNoise(in vec2 p){
  const float K1 = 0.366025404; // (sqrt(3)-1)/2
  const float K2 = 0.211324865; // (3-sqrt(3))/6
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
  return dot(n, vec3(32.99)); // analytic factor (= 2916*sqrt(2)/125)
}
`;

// Uniforms shared by BOTH fragment shaders (solid + wireframe line): the palette/gradient
// inputs and the colour-grade knobs. Each shader declares its theme-specific uniforms beside
// this block. Requires MAX_COLORS / MAX_MESH_POINTS #defines.
const colorUniforms = /* glsl */ `
uniform vec3 uColors[MAX_COLORS];
uniform float uColorPos[MAX_COLORS];
uniform int uColorCount;
uniform int uGradType;
uniform float uGradAngle;
uniform float uGradShift;
uniform vec2 uMeshPointPos[MAX_MESH_POINTS];
uniform vec3 uMeshPointColor[MAX_MESH_POINTS];
uniform float uMeshPointInfluence[MAX_MESH_POINTS];
uniform int uMeshPointCount;
uniform float uMeshSoftness;
uniform sampler2D uPalette;   // baked 2D palette texture
uniform float uUsePalette;    // >0.5 = sample the texture; else procedural grad()
uniform float uPaletteRaw;    // >0.5 = sample palette by raw (uv.x,uv.y), not gradCoord
uniform vec2 uPaletteScale;
uniform vec2 uPaletteOffset;
uniform float uPaletteRotation;
uniform float uHueShift;
uniform float uContrast;
uniform float uSaturation;
uniform float uOpacity;
uniform float uSquared;   // 1 = square the output colour (the deep "squared" hero look)
`;

// Colour helpers + the palette/gradient sampler shared by both fragment shaders.
// Interpolate AFTER ${"simplex2d"} and ${"colorUniforms"} (gradCoord needs both) and a PI define.
const colorFns = /* glsl */ `
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

// iOS-style 2D colour field. Each control point contributes an inverse-distance
// weight; normalising the sum fills the whole surface without dark seams.
vec3 meshGradient(vec2 uv){
  vec3 colorSum = vec3(0.0);
  float weightSum = 0.0;
  float exponent = mix(4.8, 1.35, clamp(uMeshSoftness, 0.0, 1.0));
  for (int i = 0; i < MAX_MESH_POINTS; i++){
    if (i >= uMeshPointCount) break;
    float influence = max(uMeshPointInfluence[i], 0.05);
    float distanceFromPoint = length(uv - uMeshPointPos[i]) / influence;
    float weight = 1.0 / (pow(max(distanceFromPoint, 0.012), exponent) + 0.002);
    colorSum += uMeshPointColor[i] * weight;
    weightSum += weight;
  }
  return colorSum / max(weightSum, 0.0001);
}

// Map a surface uv to the 0–1 gradient coordinate per gradient type. uGradShift
// adds a low-frequency simplex warp so the colour varies in 2D (along the length
// as well as across the width) — a 2D palette feel instead
// of flat 1-D bands.
float gradCoord(vec2 uv){
  float warp = uGradShift * simplexNoise(uv * 1.6 + 4.0);
  if (uGradType == 1){ return clamp(length(uv - 0.5) * 2.0 + warp, 0.0, 1.0); }    // radial
  if (uGradType == 2){ return fract(atan(uv.y - 0.5, uv.x - 0.5) / (2.0 * PI) + 0.5 + warp); } // conic
  vec2 dir = vec2(sin(uGradAngle), cos(uGradAngle));                              // linear, angled
  return clamp(dot(uv - 0.5, dir) + 0.5 + warp, 0.0, 1.0);
}

// One base-colour sample for the whole surface: rotate/scale/offset the raw-palette uv,
// then pick the mesh field / baked 2D texture / procedural stops by mode. The raw palette
// is sampled by (uv.x, uv.y) directly; the stops-generated texture is sampled via
// gradCoord so its angle/type/warp still apply.
vec3 waveBaseColor(vec2 uv){
  float gc = gradCoord(uv);
  vec2 mediaUv = uv - 0.5;
  float mediaCos = cos(uPaletteRotation);
  float mediaSin = sin(uPaletteRotation);
  mediaUv = vec2(
    mediaCos * mediaUv.x + mediaSin * mediaUv.y,
    -mediaSin * mediaUv.x + mediaCos * mediaUv.y
  );
  mediaUv = mediaUv * uPaletteScale + 0.5 + uPaletteOffset;
  vec2 puv = uPaletteRaw > 0.5
    ? clamp(mediaUv, 0.0, 1.0)
    : vec2(gc, clamp(uv.y, 0.0, 1.0));
  return uGradType == 3
    ? meshGradient(uv)
    : (uUsePalette > 0.5 ? texture2D(uPalette, puv).rgb : grad(gc));
}

// The shared colour grade: contrast → desaturate → hue rotate (degrees).
vec3 applyColorGrade(vec3 c){
  c = contrastFn(c, uContrast);
  c = desaturate(c, 1.0 - uSaturation);
  return hueShift(c, radians(uHueShift));
}
`;

export const vertexShader = /* glsl */ `
${simplex2d}

uniform float uTime, uSpeed, uSeed;
uniform float uDispFreqX, uDispFreqZ, uDispAmount;
uniform float uTwFreqX, uTwFreqY, uTwFreqZ, uTwPowX, uTwPowY, uTwPowZ;
uniform float uLoopSeconds; // seamless-loop period (only read under LOOP_MOTION)

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec4 vClipPosition; // = gl_Position, for the wireframe theme's depth fade

// expStep: a falloff from 1 (at x=0) toward 0, sharpness set by n. The
// max() guards pow(0, n) (= Infinity → NaN) so negative n is safe — negative n
// just concentrates the twist toward the OTHER end instead.
float expStep(float x, float n){ return exp2(-exp2(n) * pow(max(x, 1.0e-3), n)); }

// rotationMatrix (mat4), used row-vector style: pos = (vec4(pos,1) * R).xyz
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
#ifndef LOOP_MOTION
  float t = uTime * uSpeed + uSeed;
#endif

#ifdef LOOP_MOTION
  // Seamless loop: rather than scrolling the noise field linearly by t (which never repeats),
  // sample it on a circle of radius loopR at angle loopTheta — exactly periodic with period
  // uLoopSeconds. The tangential speed loopR·dθ/dt equals uSpeed, so the looped motion advances
  // at the same rate as the linear drift, just curved into a closed orbit (it orbits rather than
  // drifts — the trade-off for a seamless loop, hence opt-in). uSeed offsets the phase so stacked
  // waves keep their relative motion while sharing the single period.
  float loopTheta = uTime * (6.28318530718 / uLoopSeconds) + uSeed;
  float loopR = uSpeed * uLoopSeconds * 0.159154943092; // = uSpeed·uLoopSeconds / (2π)
  vec2 loopOff = loopR * vec2(cos(loopTheta), sin(loopTheta));
#endif

  // The base geometry is already a baked hairpin fold. On top of it we deform the
  // vertices: a displacement lifts Y by simplex noise of the (x,z) position, then
  // three axis-rotations twist the strip.
  vec3 pos = position;
#ifdef LOOP_MOTION
  pos.y += uDispAmount * simplexNoise(vec2(pos.x * uDispFreqX, pos.z * uDispFreqZ) + loopOff);
#else
  pos.y += uDispAmount * simplexNoise(vec2(pos.x * uDispFreqX + t, pos.z * uDispFreqZ + t));
#endif

  // The X-twist frequency feeding rotB. Two modes: by default uTwFreqX is used
  // directly; the variant (used by the Wave 4 preset) modulates it with
  // simplex noise indexed along the ribbon (uv.y) so the twist breathes over time.
  // We gate the wobble with a #define so the compiled program is unchanged when off.
  float twistXFreq = uTwFreqX;
#ifdef TWIST_MOTION
#ifdef LOOP_MOTION
  float twistXNoise = simplexNoise(vec2(vUv.y * 2.0, 0.0) + loopOff);
#else
  float twistXNoise = simplexNoise(vec2(vUv.y * 2.0, t));
#endif
  twistXFreq = uTwFreqX - twistXNoise * 0.1;
#endif

  // Three-axis twist: expStep falloff sets how
  // sharply each rotation concentrates toward an edge. rotA keys off uv.x, rotB/rotC
  // off uv.y; axes (0.5,0,0.5) and (0,0.5,0.5) are normalised inside rotationMatrix.
  mat4 rotA = rotationMatrix(vec3(0.5, 0.0, 0.5), uTwFreqY * expStep(uv.x, uTwPowY));
  mat4 rotB = rotationMatrix(vec3(0.0, 0.5, 0.5), twistXFreq * expStep(uv.y, uTwPowX));
  mat4 rotC = rotationMatrix(vec3(0.5, 0.0, 0.5), uTwFreqZ * expStep(uv.y, uTwPowZ));
  pos = (vec4(pos, 1.0) * rotA).xyz;
  pos = (vec4(pos, 1.0) * rotB).xyz;
  pos = (vec4(pos, 1.0) * rotC).xyz;

  // The scale / rotation / position transform lives on the mesh (modelMatrix), so the
  // orientation matches THREE's Euler-XYZ rather than an in-shader rotation order.
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;
  vViewDir = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  vClipPosition = gl_Position;
}
`;

export const fragmentShader = /* glsl */ `
#define MAX_COLORS ${MAX_COLORS}
#define MAX_MESH_POINTS ${MAX_MESH_POINTS}
#define MAX_LIGHTS ${MAX_LIGHTS}
#define MAX_NOISE_BANDS ${MAX_NOISE_BANDS}
#define PI 3.14159265359

${simplex2d}

${colorUniforms}
uniform float uDebug;         // dev: 1 = show crease, 2 = show derivative normal
uniform float uSheen;       // white-lift on the flat (low-crease) areas (1 = full)
uniform float uRoundness;        // pose-robust normal-based roundness/thickness strength
uniform float uFiberCount;
uniform float uFiberStrength;
uniform float uTexture;
uniform float uCreaseLight;
uniform float uCreaseSharpness;
uniform float uCreaseSoftness;
uniform float uEdgeFade;
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

// Cheap value hash for the optional grain overlay (distinct from the simplex hash).
float grainHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float parabola(float x, float k){ return pow(4.0 * x * (1.0 - x), k); }
float mapLinear(float v, float a, float b, float c, float d){ return c + (v - a) * (d - c) / (b - a); }

${colorFns}

// Striations: a subtle high-frequency simplex-noise grain ADDED to the
// colour — colour-matched (weaker where blue is high), only near folds (crease), and
// concentrated toward the ends (parabola). Blends in rather than reading as hard lines.
vec3 surfaceStreaks(vec2 uv, vec3 color, float crease){
  float strength = uFiberStrength;          // default 0.2
  float freq = uFiberCount;                   // default 600
  float colorAtten = 0.9;
  float paraPow = 3.0;
  // Noise bands: inside each rectangular uv region the
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
  // The high frequency runs along uv.x (the ribbon's length) so the streaks read as
  // fine lengthwise fibers; end-weighted by 1 - parabola(uv.x).
  float p = 1.0 - parabola(uv.x, paraPow);
  float n0 = simplexNoise(vec2(uv.x * 0.1, uv.y * 0.5));
  float n1 = simplexNoise(vec2(uv.x * (freq + freq * 0.5 * n0), uv.y * 4.0 * n0));
  n1 = mapLinear(n1, -1.0, 1.0, 0.0, 1.0);
  color += n1 * strength * (1.0 - color.b * colorAtten) * crease * p;
  return color;
}

void main(){
  // crease: a foreshortening / fold detector from the screen-space uv derivative.
  // It drives BOTH the roundness shading and where the streaks appear — this is what
  // gives the wave its thickness without any normal-based lighting.
  float crease = dFdy(vUv).y * uResolution.y * uCreaseLight;
  crease = clamp(mapLinear(crease, -1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  crease = pow(crease, uCreaseSharpness);
  crease = clamp(smoothstep(0.0, uCreaseSoftness, crease), 0.0, 1.0);

  // Debug visualisations (dev): 1 = crease value, 2 = derivative surface normal.
  if (uDebug > 0.5) {
    if (uDebug < 1.5) { gl_FragColor = vec4(vec3(crease), 1.0); return; }
    vec3 dn = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    gl_FragColor = vec4(dn * 0.5 + 0.5, 1.0); return;
  }

  // Colour: sample the baked 2D palette texture, or fall back to the procedural 1-D
  // gradient (see waveBaseColor).
  vec3 col = waveBaseColor(vUv);
  col = surfaceStreaks(vUv, col, crease);
  col = applyColorGrade(col);

  // Sheen: lift the flat (low-crease) areas toward white. This is
  // pose-dependent (it keys off dFdy(uv.y)), so we keep it gentle and add a robust term.
  col += (1.0 - crease) * 0.25 * uSheen;

  // Pose-robust roundness: shade by the camera-facing ratio of the derivative surface
  // normal so the ribbon reads as a rounded, grabbable solid from any angle. Grazing
  // edges darken into shadow (defining the rounded form), the body keeps its full colour,
  // and the most face-on sliver catches a soft highlight. uRoundness = strength.
  if (uRoundness > 0.001) {
    vec3 volN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float facing = abs(dot(volN, normalize(vViewDir)));   // 1 = facing camera, 0 = edge-on
    col *= mix(1.0 - 0.6 * uRoundness, 1.0, facing);          // deepen grazing edges → solid form
    col += smoothstep(0.65, 1.0, facing) * uRoundness * 0.18; // soft highlight on the facing body
  }

  // Optional positionable lights (our feature) — additive & gentle, on top of the
  // base shading so the default look is preserved. A finely-subdivided mesh
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
  col *= 0.55 + clamp(uAmbient, 0.0, 1.0);   // overall level; default 0.45 => x1.0 (neutral)

  if (uTexture > 0.001) col *= 1.0 + (grainHash(vUv * 850.0) - 0.5) * uTexture * 0.25;

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

  // Deep "squared" hero colour: formerly done by a framebuffer-squaring blend that REPLACED the
  // destination (punching holes at soft edges / where waves overlap). Squaring here + normal
  // premultiplied compositing (see applyBlendMode) keeps the deep colour and blends correctly.
  col = clamp(col, 0.0, 1.0);
  // Square colour AND alpha so the soft ribbon edges keep the crisp, thin feather of the original
  // squared-blend look — but now composited (premultiplied) rather than replace-blended, so they
  // no longer punch holes. Over an opaque background alpha² still resolves to fully opaque.
  if (uSquared > 0.5) { col *= col; alpha *= alpha; }
  gl_FragColor = vec4(col, alpha);
#ifdef PREMULTIPLIED_ALPHA
  gl_FragColor.rgb *= gl_FragColor.a;
#endif
}
`;

// ---- Wireframe "thin-line" theme ----
// The same wave geometry, but instead of a solid surface the colour is carved into fine
// vertical lines (abs(sin(uv.x * lineAmount))) whose thickness scales with the screen-
// space uv derivative, then mixed line<->background with a depth fade. Used by the dark
// hero preset. hueShift takes degrees (radians() here) to match the light shader.
export const lineFragmentShader = /* glsl */ `
#define MAX_COLORS ${MAX_COLORS}
#define MAX_MESH_POINTS ${MAX_MESH_POINTS}
#define PI 3.14159265359

${simplex2d}

${colorUniforms}
uniform float uLineAmount;          // default 425
uniform float uLineThickness;       // default 1
uniform float uLineDerivativePower; // default 0.95
uniform float uMaxWidth;            // default 1232
uniform vec3 uClearColor;           // = page background colour (shown between the lines)

varying vec2 vUv;
varying vec4 vClipPosition;

${colorFns}

void main(){
  // Same 2D palette sample + colour ops as the solid theme.
  vec3 color = applyColorGrade(waveBaseColor(vUv));

  // Carve into fine vertical lines; thickness from the screen-space uv derivative.
  vec2 dy = dFdy(vUv);
  float lineThickness = uLineThickness * pow(abs(dy.x * uMaxWidth), uLineDerivativePower);
  float a = abs(sin(vUv.x * uLineAmount));
  a = smoothstep(lineThickness, 0.0, a);

  // Depth fade: the wave recedes into the background colour with depth. Watch the
  // argument order: clamp(0.0, 1.0, z*6) is a swapped-args trap — it clamps the
  // constant 0.0 into [1.0, z*6], i.e. min(1.0, z*6), which (with our ortho clip.z
  // range) collapses the whole wave to the background. The correct clamp(z*6, 0, 1)
  // gives the proper subtle far-end fade and thin-line look.
  float depthFade = clamp(vClipPosition.z * 6.0, 0.0, 1.0);
  color = mix(uClearColor, color, a * (1.0 - depthFade));
  if (uSquared > 0.5) color *= color; // deep "squared" look, now composited not replace-blended
  gl_FragColor = vec4(color, uOpacity);
#ifdef PREMULTIPLIED_ALPHA
  gl_FragColor.rgb *= gl_FragColor.a;
#endif
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

// Angular (spin) blur: rotate the sample coord around the centre and
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
    coord = coord * rot; // row-vector order (coord * rot) sets the spin direction
  }
  return total * dist;
}

void main(){
  vec4 sceneColor = texture2D(tDiffuse, vUv);
  vec4 blurColor = blurAngular(tDiffuse, vUv, uBlurAmount, uBlurSamples);
  // blurPower: keep a sharp band weighted to the middle, blurring toward top & bottom.
  float blurPower = smoothstep(0.0, 0.7, vUv.y) - smoothstep(0.2, 1.0, vUv.y);
  vec4 color = mix(blurColor, sceneColor, blurPower);
  // Static film grain: keyed off gl_FragCoord only (no uTime), so it doesn't flicker.
  color.rgb += mix(uGrainAmount, -uGrainAmount, random2(gl_FragCoord.xy * 0.01)) * (4.0 / 255.0);
  gl_FragColor = color;   // preserve alpha → transparent background works
}
`;
