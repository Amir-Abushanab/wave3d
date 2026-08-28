/**
 * Point-probe parity for the ported shader math.
 *
 * Each case evaluates the SAME quantity through the original GLSL and through the TSL port at fixed
 * constant inputs, then compares. Constants (rather than a rendered field) keep UV orientation,
 * quad winding and readback flipping entirely out of the comparison — see parity/README.md for the
 * two traps that produced convincing false failures before this was pinned down.
 */
import * as THREE from "three";
import {
  WebGPURenderer,
  NodeMaterial,
  NoColorSpace,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
} from "three/webgpu";
import { Fn, vec4, vec3, vec2, float, int, mat2, Loop, If, Break, uniform } from "three/tsl";
import { simplexNoise } from "../src/renderer/tsl/noise";
import { expStep, applyTwist, applyHelix, applyRadial } from "../src/renderer/tsl/waveShape";
import type { FloatNode } from "../src/renderer/tsl/types";

/** Shared GLSL prelude: the original implementations, verbatim from ../src/renderer/shaders.ts. */
const GLSL_PRELUDE = /* glsl */ `
float xxhash(vec2 x){
  uvec2 t = floatBitsToUint(x);
  uint h = 0xc2b2ae3du * t.x + 0x165667b9u;
  h = (h << 17u | h >> 15u) * 0x27d4eb2fu;
  h += 0xc2b2ae3du * t.y;
  h = (h << 17u | h >> 15u) * 0x27d4eb2fu;
  h ^= h >> 15u; h *= 0x85ebca77u;
  h ^= h >> 13u; h *= 0xc2b2ae3du;
  h ^= h >> 16u;
  return uintBitsToFloat(h >> 9u | 0x3f800000u) - 1.0;
}
vec2 hash(vec2 x){ float k = 6.283185307 * xxhash(x); return vec2(cos(k), sin(k)); }
float simplexNoise(in vec2 p){
  const float K1 = 0.366025404; const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
  vec3 n = h*h*h*vec3(dot(a, hash(i+0.0)), dot(b, hash(i+o)), dot(c, hash(i+1.0)));
  return dot(n, vec3(32.99));
}
float expStep(float x, float n){ return exp2(-exp2(n) * pow(max(x, 1.0e-3), n)); }
// Mirrors the uniform-count loops in grad() / meshGradient() / surfaceStreaks(): iterate a
// compile-time bound and break on a runtime count.
// Matrix storage order: GLSL's mat2(a,b,c,d) is COLUMN-major. Probing it directly because getting
// it wrong silently reverses a rotation rather than failing to compile.
vec2 matProbe(vec2 v, float a, float b, float c, float d){ return mat2(a, b, c, d) * v; }
const float RIBBON_Z = -8.0;
vec3 applyHelix(vec3 pos, float uvY, float turns, float phaseDeg, float roll, float radius){
  float hAng = 6.28318530718 * turns * uvY + radians(phaseDeg);
  float rollA = hAng * roll;
  float rollC = cos(rollA), rollS = sin(rollA);
  vec2 rel = vec2(pos.y, pos.z - RIBBON_Z);
  pos.y = rel.x * rollC - rel.y * rollS;
  pos.z = RIBBON_Z + rel.x * rollS + rel.y * rollC;
  pos.y += radius * cos(hAng);
  pos.z += radius * sin(hAng);
  return pos;
}
vec3 applyRadial(vec3 pos, vec2 uv, float amount, float arc, float spread, float radius, float center){
  float rAng = radians(center) + (clamp(uv.x, 0.0, 1.0) - 0.5) * radians(arc);
  float rRho = radius + uv.y * 400.0 * spread;
  vec3 rEr = vec3(cos(rAng), sin(rAng), 0.0);
  vec3 rEt = vec3(-sin(rAng), cos(rAng), 0.0);
  vec3 fanned = rEr * rRho + rEt * (pos.z - RIBBON_Z) * 0.5 + vec3(0.0, 0.0, pos.y);
  return mix(pos, fanned, clamp(amount, 0.0, 1.0));
}
float countedLoop(int count){
  float acc = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= count) break;
    acc += float(i + 1) * 0.01;
  }
  return acc;
}
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
vec4 encode(float v){
  float n = clamp(v * 0.5 + 0.5, 0.0, 1.0);
  return vec4(floor(n*255.0)/255.0, floor(fract(n*255.0)*255.0)/255.0, floor(fract(n*65025.0)*255.0)/255.0, 1.0);
}`;

function readCentre(canvas: HTMLCanvasElement): number {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 4;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  const d = ctx.getImageData(1, 1, 1, 1).data;
  return (d[0] / 255 + d[1] / 65025 + d[2] / 16581375) * 2 - 1;
}

async function evalGlsl(expr: string): Promise<number> {
  const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  r.setSize(4, 4, false);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `${GLSL_PRELUDE}\nvoid main(){ gl_FragColor = encode(${expr}); }`,
      }),
    ),
  );
  r.render(scene, cam);
  const v = readCentre(r.domElement);
  r.dispose();
  return v;
}

