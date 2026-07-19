import { MAX_COLORS, MAX_LIGHTS, MAX_MESH_POINTS, MAX_NOISE_BANDS } from "../config/model";

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
uniform float uDetailFreq, uDetailAmount; // 2nd displacement octave (only read under DETAIL_OCTAVE)
uniform float uTwFreqX, uTwFreqY, uTwFreqZ, uTwPowX, uTwPowY, uTwPowZ;
uniform float uLoopSeconds; // seamless-loop period (only read under LOOP_MOTION)

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec4 vClipPosition; // = gl_Position, for the wireframe theme's depth fade

// Pointer field (optional, additive). ALL declarations here sit behind POINTER_FX so a wave with
// no interaction config compiles the exact same program (JS-side uniform entries are always present
// — see makeUniforms — but three only uploads uniforms the compiled program actually declares).
#ifdef POINTER_FX
uniform vec2  uPointer;        // smoothed pointer, NDC (-1..1)
uniform float uPointerActive;  // presence ramp 0..1 × per-wave influence
uniform float uPointerRadius;  // falloff radius in NDC-y units (config radius × 2)
uniform float uPointerAspect;  // drawing-buffer dw/dh (circular screen falloff)
uniform float uPointerAgitate;
uniform float uPointerPush;    // signed membrane dome at the cursor (+ repel / − attract)
uniform float uPointerWake;    // drag-wake trough amplitude (behind the moving cursor)
uniform vec2  uPointerVel;     // smoothed pointer velocity, NDC/s (drag-wake direction)
varying float vPointerFall;    // falloff × presence — consumed by both fragment themes
#ifdef POINTER_RIPPLES
uniform vec2  uRippleOrigin[4]; // NDC
uniform float uRippleAge[4];    // seconds since spawn (CPU-computed)
uniform float uRippleAmp[4];    // shared 0..1 decay envelope per slot (CPU-computed; 0 = slot free)
uniform float uPointerRipple;   // THIS wave's ripple amplitude (scales the shared envelope)
const float RIPPLE_WAVE_SPEED = 0.85; // NDC/s the ring crest travels outward
const float RIPPLE_SIGMA = 0.14;      // gaussian half-width of the travelling packet (NDC)
const float RIPPLE_FREQ = 11.0;       // oscillation within the packet (one crest + faint troughs)
const float RIPPLE_MAX_R = 1.2;       // reach where the crest has fully left the frame
#endif
#endif

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
#ifdef DETAIL_OCTAVE
  // A second, finer octave riding on the broad swell — fine ripples on top of the big shape, a
  // shape vocabulary single-octave displacement can't reach. Shares the loop orbit so it stays
  // periodic when looping.
#ifdef LOOP_MOTION
  pos.y += uDetailAmount * simplexNoise(vec2(pos.x * uDetailFreq, pos.z * uDetailFreq) + loopOff);
#else
  pos.y += uDetailAmount * simplexNoise(vec2(pos.x * uDetailFreq + t, pos.z * uDetailFreq + t));
#endif
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

#ifdef POINTER_FX
  // Pointer field: displace along the wave's own (post-twist) up-axis, weighted by a circular
  // screen-space falloff around the smoothed cursor. Everything here is ADDITIVE and fenced, so
  // the shared path above/below is untouched and byte-identical when POINTER_FX is off.
  vec4 preClip = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
  vec2 dp = (preClip.xy / max(preClip.w, 1.0e-6) - uPointer) * vec2(uPointerAspect, 1.0);
  float fall = smoothstep(uPointerRadius, 0.0, length(dp));
  vPointerFall = fall * uPointerActive;
  // Displacement axis = local +Y carried through the SAME three twist rotations as pos (row-vector
  // convention). Rotations are linear, so post-twist axis displacement equals pre-twist Y displacement.
  vec3 dispAxis = (((vec4(0.0, 1.0, 0.0, 0.0) * rotA) * rotB) * rotC).xyz;
  // Agitation: a fast churn octave near the cursor (additive — never rewrites base noise t, which
  // would force restructuring the shared path). Loop-safe under both time variants.
