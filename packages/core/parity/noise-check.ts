/**
 * Numeric check of the TSL noise port against the GLSL original. Both render the SAME noise field
 * to a float-encoded RGBA target; any divergence in the hash or the simplex reconstruction shows up
 * as a non-zero delta. This is checked separately from the preset parity run because a noise
 * mismatch changes every wave's silhouette — it needs to fail on its own terms, not as 22 confusing
 * preset failures.
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
import { Fn, vec4, uv, float } from "three/tsl";
import { simplexNoise } from "../src/renderer/tsl/noise";

const SIZE = 256;
const SCALE = 7.3; // an irrational-ish scale so the sampled lattice hits varied cell phases

// Encode a float in [-1,1] across RGB at 24-bit precision, so a delta far below 8-bit shows up.
const ENCODE_GLSL = /* glsl */ `
vec4 encode(float v){
  float n = clamp(v * 0.5 + 0.5, 0.0, 1.0);
  float r = floor(n * 255.0) / 255.0;
  float g = floor(fract(n * 255.0) * 255.0) / 255.0;
  float b = floor(fract(n * 65025.0) * 255.0) / 255.0;
  return vec4(r, g, b, 1.0);
}`;

const GLSL_SIMPLEX = /* glsl */ `
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
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
  return dot(n, vec3(32.99));
}`;

function readCanvas(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

async function renderGlsl(): Promise<Uint8ClampedArray> {
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `varying vec2 vUv;
${GLSL_SIMPLEX}
${ENCODE_GLSL}
void main(){ gl_FragColor = encode(simplexNoise(vUv * ${SCALE.toFixed(1)})); }`,
      }),
    ),
  );
  renderer.render(scene, cam);
  const px = readCanvas(renderer.domElement);
  renderer.dispose();
  return px;
}

async function renderTsl(): Promise<Uint8ClampedArray> {
  const renderer = new WebGPURenderer({ antialias: false, alpha: false });
  renderer.outputColorSpace = NoColorSpace; // node path encodes output; ShaderMaterial does not
  await renderer.init();
  renderer.setSize(SIZE, SIZE, false);
  const material = new NodeMaterial();
  material.fragmentNode = Fn(() => {
    const v = simplexNoise(uv().mul(SCALE));
    const n = v.mul(0.5).add(0.5).clamp(0, 1);
    const r = n.mul(255).floor().div(255);
    const g = n.mul(255).fract().mul(255).floor().div(255);
    const b = n.mul(65025).fract().mul(255).floor().div(255);
    return vec4(r, g, b, float(1));
  })();
  const scene = new Scene();
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));
  renderer.render(scene, cam);
  const px = readCanvas(renderer.domElement as HTMLCanvasElement);
  renderer.dispose();
  return px;
}

function decode(d: Uint8ClampedArray, i: number): number {
  return (d[i] / 255 + d[i + 1] / 65025 + d[i + 2] / 16581375) * 2 - 1;
}

export async function checkNoise(): Promise<{ maxAbs: number; mean: number; samples: number }> {
  const [a, b] = await Promise.all([renderGlsl(), renderTsl()]);
  let maxAbs = 0;
  let sum = 0;
  const n = SIZE * SIZE;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(decode(a, i) - decode(b, i));
    if (d > maxAbs) maxAbs = d;
    sum += d;
  }
  return { maxAbs, mean: sum / n, samples: n };
}

declare global {
  interface Window {
    waveNoiseCheck: typeof checkNoise;
  }
}
window.waveNoiseCheck = checkNoise;