async function evalTsl(build: () => FloatNode): Promise<number> {
  const r = new WebGPURenderer({ antialias: false, alpha: false });
  r.outputColorSpace = NoColorSpace; // the node path encodes output; ShaderMaterial does not
  await r.init();
  r.setSize(4, 4, false);
  const m = new NodeMaterial();
  m.fragmentNode = Fn(() => {
    const n = build().mul(0.5).add(0.5).clamp(0, 1);
    return vec4(
      n.mul(255).floor().div(255),
      n.mul(255).fract().mul(255).floor().div(255),
      n.mul(65025).fract().mul(255).floor().div(255),
      float(1),
    );
  })();
  const scene = new Scene();
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new Mesh(new PlaneGeometry(2, 2), m));
  r.render(scene, cam);
  const v = readCentre(r.domElement as HTMLCanvasElement);
  r.dispose();
  return v;
}

/** Collapses a vec3 to one scalar so a single probe catches an error in any component. */
const PROBE = "vec3(0.3178, -0.7413, 0.5891)";

interface Case {
  name: string;
  glsl: string;
  tsl: () => FloatNode;
}

function cases(): Case[] {
  const out: Case[] = [];

  for (const [x, y] of [
    [0.3, 0.7],
    [1.5, 2.25],
    [7.3, 3.1],
    [-2.4, 5.9],
  ] as const) {
    out.push({
      name: `simplexNoise(${x}, ${y})`,
      glsl: `simplexNoise(vec2(${x}, ${y}))`,
      tsl: () => simplexNoise(vec2(x, y)),
    });
  }

  // Includes a negative exponent (legal — it concentrates the twist toward the other end) and
  // x = 0, which is exactly the pow(0, n) case the max() guard exists for.
  for (const [x, n] of [
    [0.0, 3.95],
    [0.25, 5.85],
    [0.8, 6.33],
    [0.5, -2.0],
  ] as const) {
    out.push({
      name: `expStep(${x}, ${n})`,
      glsl: `expStep(${x.toFixed(4)}, ${n.toFixed(4)}) * 2.0 - 1.0`,
      tsl: () => expStep(float(x), float(n)).mul(2).sub(1),
    });
  }

  // The twist: the GLSL applies its Rodrigues matrix ROW-vector style, which is a rotation by MINUS
  // the angle. applyTwist claims to reproduce that directly. These are the actual axes the wave uses.
  const twistCases = [
    { v: [12.5, -3.25, 7.75], axis: [0.5, 0.0, 0.5], angle: 0.077 },
    { v: [-40.0, 18.0, 2.5], axis: [0.0, 0.5, 0.5], angle: -0.055 },
    { v: [3.0, 9.0, -21.0], axis: [0.5, 0.0, 0.5], angle: -0.518 },
    { v: [1.0, 1.0, 1.0], axis: [0.0, 0.5, 0.5], angle: 1.7 },
  ] as const;
  for (const { v, axis, angle } of twistCases) {
    const gv = `vec3(${v.map((n) => n.toFixed(4)).join(", ")})`;
    const ga = `vec3(${axis.map((n) => n.toFixed(4)).join(", ")})`;
    out.push({
      name: `twist(${v.join(",")} about ${axis.join(",")} @ ${angle})`,
      glsl: `dot((vec4(${gv}, 1.0) * rotationMatrix(${ga}, ${angle.toFixed(4)})).xyz, ${PROBE}) * 0.02`,
      tsl: () =>
        applyTwist(vec3(...v), { axis: vec3(...axis), angle: float(angle) })
          .dot(vec3(0.3178, -0.7413, 0.5891))
          .mul(0.02),
    });
  }

  // mat2 storage order. TSL's mat2(a,b,c,d) fills ROW-major where GLSL's fills COLUMN-major, so
  // `M_tsl.mul(v)` equals GLSL's `v * M_glsl` for the SAME arguments. Both directions are checked
  // so the claim is pinned rather than inferred from one working case.
  for (const [a, b, c, d] of [
    [1.0, 2.0, 3.0, 4.0],
    [0.6, 0.8, -0.8, 0.6], // a rotation, avoiding the 0.7071 literal the linter reads as SQRT1_2
  ] as const) {
    const args = [a, b, c, d].map((n) => n.toFixed(4)).join(", ");
    out.push({
      name: `mat2(${a},${b},${c},${d}) * v  ==  tsl transpose`,
      // GLSL column-major M times v equals TSL row-major mat2(a, c, b, d) times v.
      glsl: `dot(matProbe(vec2(0.6, -1.3), ${args}), vec2(0.37, 0.81)) * 0.1`,
      tsl: () => mat2(a, c, b, d).mul(vec2(0.6, -1.3)).dot(vec2(0.37, 0.81)).mul(0.1),
    });
    out.push({
      name: `v * mat2(${a},${b},${c},${d})  ==  tsl same args`,
      glsl: `dot(vec2(0.6, -1.3) * mat2(${args}), vec2(0.37, 0.81)) * 0.1`,
      tsl: () => mat2(a, b, c, d).mul(vec2(0.6, -1.3)).dot(vec2(0.37, 0.81)).mul(0.1),
    });
  }

  // The helix, probed the same way the twist is: it is the one shape block the two worst-diverging
  // gallery presets have in common.
  const helixCases = [
    { pos: [10.0, 5.0, 60.0], uvY: 0.25, turns: 2.0, phase: 30.0, roll: 1.0, radius: 40.0 },
    { pos: [-30.0, 12.0, 20.0], uvY: 0.75, turns: 3.5, phase: 0.0, roll: 0.5, radius: 15.0 },
    { pos: [0.0, -8.0, 47.5], uvY: 1.0, turns: 1.0, phase: 180.0, roll: 0.0, radius: 25.0 },
  ] as const;
  for (const c of helixCases) {
    const gp = `vec3(${c.pos.map((n) => n.toFixed(4)).join(", ")})`;
    const gargs = `${c.uvY.toFixed(4)}, ${c.turns.toFixed(4)}, ${c.phase.toFixed(4)}, ${c.roll.toFixed(4)}, ${c.radius.toFixed(4)}`;
    out.push({
      name: `helix(uvY=${c.uvY}, turns=${c.turns}, roll=${c.roll})`,
      glsl: `dot(applyHelix(${gp}, ${gargs}), ${PROBE}) * 0.01`,
      tsl: () =>
        applyHelix(
          vec3(...c.pos),
          float(c.uvY),
          float(c.turns),
          float(c.phase),
          float(c.roll),
          float(c.radius),
        )
          .dot(vec3(0.3178, -0.7413, 0.5891))
          .mul(0.01),
    });
  }

  // The radial fan. Particle Zoo drives it at 0.82 and it is the one shape block that had no probe.
  const radialCases = [
    {
      pos: [12.0, -4.0, 20.0],
      uv: [0.25, 0.6],
      amount: 0.82,
      arc: 160,
      spread: 1,
      radius: 40,
      center: 0,
    },
    {
      pos: [-30.0, 9.0, -8.0],
      uv: [0.8, 0.15],
      amount: 1.0,
      arc: 90,
      spread: 0.5,
      radius: 15,
      center: 45,
    },
    {
      pos: [3.0, 3.0, 3.0],
      uv: [0.5, 1.0],
      amount: 0.4,
      arc: 220,
      spread: 1.5,
      radius: 0,
      center: -30,
    },
  ] as const;
  for (const c of radialCases) {
    const gp = `vec3(${c.pos.map((n) => n.toFixed(4)).join(", ")})`;
    const guv = `vec2(${c.uv.map((n) => n.toFixed(4)).join(", ")})`;
    const args = `${c.amount.toFixed(4)}, ${c.arc.toFixed(4)}, ${c.spread.toFixed(4)}, ${c.radius.toFixed(4)}, ${c.center.toFixed(4)}`;
    out.push({
      name: `radial(amount=${c.amount}, arc=${c.arc}, center=${c.center})`,
      glsl: `dot(applyRadial(${gp}, ${guv}, ${args}), ${PROBE}) * 0.002`,
      tsl: () =>
        applyRadial(
          vec3(...c.pos),
          vec2(...c.uv),
          float(c.amount),
          float(c.arc),
          float(c.spread),
          float(c.radius),
          float(c.center),
        )
          .dot(vec3(0.3178, -0.7413, 0.5891))
          .mul(0.002),
    });
  }

  // Uniform-count loops with an early break drive the palette stops, the mesh-gradient control
  // points and the noise bands. If `Break()` does not actually terminate the loop, every unused
  // slot contributes and the colour is wrong everywhere — so it is worth pinning directly.
  for (const count of [0, 1, 3, 8]) {
    out.push({
      name: `counted loop, break at ${count}`,
      glsl: `countedLoop(${count})`,
      tsl: () => {
        const n = uniform(count, "int");
        const acc = float(0).toVar();
        Loop({ start: 0, end: 8, type: "int" }, ({ i }) => {
          If(float(i).greaterThanEqual(float(n)), () => {
            Break();
          });
          acc.addAssign(float(int(i).add(1)).mul(0.01));
        });
        return acc;
      },
    });
  }

  return out;
}

export async function checkMath(): Promise<
  { name: string; glsl: number; tsl: number; delta: number }[]
> {
  const out = [];
  for (const c of cases()) {
    const glsl = await evalGlsl(c.glsl);
    const tsl = await evalTsl(c.tsl);
    out.push({ name: c.name, glsl, tsl, delta: Math.abs(glsl - tsl) });
  }
  return out;
}

declare global {
  interface Window {
    waveMathCheck: typeof checkMath;
  }
}
window.waveMathCheck = checkMath;
