// Generative background shaders — paper-design/shaders-style animated backdrops rendered BEHIND
// the wave. Each is a fullscreen fragment shader driven by a common uniform set (uResolution,
// uTime, uColors[], uColorCount, uSpeed, uScale). They render to an offscreen target that the
// renderer assigns to `scene.background` (see WaveRenderer.applyShaderBackground), so they reuse
// the existing background seam and never touch the post-processing composer chain.
//
// Colours come in LINEAR (hexToLinearVec3), the target is linear-tagged, and OutputPass encodes
// the whole composite to sRGB at the end — same working space as the wave itself. Written in the
// gl_FragColor / texture2D style three's ShaderMaterial accepts (transpiled to #version 300 es).

export const MAX_BG_COLORS = 8;

/** Fullscreen vertex shader (same fullscreen mapping the post passes use). */
export const bgVertexShader = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Uniform declarations + helpers prepended to every background fragment shader.
const bgCommon = /* glsl */ `
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uColors[${MAX_BG_COLORS}];
uniform int uColorCount;
uniform float uSpeed;
uniform float uScale;
varying vec2 vUv;

// Aspect-correct centred coordinates (~[-0.5..0.5] on the short axis).
vec2 bgCoord(){
  vec2 p = vUv - 0.5;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  return p;
}
// Sample the palette (loop-counter indexing → portable) at t in [0,1].
vec3 palette(float t){
  float s = clamp(t, 0.0, 1.0) * float(max(uColorCount - 1, 1));
  int idx = int(floor(s));
  float f = fract(s);
  vec3 a = uColors[0];
  vec3 b = uColors[0];
  for (int k = 0; k < ${MAX_BG_COLORS}; k++){
    if (k == idx) a = uColors[k];
    if (k == idx + 1) b = uColors[k];
  }
  return mix(a, b, f);
}
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.0; a *= 0.5; }
  return v;
}
`;

/** Wrap a `main` body (that writes gl_FragColor) into a full fragment shader with the shared prelude. */
function bg(body: string): string {
  return `${bgCommon}\nvoid main(){\n${body}\n}\n`;
}

interface BgShaderDef {
  label: string;
  fragmentShader: string;
}

