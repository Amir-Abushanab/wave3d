import { MAX_COLORS, MAX_LIGHTS, MAX_MESH_POINTS, MAX_NOISE_BANDS } from "../config/model";
import { RIBBON_Z_CENTER } from "./WaveGeometry";

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

// The shared wave-shape deform (expStep + rotationMatrix + waveShape), used by BOTH the wave
// vertex shader and the particle shed emitter, so the ribbon and the dust it sheds ride ONE deform.
const waveShapeChunk = /* glsl */ `
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

// The wave SHAPE deform, shared by the wave vertex shader (below) and the particle SHED emitter
// (particleVertexShader): a base hairpin position + its uv → the displaced / helixed / twisted /
// fanned LOCAL position, plus the three twist matrices (the pointer field reads them). Every branch
// sits behind the SAME #ifdef gates as the code it replaces, so a given compiled program is
// byte-identical to the former inline version. t / loopOff are the linear / orbit time the
// caller computed; only the one selected by LOOP_MOTION is read (the other is a dead argument).
struct WaveShape { vec3 pos; mat4 rotA; mat4 rotB; mat4 rotC; };
WaveShape waveShape(vec3 position, vec2 uv, float t, vec2 loopOff){
  // Displacement lifts Y by simplex noise of the (x,z) position.
  vec3 pos = position;
#ifdef LOOP_MOTION
  pos.y += uDispAmount * simplexNoise(vec2(pos.x * uDispFreqX, pos.z * uDispFreqZ) + loopOff);
#else
  pos.y += uDispAmount * simplexNoise(vec2(pos.x * uDispFreqX + t, pos.z * uDispFreqZ + t));
#endif
#ifdef DETAIL_OCTAVE
  // A second, finer octave riding on the broad swell (loop-orbit shared so it stays periodic).
#ifdef LOOP_MOTION
  pos.y += uDetailAmount * simplexNoise(vec2(pos.x * uDetailFreq, pos.z * uDetailFreq) + loopOff);
#else
  pos.y += uDetailAmount * simplexNoise(vec2(pos.x * uDetailFreq + t, pos.z * uDetailFreq + t));
#endif
#endif

#ifdef HELIX
  // Helix — the periodic sweep the three twists (monotone falloffs) can't reach. Runs AFTER the
  // displacement (so the noise still samples undeformed pos) and BEFORE the twist (so they compose).
  float hAng = 6.28318530718 * uHelixTurns * uv.y + radians(uHelixPhase);
  // Roll about the ribbon's width centre, not the origin — see RIBBON_Z_CENTER in WaveGeometry.
  float rollA = hAng * uHelixRoll;
  float rollC = cos(rollA), rollS = sin(rollA);
  vec2 rel = vec2(pos.y, pos.z - ${RIBBON_Z_CENTER.toFixed(1)});
  pos.y = rel.x * rollC - rel.y * rollS;
  pos.z = ${RIBBON_Z_CENTER.toFixed(1)} + rel.x * rollS + rel.y * rollC;
  pos.y += uHelixRadius * cos(hAng);
  pos.z += uHelixRadius * sin(hAng);
#endif

  // The X-twist frequency feeding rotB; the TWIST_MOTION variant modulates it with simplex noise
  // indexed along the ribbon (uv.y) so the twist breathes over time.
  float twistXFreq = uTwFreqX;
#ifdef TWIST_MOTION
#ifdef LOOP_MOTION
  float twistXNoise = simplexNoise(vec2(uv.y * 2.0, 0.0) + loopOff);
#else
  float twistXNoise = simplexNoise(vec2(uv.y * 2.0, t));
#endif
  twistXFreq = uTwFreqX - twistXNoise * 0.1;
#endif

  // Three-axis twist (see the falloff-axis note: rotA keys off uv.x/WIDTH, rotB/rotC off uv.y/LENGTH).
  mat4 rotA = rotationMatrix(vec3(0.5, 0.0, 0.5), uTwFreqY * expStep(uv.x, uTwPowY));
  mat4 rotB = rotationMatrix(vec3(0.0, 0.5, 0.5), twistXFreq * expStep(uv.y, uTwPowX));
  mat4 rotC = rotationMatrix(vec3(0.5, 0.0, 0.5), uTwFreqZ * expStep(uv.y, uTwPowZ));
  pos = (vec4(pos, 1.0) * rotA).xyz;
  pos = (vec4(pos, 1.0) * rotB).xyz;
  pos = (vec4(pos, 1.0) * rotC).xyz;

#ifdef RADIAL
  // Radial fan: remap the ribbon to polar around the LOCAL origin so its LENGTH fans into a plume.
  // uv.x (folded WIDTH) → fan ANGLE across uRadialArc; uv.y (LENGTH) → RADIUS, so a constant-uv.x
  // combed fiber becomes a constant-angle radial spoke. mix(pos, fanned, 0) is identity → off is
  // byte-identical. (Placement is the wave's position transform — the fan has no separate pivot.)
  {
    float rAng = radians(uRadialCenter) + (clamp(uv.x, 0.0, 1.0) - 0.5) * radians(uRadialArc);
    float rRho = uRadialRadius + uv.y * 400.0 * uRadialSpread; // 400 = native ribbon length
    vec3 rEr = vec3(cos(rAng), sin(rAng), 0.0);                // radial dir, in local X–Y (screen plane)
    vec3 rEt = vec3(-sin(rAng), cos(rAng), 0.0);               // tangential
    vec3 fanned = rEr * rRho
                + rEt * (pos.z - ${RIBBON_Z_CENTER.toFixed(1)}) * 0.5
                + vec3(0.0, 0.0, pos.y);
    pos = mix(pos, fanned, clamp(uRadialAmount, 0.0, 1.0));
  }
#endif

  WaveShape s;
  s.pos = pos;
  s.rotA = rotA;
  s.rotB = rotB;
  s.rotC = rotC;
  return s;
}
`;