#ifdef LOOP_MOTION
  float disp = uPointerAgitate * vPointerFall
        * simplexNoise(vec2(pos.x * uDispFreqX * 3.0, pos.z * uDispFreqZ * 3.0) + loopOff * 4.0);
#else
  float disp = uPointerAgitate * vPointerFall
        * simplexNoise(vec2(pos.x * uDispFreqX * 3.0 + t * 4.0, pos.z * uDispFreqZ * 3.0));
#endif
  // Membrane push/pull: a smooth dome (vPointerFall is the falloff) that swells toward you (+ repel)
  // or dents away (− attract) at the cursor, riding along with the sprung field.
  disp += uPointerPush * vPointerFall;
  // Drag-wake: pull the surface just BEHIND the moving cursor into a trailing trough. dp points
  // from cursor to vertex; "behind" is how far the vertex sits opposite the velocity (0 ahead → 1 a
  // radius behind), gated by speed so it only forms while dragging and heals when the cursor stops.
  vec2 velC = uPointerVel * vec2(uPointerAspect, 1.0);
  float wakeSpeed = length(velC);
  if (uPointerWake != 0.0 && wakeSpeed > 1.0e-4) {
    float behind = clamp(dot(-dp, velC) / (wakeSpeed * uPointerRadius), 0.0, 1.0);
    disp -= uPointerWake * vPointerFall * behind * smoothstep(0.05, 0.6, wakeSpeed);
  }
#ifdef POINTER_RIPPLES
  for (int i = 0; i < 4; i++) {
    if (uRippleAmp[i] > 0.0) {
      float rd = length((preClip.xy / max(preClip.w, 1.0e-6) - uRippleOrigin[i]) * vec2(uPointerAspect, 1.0));
      // A wave PACKET whose crest travels outward at RIPPLE_WAVE_SPEED: a gaussian window centred on
      // the moving front carrying a short oscillation (a raised ring with faint trailing troughs),
      // so the energy radiates instead of throbbing at the click point. The shared uRippleAmp
      // envelope fades the whole packet over its lifetime; reach fades it as the crest leaves frame.
      float front = uRippleAge[i] * RIPPLE_WAVE_SPEED;
      float band  = rd - front;
      float packet = exp(-band * band / (2.0 * RIPPLE_SIGMA * RIPPLE_SIGMA)) * cos(band * RIPPLE_FREQ);
      float reach = 1.0 - smoothstep(RIPPLE_MAX_R * 0.7, RIPPLE_MAX_R, front);
      disp += uPointerRipple * uRippleAmp[i] * packet * reach;
    }
  }
#endif
  pos += dispAxis * disp;
#endif

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
uniform float uIridescence;      // thin-film hue shift with view angle (0 = off)
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
#ifdef DEPTH_TINT
uniform float uDepthTint;
uniform vec3 uDepthTintColor;
varying vec4 vClipPosition; // clip-space depth (written by the vertex shader for both programs)
#endif
#ifdef EDGE_FEATHER
uniform float uEdgeFeather; // ribbon long-edge softness (only when it differs from the 0.1 default)
#endif
#ifdef POINTER_FX
uniform float uPointerThin;    // 0..1 local translucency near the cursor
uniform float uPointerHue;     // degrees, local hue rotation near the cursor
uniform float uPointerLighten; // -1..1 local brightness lift near the cursor
varying float vPointerFall;    // falloff × presence, written by the vertex shader
#endif

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

#ifdef POINTER_FX
  // Local hue rotation + brightness lift near the cursor (both fade out with vPointerFall).
  col = hueShift(col, radians(uPointerHue) * vPointerFall);
  col *= 1.0 + uPointerLighten * vPointerFall;