/** The registry. Adding a generative background = one more entry here. */
export const BACKGROUND_SHADERS: Record<string, BgShaderDef> = {
  swirl: {
    label: "Swirl",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale;
      float t = uTime * uSpeed;
      float a = atan(p.y, p.x);
      float r = length(p);
      float v = sin(a * 5.0 + r * 8.0 - t * 2.0) * 0.5 + 0.5;
      gl_FragColor = vec4(palette(v), 1.0);
    `),
  },
  waves: {
    label: "Waves",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale;
      float t = uTime * uSpeed;
      float band = p.y * 3.0 + sin(p.x * 4.0 + t) * 0.35 + fbm(p * 2.0 + t * 0.2) * 0.6;
      float v = fract(band * 0.5);
      gl_FragColor = vec4(palette(v), 1.0);
    `),
  },
  metaballs: {
    label: "Metaballs",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale;
      float t = uTime * uSpeed;
      float m = 0.0;
      for (int i = 0; i < 5; i++){
        float fi = float(i);
        vec2 c = 0.6 * vec2(sin(t + fi * 1.7), cos(t * 0.8 + fi * 2.3));
        m += 0.12 / (length(p - c) + 0.02);
      }
      gl_FragColor = vec4(palette(smoothstep(0.8, 1.8, m)), 1.0);
    `),
  },
  voronoi: {
    label: "Voronoi",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale * 4.0;
      float t = uTime * uSpeed;
      vec2 g = floor(p);
      vec2 f = fract(p);
      float md = 8.0;
      vec2 mcell = vec2(0.0);
      for (int y = -1; y <= 1; y++){
        for (int x = -1; x <= 1; x++){
          vec2 o = vec2(float(x), float(y));
          float h = hash21(g + o);
          vec2 pt = o + 0.5 + 0.4 * vec2(sin(t + 6.2831 * h), cos(t + 6.2831 * h));
          float d = length(pt - f);
          if (d < md){ md = d; mcell = g + o; }
        }
      }
      float v = hash21(mcell);
      gl_FragColor = vec4(palette(v) * (0.4 + 0.6 * smoothstep(0.0, 0.1, md)), 1.0);
    `),
  },
  spiral: {
    label: "Spiral",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale;
      float t = uTime * uSpeed;
      float a = atan(p.y, p.x);
      float r = length(p);
      float v = fract((a / 6.2831853) * 6.0 + r * 4.0 - t * 0.5);
      gl_FragColor = vec4(palette(v), 1.0);
    `),
  },
  dotOrbit: {
    label: "Dot orbit",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale * 6.0;
      float t = uTime * uSpeed;
      vec2 cell = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash21(cell);
      vec2 orbit = 0.32 * vec2(cos(t + 6.2831 * h), sin(t + 6.2831 * h));
      float dot = smoothstep(0.28, 0.2, length(f - orbit));
      gl_FragColor = vec4(mix(palette(0.1) * 0.35, palette(h), dot), 1.0);
    `),
  },
  dotGrid: {
    label: "Dot grid",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale * 8.0;
      float t = uTime * uSpeed;
      vec2 f = fract(p) - 0.5;
      float pulse = 0.6 + 0.4 * sin(t + length(floor(p)) * 0.6);
      float dot = smoothstep(0.36 * pulse, 0.3 * pulse, length(f));
      gl_FragColor = vec4(mix(palette(0.05) * 0.25, palette(0.75), dot), 1.0);
    `),
  },
  colorPanels: {
    label: "Color panels",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale;
      float t = uTime * uSpeed;
      float v = 0.0;
      for (int i = 0; i < 4; i++){
        float fi = float(i);
        v += 0.25 * (0.5 + 0.5 * sin(p.x * 1.5 + p.y * (0.6 + fi * 0.3) + t * (0.4 + fi * 0.2) + fi));
      }
      gl_FragColor = vec4(palette(v), 1.0);
    `),
  },
  neuroNoise: {
    label: "Neuro noise",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale * 2.0;
      float t = uTime * uSpeed;
      vec2 q = vec2(fbm(p + t * 0.1), fbm(p + vec2(5.2, 1.3) - t * 0.1));
      float n = fbm(p + 2.0 * q);
      float ridge = abs(2.0 * fract(n * 3.0) - 1.0);
      gl_FragColor = vec4(palette(pow(1.0 - ridge, 2.0)), 1.0);
    `),
  },
  smokeRing: {
    label: "Smoke ring",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale;
      float t = uTime * uSpeed;
      float ring = exp(-pow((length(p) - 0.32) * 4.5, 2.0));
      float smoke = fbm(p * 3.0 + vec2(t * 0.3, -t * 0.2));
      gl_FragColor = vec4(palette(clamp(ring * (0.6 + 0.8 * smoke), 0.0, 1.0)), 1.0);
    `),
  },
  gemSmoke: {
    label: "Gem smoke",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale;
      float t = uTime * uSpeed;
      float n = fbm(p * 2.5 + vec2(t * 0.2, t * 0.15));
      float facet = floor(n * 6.0) / 6.0;
      gl_FragColor = vec4(palette(fract(facet + 0.15 * fbm(p * 8.0))), 1.0);
    `),
  },
  grainGradient: {
    label: "Grain gradient",
    fragmentShader: bg(`
      float t = uTime * uSpeed;
      float g = (vUv.x + vUv.y) * 0.5 * uScale + 0.1 * sin(t);
      float grain = hash21(gl_FragCoord.xy + fract(t)) - 0.5;
      gl_FragColor = vec4(palette(clamp(g + grain * 0.15, 0.0, 1.0)), 1.0);
    `),
  },
  liquidMetal: {
    label: "Liquid metal",
    fragmentShader: bg(`
      vec2 p = bgCoord() * uScale * 2.0;
      float t = uTime * uSpeed;
      float n = fbm(p + vec2(sin(t * 0.5), cos(t * 0.4)));
      float m = 0.5 + 0.5 * sin(n * 10.0 + t);
      gl_FragColor = vec4(palette(n) * (0.5 + 0.5 * m) + pow(m, 3.0) * 0.4, 1.0);
    `),
  },
  pulsingBorder: {
    label: "Pulsing border",
    fragmentShader: bg(`
      float t = uTime * uSpeed;
      vec2 d = min(vUv, 1.0 - vUv);
      float border = smoothstep(0.0, 0.15 * uScale, min(d.x, d.y));
      float pulse = 0.6 + 0.4 * sin(t * 2.0);
      gl_FragColor = vec4(mix(palette(0.85) * pulse, palette(0.1) * 0.3, border), 1.0);
    `),
  },
};