// The POINTER FIELD, shared by the wave vertex shader and the particle emitter (particleVertexShader)
// exactly as waveShapeChunk shares the deform — so a wave's dust reacts to the cursor through the SAME
// footprint, falloff and displacement its ribbon does instead of staying pinned to the un-poked
// surface. The whole chunk is interpolated INSIDE `#ifdef POINTER_FX` in both callers, so a wave with
// no interaction config compiles the exact same program as before (JS-side uniform entries are always
// present — see makeUniforms — but three only uploads uniforms the compiled program declares).
// Requires simplexNoise and the uDispFreqX / uDispFreqZ shape uniforms declared above.
const pointerFieldChunk = /* glsl */ `
uniform vec2  uPointer;        // smoothed pointer, NDC (-1..1)
uniform float uPointerActive;  // presence ramp 0..1 × per-wave influence
uniform float uPointerRadius;  // falloff radius in NDC-y units (config radius × 2)
uniform float uPointerAspect;  // drawing-buffer dw/dh (circular screen falloff)
uniform float uPointerAgitate;
uniform float uPointerPush;    // signed membrane dome at the cursor (+ repel / − attract)
uniform float uPointerWake;    // drag-wake trough amplitude (behind the moving cursor)
uniform vec2  uPointerVel;     // smoothed pointer velocity, NDC/s (drag-wake direction)
// Ribbon flow: stretch the falloff along the strip's length axis so the field reaches ALONG the
// ribbon rather than as a screen disc. 0 = the plain circular smoothstep (byte-identical when off).
uniform float uShapeFlow;
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

// fall = screen falloff × presence (the wave's vPointerFall, which both fragment themes consume);
// disp = the signed displacement along the surface's own up-axis, which the CALLER applies (the wave
// in its local space, the dust through the wave's world matrix).
struct PointerHit { float fall; float disp; };

// Sample the field for ONE point. ndc is that point's screen position; mvp the clip transform of the
// space rotA/rotB/rotC and churnPos live in (the owning wave's local space); t / loopOff the caller's
// linear / orbit time — only the one selected by LOOP_MOTION is read.
PointerHit pointerField(vec2 ndc, mat4 mvp, mat4 rotA, mat4 rotB, mat4 rotC, vec3 churnPos,
                        float t, vec2 loopOff){
  // Screen-space offset from the cursor (aspect-corrected → round in pixels). The DEFAULT metric.
  vec2 dp = (ndc - uPointer) * vec2(uPointerAspect, 1.0);
  // Ribbon flow: stretch the metric along the strip's own LENGTH axis so the field reaches ALONG the
  // ribbon and stays tight across it — the "flows with the material" feel, per-vertex (so it follows
  // the strip's curve) with no CPU surface pick. The length axis is local +X (uv.x runs with x)
  // carried through the SAME twist as the surface. The camera is orthographic (affine, w=1), so the
  // axis's screen image is the linear map of the DIRECTION (w=0): one mat·dir, no second
  // point-projection and no perspective divide. (A true per-pixel uv would need GPU picking — the
  // visible surface is shader-displaced, so a CPU raycast of the base geometry misses.)
  if (uShapeFlow > 0.0) {
    vec3 tangentLocal = (((vec4(1.0, 0.0, 0.0, 0.0) * rotA) * rotB) * rotC).xyz;
    vec2 tang = (mvp * vec4(tangentLocal, 0.0)).xy * vec2(uPointerAspect, 1.0);
    float tl = length(tang);
    if (tl > 1.0e-6) {
      tang /= tl;
      vec2 nrm = vec2(-tang.y, tang.x);
      dp = vec2(dot(dp, tang) / (1.0 + uShapeFlow * 2.5), dot(dp, nrm)); // up to 3.5× reach along length
    }
  }
  float fall = smoothstep(uPointerRadius, 0.0, length(dp)) * uPointerActive;
  // Agitation: a fast churn octave near the cursor (additive — never rewrites base noise t, which
  // would force restructuring the shared path). Loop-safe under both time variants.
#ifdef LOOP_MOTION
  float disp = uPointerAgitate * fall
        * simplexNoise(vec2(churnPos.x * uDispFreqX * 3.0, churnPos.z * uDispFreqZ * 3.0) + loopOff * 4.0);
#else
  float disp = uPointerAgitate * fall
        * simplexNoise(vec2(churnPos.x * uDispFreqX * 3.0 + t * 4.0, churnPos.z * uDispFreqZ * 3.0));
#endif
  // Membrane push/pull: a smooth dome (fall is the falloff) that swells toward you (+ repel) or dents
  // away (− attract) at the cursor, riding along with the sprung field.
  disp += uPointerPush * fall;
  // Drag-wake: pull the surface just BEHIND the moving cursor into a trailing trough. dp points
  // from cursor to vertex; "behind" is how far the vertex sits opposite the velocity (0 ahead → 1 a
  // radius behind), gated by speed so it only forms while dragging and heals when the cursor stops.
  vec2 velC = uPointerVel * vec2(uPointerAspect, 1.0);
  float wakeSpeed = length(velC);
  if (uPointerWake != 0.0 && wakeSpeed > 1.0e-4) {
    float behind = clamp(dot(-dp, velC) / (wakeSpeed * uPointerRadius), 0.0, 1.0);
    disp -= uPointerWake * fall * behind * smoothstep(0.05, 0.6, wakeSpeed);
  }
#ifdef POINTER_RIPPLES
  for (int i = 0; i < 4; i++) {
    if (uRippleAmp[i] > 0.0) {
      float rd = length((ndc - uRippleOrigin[i]) * vec2(uPointerAspect, 1.0));
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
  PointerHit hit;
  hit.fall = fall;
  hit.disp = disp;
  return hit;
}
`;