#endif

  // Iridescence: a thin-film / holographic hue that shifts with view angle. Reuses the same
  // camera-facing ratio as roundness (recomputed here, since roundness may be off): grazing parts
  // of the ribbon (low facing) shift hue most, so the colour flows as the ribbon curves. Skipped
  // at 0, so the compiled result is unchanged when off.
  if (uIridescence > 0.001) {
    vec3 iridN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float iridFacing = abs(dot(iridN, normalize(vViewDir)));
    col = hueShift(col, (1.0 - iridFacing) * uIridescence * PI);
  }

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

#ifdef DEPTH_TINT
  // Depth tint: fade far fragments toward a colour so a multi-wave stack gains atmospheric
  // separation — near strands keep their colour, far ones recede. Reuses the clip-space depth the
  // wireframe theme fades with (clamp(z*6), where 1 = far).
  col = mix(col, uDepthTintColor, clamp(vClipPosition.z * 6.0, 0.0, 1.0) * uDepthTint);
#endif

  if (uTexture > 0.001) col *= 1.0 + (grainHash(vUv * 850.0) - 0.5) * uTexture * 0.25;

  // Soft long edges + optional viewport-edge fade. The edge softness is the hardcoded 0.1 by
  // default (literal branch → byte-identical); EDGE_FEATHER swaps in the uEdgeFeather knob only
  // when it differs, so razor-crisp or vapor-soft edges are both reachable.
#ifdef EDGE_FEATHER
  float ribEdge =
    smoothstep(0.0, uEdgeFeather, vUv.y) * (1.0 - smoothstep(1.0 - uEdgeFeather, 1.0, vUv.y));
#else
  float ribEdge = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
#endif
  float alpha = uOpacity * ribEdge;
#ifdef POINTER_FX
  alpha *= clamp(1.0 - uPointerThin * vPointerFall, 0.0, 1.0); // solid: local translucency
#endif
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
#ifdef POINTER_FX
uniform float uPointerThin;    // 0..1 — strands taper to hairlines near the cursor
uniform float uPointerHue;     // degrees, local hue rotation near the cursor
uniform float uPointerLighten; // -1..1 local brightness lift near the cursor
varying float vPointerFall;    // falloff × presence, written by the vertex shader
#endif

${colorFns}