export const vertexShader = /* glsl */ `
${simplex2d}

uniform float uTime, uSpeed, uSeed;
uniform float uDispFreqX, uDispFreqZ, uDispAmount;
uniform float uDetailFreq, uDetailAmount; // 2nd displacement octave (only read under DETAIL_OCTAVE)
uniform float uTwFreqX, uTwFreqY, uTwFreqZ, uTwPowX, uTwPowY, uTwPowZ;
uniform float uLoopSeconds; // seamless-loop period (only read under LOOP_MOTION)

// Helix (optional). Behind HELIX so a wave without one compiles the exact same program — same
// byte-identity contract as the pointer block below.
#ifdef HELIX
uniform float uHelixTurns;  // full turns from one end of the ribbon to the other
uniform float uHelixRadius; // orbit radius: carries the whole ribbon around the axis
uniform float uHelixRoll;   // cross-section roll, as a fraction of the turns (1 = rigid ladder)
uniform float uHelixPhase;  // degrees
#endif

// Radial fan (optional). Behind RADIAL so a wave without one compiles the exact same program (same
// byte-identity contract as HELIX / POINTER_FX above).
#ifdef RADIAL
uniform float uRadialAmount; // 0..1 blend (0 = identity)
uniform float uRadialArc;    // fan spread, degrees
uniform float uRadialSpread; // length → radius scale
uniform float uRadialRadius; // source / inner radius
uniform float uRadialCenter; // base angle, degrees
#endif

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec4 vClipPosition; // = gl_Position, for the wireframe theme's depth fade

// Pointer field (optional, additive) — the shared chunk, gated so a wave with no interaction config
// compiles the exact same program. The particle emitter interpolates the SAME chunk, so dust reacts
// through one implementation of the footprint / falloff / displacement.
#ifdef POINTER_FX
${pointerFieldChunk}
varying float vPointerFall;    // falloff × presence — consumed by both fragment themes
#endif

${waveShapeChunk}

void main(){
  vUv = uv;
#ifndef LOOP_MOTION
  float t = uTime * uSpeed + uSeed;
  vec2 loopOff = vec2(0.0); // unused under linear time; kept so waveShape's signature is uniform
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
  float t = 0.0; // unused under loop time
#endif

  // Deform the baked hairpin via the shared waveShape chunk (displacement + helix + twist + radial),
  // which also drives the particle shed emitter. It returns the deformed local pos + the twist
  // matrices the pointer field reads below.
  WaveShape ws = waveShape(position, uv, t, loopOff);
  vec3 pos = ws.pos;

#ifdef POINTER_FX
  // Pointer field: displace along the wave's own (post-twist) up-axis, weighted by a screen-space
  // falloff around the smoothed cursor — a circle at uShapeFlow 0, stretched along the ribbon as it
  // rises. Everything here is ADDITIVE and fenced, so the shared path above/below is untouched and
  // byte-identical when POINTER_FX is off. The field itself lives in pointerFieldChunk, which the
  // particle emitter also calls — so dust reacts through this exact footprint and falloff.
  // Shared clip-space transform, computed once and reused for the cursor metric and the ribbon
  // tangent (the compiler is not guaranteed to CSE the triple product otherwise). Associativity is
  // unchanged, so preClip is bit-for-bit what the plain P*V*M*v product produced.
  mat4 mvp = projectionMatrix * viewMatrix * modelMatrix;
  vec4 preClip = mvp * vec4(pos, 1.0);
  PointerHit hit = pointerField(preClip.xy / max(preClip.w, 1.0e-6), mvp,
                                ws.rotA, ws.rotB, ws.rotC, pos, t, loopOff);
  vPointerFall = hit.fall;
  // Displacement axis = local +Y carried through the SAME three twist rotations as pos (row-vector
  // convention). Rotations are linear, so post-twist axis displacement equals pre-twist Y displacement.
  vec3 dispAxis = (((vec4(0.0, 1.0, 0.0, 0.0) * ws.rotA) * ws.rotB) * ws.rotC).xyz;
  pos += dispAxis * hit.disp;
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
uniform float uEdgeFeather; // softness of the ribbon's two ENDS (only when it differs from 0.1)
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
  // The high frequency runs along uv.x (the folded WIDTH — see WaveGeometry's UV AXES note),
  // packing many thin stripes across the cross-section while uv.y is barely scaled, so each
  // one stretches out into a fine LENGTHWISE fiber. 1 - parabola(uv.x) then weights them
  // toward the two long edges and away from the width centreline.
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

  // Soft ribbon ENDS (it fades on vUv.y, the length) + optional viewport-edge fade. The edge
  // softness is the hardcoded 0.1 by
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
// LENGTHWISE strands (abs(sin(uv.x * lineAmount)) — uv.x is the folded width, so lineAmount
// counts strands ACROSS the cross-section and each runs end to end) whose thickness scales
// with the screen-space uv derivative, then mixed line<->background with a depth fade. Used by the dark
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
// Cross-wise rungs (optional) — behind RUNGS so a wave without them compiles the same program.
#ifdef RUNGS
uniform float uRungAmount;    // frequency across the ribbon (rungs ≈ amount / π)
uniform float uRungThickness; // rung width in pixels
#endif
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

  // Carve into fine lengthwise strands; thickness from the screen-space uv derivative.
  vec2 dy = dFdy(vUv);
  float lineThickness = uLineThickness * pow(abs(dy.x * uMaxWidth), uLineDerivativePower);
#ifdef POINTER_FX
  lineThickness *= clamp(1.0 - uPointerThin * vPointerFall, 0.0, 1.0); // wireframe: taper strands
#endif
  float a = abs(sin(vUv.x * uLineAmount));
  a = smoothstep(lineThickness, 0.0, a);

#ifdef RUNGS
  // Rungs: the same carve at constant uv.y instead of uv.x, so this family runs ACROSS the ribbon
  // where the one above runs along it — together they read as a ladder. Width comes from fwidth()
  // rather than the lengthwise term's dFdy(vUv).x, which is the derivative of the wrong axis for
  // this direction: |sin| climbs by ~uRungAmount·fwidth(vUv.y) per pixel, so scaling by that keeps
  // a rung uRungThickness pixels wide at any zoom or ribbon scale.
  float rung = abs(sin(vUv.y * uRungAmount));
  a = max(a, smoothstep(uRungThickness * uRungAmount * fwidth(vUv.y), 0.0, rung));
#endif

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

// ---- Post pass: innerLight (volumetric light streaks) — another "layered" post shader ----
//
// Radial light-scattering (à la GPU Gems 3): from each pixel, march toward a light point and
// accumulate the wave's own brightness (weighted by alpha, so only opaque pixels emit), then add
// the streaks back. Runs in the scene zone so it scatters the raw, pre-tone-map wave like bloom.
export const innerLightFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uInnerLight;        // 0..1 strength of the added light
uniform float uInnerLightDensity; // ray length / spread
uniform float uInnerLightDecay;   // per-sample falloff (<1)
uniform vec2  uInnerLightCenter;  // light source, UV (0..1)
varying vec2 vUv;

const int LIGHT_SAMPLES = 24;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main(){
  vec4 src = texture2D(tDiffuse, vUv);
  vec2 delta = (vUv - uInnerLightCenter) * (uInnerLightDensity / float(LIGHT_SAMPLES));
  vec2 coord = vUv;
  float decay = 1.0;
  vec3 rays = vec3(0.0);
  for (int i = 0; i < LIGHT_SAMPLES; i++){
    coord -= delta;
    vec4 s = texture2D(tDiffuse, coord);
    rays += s.rgb * s.a * decay;   // only opaque (wave) pixels emit light
    decay *= uInnerLightDecay;
  }
  rays /= float(LIGHT_SAMPLES);
  vec3 outc = src.rgb + rays * uInnerLight;
  float outA = max(src.a, luma(rays) * uInnerLight); // shafts stay visible over the transparent bg
  gl_FragColor = vec4(outc, clamp(outA, 0.0, 1.0));
}
`;