void main(){
  // Same 2D palette sample + colour ops as the solid theme.
  vec3 color = applyColorGrade(waveBaseColor(vUv));

#ifdef POINTER_FX
  color = hueShift(color, radians(uPointerHue) * vPointerFall);
  color *= 1.0 + uPointerLighten * vPointerFall;
#endif

  // Carve into fine vertical lines; thickness from the screen-space uv derivative.
  vec2 dy = dFdy(vUv);
  float lineThickness = uLineThickness * pow(abs(dy.x * uMaxWidth), uLineDerivativePower);
#ifdef POINTER_FX
  lineThickness *= clamp(1.0 - uPointerThin * vPointerFall, 0.0, 1.0); // wireframe: taper strands
#endif
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

// ---- Post pass: ordered (Bayer) dithering ----
//
// DERIVED FROM @paper-design/shaders `image-dithering` (https://github.com/paper-design/shaders,
// Apache-2.0 — see THIRD-PARTY-NOTICES.md). The Bayer matrices, getBayerValue, and the brightness /
// luminance-quantization / hue-preserving "original colours" recolour are paper's. Adapted to a
// post pass: samples the composited scene (tDiffuse) at full-frame vUv instead of paper's sized/fit
// u_image UV, drops the frame/aspect machinery, fixes the 8x8 matrix (paper's default), and gates
// via uDitherStrength. The int[] arrays + dynamic indexing compile because three builds
// ShaderMaterials as "#version 300 es". Runs AFTER OutputPass, so it dithers display-space colour;
// keyed off gl_FragCoord/tDiffuse only (no uTime) → deterministic, friendly to pixel-digest checks.
export const ditherFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uDitherStrength;  // 0..1 mix back toward the original
uniform float uDitherScale;     // pixel-block size in device px (paper: u_pxSize)
uniform float uDitherSteps;     // quantization levels (paper: u_colorSteps)
varying vec2 vUv;

const int bayer2x2[4] = int[4](0, 2, 3, 1);
const int bayer4x4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
const int bayer8x8[64] = int[64](
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21
);
float getBayerValue(vec2 uv, int size){
  ivec2 pos = ivec2(fract(uv / float(size)) * float(size));
  int index = pos.y * size + pos.x;
  if (size == 2) return float(bayer2x2[index]) / 4.0;
  else if (size == 4) return float(bayer4x4[index]) / 16.0;
  else if (size == 8) return float(bayer8x8[index]) / 64.0;
  return 0.0;
}

void main(){
  float pxSize = max(uDitherScale, 1.0);
  vec2 pxSizeUV = gl_FragCoord.xy / pxSize;
  vec2 sampleUV = (floor(gl_FragCoord.xy / pxSize) + 0.5) * pxSize / max(uResolution, vec2(1.0));
  vec4 image = texture2D(tDiffuse, sampleUV);

  float lum = dot(vec3(0.2126, 0.7152, 0.0722), image.rgb);
  float colorSteps = max(floor(uDitherSteps), 1.0);

  float dithering = getBayerValue(pxSizeUV, 8) - 0.5;   // paper's default 8x8 ordered screen
  float brightness = clamp(lum + dithering / colorSteps, 0.0, 1.0);
  brightness = mix(0.0, brightness, image.a);
  float quantLum = floor(brightness * colorSteps + 0.5) / colorSteps;

  // paper's "original colours" path: keep the source hue, quantize luminance.
  vec3 color = image.rgb / max(lum, 0.001) * quantLum;
  float quantAlpha = floor(image.a * colorSteps + 0.5) / colorSteps;
  float opacity = mix(quantLum, 1.0, quantAlpha);

  gl_FragColor = mix(image, vec4(color, opacity), clamp(uDitherStrength, 0.0, 1.0));
}
`;

// ---- Post pass: domain warp (liquid distortion) — another "layered" post shader ----
//
// In the spirit of paper-design/shaders' warp/liquid effects: displace the sample coord by an
// animated fbm field so the whole composite ripples. Self-contained — its own value-noise, no
// dependency on the wave's simplex. It samples the full RGBA at the warped coord, so the
// silhouette (alpha) ripples coherently — the transparent edge wobbles cleanly.
// Runs in the scene zone (before the film grain), so grain stays screen-locked. Time-driven, so
// unlike the dither this pass makes a still frame non-deterministic (same as the wave's own noise).
export const warpFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uWarpAmount;  // max UV displacement (0 = off)
uniform float uWarpScale;   // warp field spatial frequency (higher = finer ripples)
uniform float uWarpSpeed;   // animation speed (0 = frozen distortion)
varying vec2 vUv;

// Compact value-noise fbm — self-contained, so warp never reaches into the wave's simplex.
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);          // smoothstep-weighted interpolation
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++){
    v += amp * vnoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

void main(){
  // Aspect-correct the sample space so ripples stay round on wide frames.
  vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
  vec2 p = vUv * aspect * uWarpScale;
  float t = uTime * uWarpSpeed;
  // Two decorrelated fbm fields drive x/y displacement; flowing through noise space animates it.
  vec2 disp = vec2(
    fbm(p + vec2(0.0, t)),
    fbm(p + vec2(5.2, 1.3) - vec2(t, 0.0))
  ) - 0.5;
  vec2 uv = vUv + disp * uWarpAmount;
  gl_FragColor = texture2D(tDiffuse, uv); // rgba → the silhouette (alpha) ripples too
}
`;

// ---- Post pass: godrays (volumetric light streaks) — another "layered" post shader ----
//
// Radial light-scattering (à la GPU Gems 3): from each pixel, march toward a light point and
// accumulate the wave's own brightness (weighted by alpha, so only opaque pixels emit), then add
// the streaks back. Runs in the scene zone so it scatters the raw, pre-tone-map wave like bloom.
export const godraysFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uGodrays;        // 0..1 strength of the added light
uniform float uGodraysDensity; // ray length / spread
uniform float uGodraysDecay;   // per-sample falloff (<1)
uniform vec2  uGodraysCenter;  // light source, UV (0..1)
varying vec2 vUv;

const int GODRAY_SAMPLES = 24;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  vec2 delta = (vUv - uGodraysCenter) * (uGodraysDensity / float(GODRAY_SAMPLES));
  vec2 coord = vUv;
  float decay = 1.0;
  vec3 rays = vec3(0.0);
  for (int i = 0; i < GODRAY_SAMPLES; i++){
    coord -= delta;
    vec4 s = texture2D(tDiffuse, coord);
    rays += s.rgb * s.a * decay;   // only opaque (wave) pixels emit light
    decay *= uGodraysDecay;
  }
  rays /= float(GODRAY_SAMPLES);
  vec3 outc = src.rgb + rays * uGodrays;
  float outA = max(src.a, luma(rays) * uGodrays); // shafts stay visible over the transparent bg
  gl_FragColor = vec4(outc, clamp(outA, 0.0, 1.0));
}
`;

// ---- Post pass: halftone (rotated dot screen) — a finish-zone "layered" post shader ----
//
// Print-style dots: a rotated grid where each cell's dot grows with local brightness, filled with
// the wave's own colour and transparent between dots — the wave rendered as a dot screen. Runs in
// the finish zone (over the tone-mapped image), keyed off gl_FragCoord so a still frame is stable.
export const halftoneFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uHalftone;      // 0..1 mix
uniform float uHalftoneCell;  // cell size in device px
uniform float uHalftoneAngle; // screen rotation (radians)
varying vec2 vUv;

float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  float ca = cos(uHalftoneAngle);
  float sa = sin(uHalftoneAngle);
  vec2 rot = mat2(ca, sa, -sa, ca) * gl_FragCoord.xy;   // rotate the screen grid
  vec2 cell = fract(rot / max(uHalftoneCell, 2.0)) - 0.5;
  float d = length(cell);
  float radius = clamp(luma(src.rgb), 0.0, 1.0) * 0.5;  // brighter → bigger dot
  float mask = smoothstep(radius, radius - 0.07, d);    // 1 inside the dot, 0 outside
  vec4 dots = vec4(src.rgb, src.a * mask);              // wave-coloured dots on transparency
  gl_FragColor = mix(src, dots, clamp(uHalftone, 0.0, 1.0));
}
`;

// ---- Post pass: chromatic aberration (radial RGB split) — a finish-zone "layered" post shader ----
//
// Lens fringing: sample R/G/B at a radial offset that grows toward the frame edges, so colour
// separates at the periphery and stays crisp in the centre. The union of the three alphas keeps
// the silhouette from tearing open. Runs last, over the final image.
export const chromaFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uChroma;        // 0..1 mix
uniform float uChromaAmount;  // radial offset scale
varying vec2 vUv;

void main(){
  vec2 center = vUv - 0.5;
  vec2 offset = center * dot(center, center) * uChromaAmount * 4.0; // radial, stronger at edges
  vec4 cr = texture2D(tDiffuse, vUv - offset);
  vec4 cg = texture2D(tDiffuse, vUv);
  vec4 cb = texture2D(tDiffuse, vUv + offset);
  vec3 split = vec3(cr.r, cg.g, cb.b);
  float a = max(max(cr.a, cg.a), cb.a); // union → the silhouette doesn't split open
  vec3 outc = mix(cg.rgb, split, clamp(uChroma, 0.0, 1.0));
  gl_FragColor = vec4(outc, mix(cg.a, a, clamp(uChroma, 0.0, 1.0)));
}
`;

// ---- Post pass: heatmap (map luminance → thermal palette) — a finish-zone filter ----
export const heatmapFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uHeatmap;   // 0..1 mix
varying vec2 vUv;
vec3 heat(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.0, 0.0, 0.4), vec3(0.0, 0.6, 1.0), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(0.0, 1.0, 0.4), smoothstep(0.25, 0.5, t));
  c = mix(c, vec3(1.0, 1.0, 0.0), smoothstep(0.5, 0.75, t));
  c = mix(c, vec3(1.0, 0.1, 0.0), smoothstep(0.75, 1.0, t));
  return c;
}
void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(src.rgb, heat(l), clamp(uHeatmap, 0.0, 1.0)), src.a);
}
`;