// ---- Post pass: halftone (rotated dot screen) ----
//
// DERIVED FROM @paper-design/shaders `halftone-dots` (https://github.com/paper-design/shaders,
// Apache-2.0 — see THIRD-PARTY-NOTICES.md). Ports the "classic" dot type + "original colours" path:
// paper's getCircle (dot radius ← 1 − luminance, fwidth-antialiased) and sigmoid-contrast luminance,
// sampled once per cell centre. Adapted to a post pass — samples the composited scene (tDiffuse)
// instead of paper's sized u_image, drops the gooey/holes/soft dot types, the diagonal grid and the
// grain layers, and composites transparent between dots. Contrast/radius fixed at paper's defaults.
export const halftoneFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uHalftone;      // 0..1 mix
uniform float uHalftoneCell;  // dot cell size in device px (paper: u_size)
uniform float uHalftoneAngle; // screen rotation (radians, paper: u_rotation)
varying vec2 vUv;

float sigmoid(float x, float k){ return 1.0 / (1.0 + exp(-k * (x - 0.5))); }
// paper's classic dot: radius grows as the sampled cell darkens (1 - lum), soft edge via fwidth.
float getCircle(vec2 uv, float lum, float baseR){
  float r = mix(0.25 * baseR, 0.0, lum);
  float d = length(uv - 0.5);
  float aa = fwidth(d);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

void main(){
  float ca = cos(uHalftoneAngle);
  float sa = sin(uHalftoneAngle);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float cell = max(uHalftoneCell, 2.0);
  vec2 gridPx = rot * gl_FragCoord.xy;                      // rotate the screen into the dot grid
  vec2 cellId = floor(gridPx / cell);
  vec2 inCell = fract(gridPx / cell);                       // position within the cell (0..1)
  vec2 centrePx = transpose(rot) * ((cellId + 0.5) * cell); // cell centre, back in screen px
  vec4 tex = texture2D(tDiffuse, centrePx / max(uResolution, vec2(1.0)));

  float k = 2.0;                                            // sigmoid contrast (paper default)
  vec3 c = vec3(sigmoid(tex.r, k), sigmoid(tex.g, k), sigmoid(tex.b, k));
  float lum = dot(vec3(0.2126, 0.7152, 0.0722), c);
  lum = mix(1.0, lum, tex.a);
  float dot = getCircle(inCell, lum, 1.3);                 // baseR 1.3 ≈ paper original-colours default
  vec4 dots = vec4(tex.rgb, tex.a * dot);                  // wave-coloured dots, transparent between
  gl_FragColor = mix(texture2D(tDiffuse, vUv), dots, clamp(uHalftone, 0.0, 1.0));
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

// ---------------------------------------------------------------------------------------------
// Particle field (additive dust / sparkle) — ONE per wave. A THREE.Points ShaderMaterial: every
// particle's position + life is a pure function of uTime + baked per-particle attributes (aSeed / aRnd
// / aUv), so the whole field is deterministic (timeOffset scrub / loopSeconds / paused all hold).
// Every particle spawns on the OWNING wave's DEFORMED surface / edge (via the shared waveShape chunk,
// riding the exact deform the ribbon uses) and drifts outward from the wave centre as it ages. The
// wave's shape #defines (HELIX/RADIAL/…) are mirrored onto this material in configure().
// ---------------------------------------------------------------------------------------------
export const particleVertexShader = /* glsl */ `
attribute float aSeed;
attribute vec4 aRnd;
attribute vec2 aUv; // where this particle spawns on the ribbon (x = flank, y = along length; edge-biased at build)

uniform float uTime, uLoopSeconds, uLife, uSize, uSizeJitter, uTwinkle, uPixelRatio;
uniform float uPartSpeed;
uniform vec3 uColor, uColor2, uCenter, uRight, uUp;
uniform float uDrift, uRise, uSwirl, uWander;

// The owning wave's shape, mirrored in configure() so the dust rides the SAME deform as the ribbon.
// The HELIX/RADIAL uniform blocks are declared only when the matching #define is set.
${simplex2d}
uniform float uDispFreqX, uDispFreqZ, uDispAmount;
uniform float uDetailFreq, uDetailAmount;
uniform float uTwFreqX, uTwFreqY, uTwFreqZ, uTwPowX, uTwPowY, uTwPowZ;
#ifdef HELIX
uniform float uHelixTurns, uHelixRadius, uHelixRoll, uHelixPhase;
#endif
#ifdef RADIAL
uniform float uRadialAmount, uRadialArc, uRadialSpread, uRadialRadius, uRadialCenter;
#endif
uniform mat4 uShedModel;              // the wave's matrixWorld (deformed LOCAL → world)
uniform float uShedSpeed, uShedSeed;
${waveShapeChunk}

// The cursor. Same chunk the ribbon uses, mirrored onto this material in ParticleField.configure(),
// and behind the same POINTER_FX gate — a wave with no hover field compiles the point program it
// always did. uPartShove is the one particle-only knob (see the two samples in main).
#ifdef POINTER_FX
${pointerFieldChunk}
uniform float uPartShove; // how hard the cursor shoves dust that has already drifted free (0 = off)
#endif

varying float vAlpha;
varying vec3 vColor;
varying vec2 vDir; // screen-space motion direction (for the streak sprite)

const float TAU = 6.28318530718;

void main(){
  // Deterministic life: age 0..1 from uTime + a per-particle seed. Advances once per loop period when
  // looping (so the whole field repeats seamlessly), else once per uLife seconds. uPartSpeed scales the
  // cadence (motion speed); under a loop it snaps to a whole number of cycles so the seam stays seamless.
  float cyc = max(1.0, floor(uPartSpeed + 0.5));
  float rate = (uLoopSeconds > 0.0) ? (uTime / uLoopSeconds * cyc) : (uTime * uPartSpeed / max(uLife, 0.001));
  float age = fract(rate + aSeed);
  float fade = sin(3.14159265 * age); // 0 at birth/death, 1 mid-life

  // Spawn on the owning wave's DEFORMED surface / edge at aUv (via the shared waveShape), then peel
  // outward from the wave centre as the particle ages — silk dissolving into glitter.
  float ts = uTime * uShedSpeed + uShedSeed;
  vec2 loopOff = vec2(0.0);
#ifdef LOOP_MOTION
  float loopTheta = uTime * (TAU / uLoopSeconds) + uShedSeed;
  float loopR = uShedSpeed * uLoopSeconds * 0.159154943092;
  loopOff = loopR * vec2(cos(loopTheta), sin(loopTheta));
  ts = 0.0;
#endif
  // Approximate the base hairpin point for this uv (length from uv.y; width centre), then deform it
  // exactly as the wave does. Good enough for dust — the fan / displacement dominate.
  vec3 base = vec3((aUv.y - 0.5) * 400.0, 0.0, ${RIBBON_Z_CENTER.toFixed(1)});
  WaveShape ws = waveShape(base, aUv, ts, loopOff);
  vec3 origin = (uShedModel * vec4(ws.pos, 1.0)).xyz;
  vec3 outward = normalize(origin - uCenter + vec3(1e-4));

#ifdef POINTER_FX
  // WELD (applied below, once the mote's own motion is known). The ribbon displaces its surface by
  // pointerField() along its own post-twist up-axis; a mote sitting ON that surface has to take the
  // same ride, or the cursor's dome lifts the silk out from under its own glitter. Sampled at the
  // SPAWN point and carried through the local→world matrix exactly as the ribbon's own
  // pos += dispAxis * disp is, so the two land on the same place. Sampling at the spawn point also
  // leaves outward derived from the UNDISPLACED origin, so a poke never bends the drift direction.
  mat4 pMvp = projectionMatrix * viewMatrix * uShedModel;
  vec4 originClip = pMvp * vec4(ws.pos, 1.0);
  vec3 dispAxis = mat3(uShedModel) * (((vec4(0.0, 1.0, 0.0, 0.0) * ws.rotA) * ws.rotB) * ws.rotC).xyz;
  PointerHit weld = pointerField(originClip.xy / max(originClip.w, 1.0e-6), pMvp,
                                 ws.rotA, ws.rotB, ws.rotC, ws.pos, ts, loopOff);
#endif

  vec3 p = origin + outward * age * uDrift + (aRnd.xyz - 0.5) * age * uDrift * 0.35;

  // Motion styles, each 0 = off, all riding age so they stay loop-safe (the age wrap is hidden by
  // fade→0 at birth/death). rise = screen-vertical buoyancy (embers up / snow down); swirl = orbit
  // around the wave centre in the screen plane; wander = curl-noise turbulence (fireflies / motes).
  p += uUp * age * uRise;
  // How far this mote travels away from its birth patch over a WHOLE life — the straight-line terms
  // plus, under swirl, the arc it sweeps at its own orbit radius. Only the pointer weld reads it
  // (0 for dust that merely clings to the surface, which is exactly the case age would get wrong),
  // so it is fenced like everything else the cursor drives.
#ifdef POINTER_FX
  float span = abs(uDrift) * 1.35 + abs(uRise) + uWander;
#endif
  if (uSwirl != 0.0) {
    vec3 nrm = cross(uRight, uUp);
    vec3 rel = p - uCenter;
#ifdef POINTER_FX
    span += abs(uSwirl) * TAU * length(rel);
#endif
    float rx = dot(rel, uRight), ry = dot(rel, uUp), rz = dot(rel, nrm);
    float a = age * uSwirl * TAU;
    float ca = cos(a), sa = sin(a);
    p = uCenter + uRight * (rx * ca - ry * sa) + uUp * (rx * sa + ry * ca) + nrm * rz;
  }
  if (uWander != 0.0) {
    vec2 wan = vec2(simplexNoise(vec2(aSeed * 17.0, age * 3.0)),
                    simplexNoise(vec2(age * 3.0, aSeed * 23.0)));
    p += (uRight * wan.x + uUp * wan.y) * uWander;
  }

#ifdef POINTER_FX
  // How attached to its birth patch this mote still is: 1 while it sits on the surface, 0 once it
  // has travelled a full life's worth away. Measured from the DISTANCE it actually moved rather than
  // from age, because dust with no drift / rise / swirl / wander never leaves the surface at all —
  // an age fade would quietly stop that dust from following the ribbon halfway through its life.
  float attach = span > 1.0e-4 ? 1.0 - clamp(length(p - origin) / span, 0.0, 1.0) : 1.0;
  p += dispAxis * (weld.disp * attach);
  // SHOVE: the exact complement. The same field sampled at the mote's OWN screen position, so the
  // cursor also pushes dust that has already left the surface — and a click ripple visibly blows
  // through the cloud instead of stopping dead at the ribbon. Uniform branch (warp-coherent), so
  // uPartShove 0 costs nothing.
  if (uPartShove != 0.0) {
    vec4 pClip = projectionMatrix * viewMatrix * vec4(p, 1.0);
    PointerHit shove = pointerField(pClip.xy / max(pClip.w, 1.0e-6), pMvp,
                                    ws.rotA, ws.rotB, ws.rotC, ws.pos, ts, loopOff);
    p += dispAxis * (shove.disp * (1.0 - attach) * uPartShove);
  }
#endif

  float tw = 0.5 + 0.5 * sin((age * 9.0 + aSeed) * TAU); // loop-safe flicker (rides age)
  vAlpha = fade * mix(1.0, tw, clamp(uTwinkle, 0.0, 1.0));
  vColor = mix(uColor, uColor2, aRnd.w); // two-tone dust: per-particle blend of the two colours
  vDir = normalize(vec2(dot(outward, uRight), dot(outward, uUp)) + vec2(1e-4)); // outward, in screen space
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  // Orthographic camera → point size is constant in device pixels (no perspective depth divide).
  float jitter = 1.0 + uSizeJitter * (aSeed - 0.5) * 2.0;
  gl_PointSize = max(uSize * uPixelRatio * jitter * fade, 0.0);
}
`;

export const particleFragmentShader = /* glsl */ `
precision highp float;
uniform float uShape; // 0 glitter · 1 soft · 2 ring · 3 star · 4 streak
varying float vAlpha;
varying vec3 vColor;
varying vec2 vDir;
// User artwork (shape "sprite"), behind a define so a field without one compiles the exact same
// program — and so the sampler only exists once a texture is actually bound to it. ONE texture is
// shared by every particle in the field; see ParticleField.loadSprite for the rasterization.
#ifdef PARTICLE_SPRITE
uniform sampler2D uSprite;
#endif
void main(){
#ifdef PARTICLE_SPRITE
  // gl_PointCoord's origin is the sprite's TOP-left with y running DOWN, so it has to be flipped or
  // every sprite draws upside down. The procedural shapes below never needed this — they are all
  // symmetric about y, which is exactly why the bug would have gone unnoticed.
  vec4 tex = texture2D(uSprite, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));
  float a = tex.a * vAlpha;
  if (a <= 0.0) discard;
  // Tinted by the dust colour so color / color2 keep working: white artwork takes the tint
  // exactly, coloured artwork multiplies it.
  gl_FragColor = vec4(vColor * tex.rgb, a);
#else
  vec2 pc = gl_PointCoord - 0.5;
  float d = length(pc);
  int s = int(uShape + 0.5);
  float a;
  if (s == 1) {                    // soft: a diffuse gaussian blob (motes / pollen)
    a = exp(-d * d * 7.0);
  } else if (s == 2) {             // ring: a hollow band (bubbles)
    a = smoothstep(0.09, 0.0, abs(d - 0.34));
  } else if (s == 3) {             // star: a 4-point sparkle
    float ang = atan(pc.y, pc.x);
    float spike = pow(abs(cos(ang * 2.0)), 6.0);
    a = smoothstep(1.0, 0.0, d / (0.14 + 0.5 * spike));
  } else if (s == 4) {             // streak: an elongated comet along the motion direction
    float along = dot(pc, vDir);
    float perp = dot(pc, vec2(-vDir.y, vDir.x));
    a = smoothstep(0.5, 0.0, length(vec2(along * 0.42, perp * 2.2)));
  } else {                         // glitter (0): the soft round additive disc
    a = smoothstep(0.5, 0.0, d);
  }
  a *= vAlpha;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor, a); // AdditiveBlending (src = SrcAlpha) → adds vColor·a
#endif
}
`;