// ---- Post pass: fluted glass (vertical ribs that refract) — a finish-zone filter ----
export const flutedGlassFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uFluted;      // 0..1 strength
uniform float uFlutedCount; // number of ribs across the frame
varying vec2 vUv;
void main(){
  float ribs = max(uFlutedCount, 1.0);
  float local = fract(vUv.x * ribs) - 0.5;         // position within a rib (-0.5..0.5)
  float shift = local * (0.6 / ribs) * uFluted;    // lens-like horizontal refraction
  vec4 g = texture2D(tDiffuse, vec2(vUv.x + shift, vUv.y));
  float ribShade = 0.85 + 0.15 * cos(local * 3.14159);  // bright at each rib's centre
  gl_FragColor = vec4(g.rgb * mix(1.0, ribShade, clamp(uFluted, 0.0, 1.0)), g.a);
}
`;

// ---- Post pass: paper texture (fibrous substrate shading) — a finish-zone overlay ----
export const paperTextureFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uPaper;      // 0..1 strength
uniform float uPaperScale; // grain scale
varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  vec2 p = gl_FragCoord.xy / max(uPaperScale, 0.5);
  float fiber = h21(floor(p)) * 0.5 + h21(floor(p * vec2(0.3, 3.0))) * 0.5; // directional fibers
  float tex = mix(fiber, h21(gl_FragCoord.xy), 0.3);                        // + fine speckle
  float shade = 1.0 - (tex - 0.5) * 0.35;
  gl_FragColor = vec4(src.rgb * mix(1.0, shade, clamp(uPaper, 0.0, 1.0)), src.a);
}
`;

// ---- Post pass: CMYK halftone (four rotated dot screens) — a finish-zone filter ----
export const halftoneCmykFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uHalftoneCmyk;     // 0..1 mix
uniform float uHalftoneCmykCell; // dot cell size in device px
varying vec2 vUv;
// One rotated halftone dot screen for a channel value.
float dotScreen(vec2 coord, float value, float angle, float cell){
  float ca = cos(angle);
  float sa = sin(angle);
  vec2 r = mat2(ca, sa, -sa, ca) * coord;
  vec2 c = fract(r / max(cell, 2.0)) - 0.5;
  float radius = sqrt(clamp(value, 0.0, 1.0)) * 0.5;
  return smoothstep(radius, radius - 0.06, length(c));
}
void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  float k = 1.0 - max(max(src.r, src.g), src.b);   // RGB → CMYK
  float invK = max(1.0 - k, 1e-3);
  float cyan = (1.0 - src.r - k) / invK;
  float mag = (1.0 - src.g - k) / invK;
  float yel = (1.0 - src.b - k) / invK;
  vec2 coord = gl_FragCoord.xy;
  float cell = uHalftoneCmykCell;
  float dc = dotScreen(coord, cyan, 1.309, cell); // 75°
  float dm = dotScreen(coord, mag, 0.262, cell);  // 15°
  float dy = dotScreen(coord, yel, 0.0, cell);    // 0°
  float dk = dotScreen(coord, k, 0.785, cell);    // 45°
  // Subtractive: cyan ink absorbs red, magenta absorbs green, yellow absorbs blue, black absorbs all.
  vec3 outc = vec3(1.0) - vec3(dc, 0.0, 0.0) - vec3(0.0, dm, 0.0) - vec3(0.0, 0.0, dy) - vec3(dk);
  outc = clamp(outc, 0.0, 1.0);
  gl_FragColor = vec4(mix(src.rgb, outc, clamp(uHalftoneCmyk, 0.0, 1.0)), src.a);
}
`;
