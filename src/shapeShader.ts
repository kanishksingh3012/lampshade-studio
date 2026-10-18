import * as THREE from "three"
import { MAX_POINTS, TEX, patternRows, texture, type Params } from "./geometry"

// GPU preview of the shade. A fixed (θ, t, side) grid is uploaded once per resolution; the vertex
// shader computes every position, normal and overhang colour from uniforms, so changing a shape
// setting only updates numbers (no mesh rebuild). The maths mirrors radiusAt / buildShade in
// geometry.ts line by line; the CPU mesh is still built (debounced) for export, stats and holes.

export const shapeU = {
  uGpu: { value: 0 },
  uH: { value: 160 }, uSides: { value: 0 }, uTwist: { value: 0 },
  uRip: { value: 0 }, uRipD: { value: 0 }, uWav: { value: 0 }, uWavD: { value: 0 },
  uPat: { value: 0 }, uPatN: { value: 12 }, uPatM: { value: 1 }, uPatD: { value: 0 },
  uTex: { value: new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat) as THREE.Texture }, uTexD: { value: 0 }, uTexRep: { value: 1 },
  uThick0: { value: 1.2 }, uThickT: { value: 0 },
  uProf: { value: Array.from({ length: MAX_POINTS }, () => new THREE.Vector2()) }, uProfN: { value: 2 },
  uGrid: { value: new THREE.Vector2(360, 160) },
  uBase: { value: new THREE.Color() },
  uAmber: { value: new THREE.Color("#f5a524") }, uRed: { value: new THREE.Color("#e5484d") },
}

export const SHAPE_GLSL = /* glsl */ `
uniform float uGpu, uH, uSides, uTwist, uRip, uRipD, uWav, uWavD, uPat, uPatN, uPatM, uPatD, uTexD, uTexRep, uThick0, uThickT;
uniform vec2 uProf[${MAX_POINTS}]; uniform int uProfN; uniform vec2 uGrid;
uniform sampler2D uTex; uniform vec3 uBase, uAmber, uRed;
varying float vThick;

float profR(float t) {
  int n = uProfN;
  if (t <= uProf[0].x) return uProf[0].y;
  if (t >= uProf[n - 1].x) return uProf[n - 1].y;
  int i = 0;
  for (int k = 1; k < ${MAX_POINTS - 1}; k++) if (k < n - 1 && t > uProf[k].x) i = k;
  vec2 a = uProf[i], b = uProf[i + 1], p0 = uProf[max(i - 1, 0)], p3 = uProf[min(i + 2, n - 1)];
  float h = b.x - a.x, m0 = (b.y - p0.y) / (b.x - p0.x), m1 = (p3.y - a.y) / (p3.x - a.x);
  float u = (t - a.x) / h, u2 = u * u, u3 = u2 * u;
  return (2.0 * u3 - 3.0 * u2 + 1.0) * a.y + (u3 - 2.0 * u2 + u) * h * m0 + (-2.0 * u3 + 3.0 * u2) * b.y + (u3 - u2) * h * m1;
}
float hash3(int i, int j, int k) {
  uint x = uint(i) * 73856093u ^ uint(j) * 19349663u ^ uint(k) * 83492791u;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return float(x) / 4294967296.0;
}
float patAt(float th, float t) {
  float u = th / 6.2831853 * uPatN, w = t * uPatM;
  if (uPat < 1.5) {
    int n = int(uPatN + 0.5), ci = int(floor(u)), cj = int(floor(w));
    float f1 = 9.0, f2 = 9.0;
    for (int di = -1; di <= 1; di++) for (int dj = -1; dj <= 1; dj++) {
      int i = ci + di, j = cj + dj, im = i - n * int(floor(float(i) / float(n)));
      vec2 s = vec2(float(i) + 0.15 + 0.7 * hash3(im, j + 1000, 1), float(j) + 0.15 + 0.7 * hash3(im, j + 1000, 2));
      float d = length(vec2(u, w) - s);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return 1.0 - smoothstep(0.04, 0.16, f2 - f1);
  }
  if (uPat < 2.5) return min(1.0 - abs(2.0 * fract(u + w) - 1.0), 1.0 - abs(2.0 * fract(u - w) - 1.0));
  return abs(sin(3.14159265 * w)) * (0.5 + 0.5 * sin(6.2831853 * u + 3.14159265 * floor(w)));
}
float radAt(float theta, float t) {
  float th = theta - uTwist * t, r = profR(t);
  if (uSides >= 3.0) { float s = 6.2831853 / uSides, a = mod(th, s) - s * 0.5; r *= cos(3.14159265 / uSides) / cos(a); }
  if (uRip > 0.0) r += uRipD * cos(uRip * th);
  if (uWav > 0.0) r += uWavD * sin(uWav * 6.2831853 * t);
  if (uPat > 0.5 && uPatD > 0.0) r += uPatD * patAt(th, t);
  if (uTexD != 0.0) r += uTexD * texture2D(uTex, vec2(th / 6.2831853 * uTexRep, clamp(t, 0.0, 1.0))).r;
  return r;
}
vec3 outerP(float th, float t) { float r = radAt(th, t); return vec3(r * cos(th), r * sin(th), t * uH); }
// g = (u around, t up, side ±1). Same neighbours, overhang ramp and perpendicular wall as buildShade.
void shadeVertex(vec3 g, out vec3 P, out vec3 N, out vec3 C) {
  float th = g.x * 6.2831853, t = g.y, dth = 6.2831853 / uGrid.x, dt = 1.0 / (uGrid.y - 1.0);
  float t0 = max(t - dt, 0.0), t1 = min(t + dt, 1.0);
  vec3 o = outerP(th, t), oa = outerP(th + dth, t), ob = outerP(th - dth, t), lo = outerP(th, t0), hi = outerP(th, t1);
  vec2 tg = oa.xy - ob.xy, n2 = normalize(vec2(tg.y, -tg.x));
  N = normalize(cross(oa - ob, hi - lo));
  float ang = t <= 0.0 ? 0.0 : degrees(atan(abs(dot(o.xy - lo.xy, n2)), (t - t0) * uH));
  float k = clamp((ang - 30.0) / 20.0, 0.0, 1.0);
  C = mix(uBase, uAmber, min(k * 2.0, 1.0));
  if (k > 0.5) C = mix(C, uRed, (k - 0.5) * 2.0);
  vThick = uThick0 + uThickT * t;
  P = o;
  if (g.z < 0.0) {
    float lean = atan(dot(hi.xy - lo.xy, n2), (t1 - t0) * uH);
    P.xy -= n2 * vThick / max(cos(lean), 0.35);
    N = -N;
  }
}
`

// Patch a built-in material (standard, basic, distance) to take its shape from the GPU grid
// whenever uGpu is on; with uGpu off it renders ordinary geometry (the perforated CPU mesh).
export function gpuify<M extends THREE.Material>(m: M): M {
  const prev = m.onBeforeCompile
  m.defines = { ...m.defines, GPU_SHAPE: "" }
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r)
    Object.assign(s.uniforms, shapeU)
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\n" + SHAPE_GLSL)
      .replace("void main() {", "void main() {\n  vec3 gP = position, gN = vec3(0.0, 0.0, 1.0), gC = vec3(1.0); vThick = uThick0;\n  if (uGpu > 0.5) shadeVertex(position, gP, gN, gC);")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n  if (uGpu > 0.5) objectNormal = gN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  if (uGpu > 0.5) transformed = gP;")
      .replace("#include <color_vertex>", "#include <color_vertex>\n#ifdef USE_COLOR\n  if (uGpu > 0.5) vColor.rgb = gC;\n#endif")
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vThick;")
  }
  m.customProgramCacheKey = () => "gpu-shape-" + m.type
  return m
}

// Zebra stripes for the GPU grid (and plain geometry when uGpu is off)
export function zebraMaterial(gpu: boolean) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: gpu ? shapeU : { uGpu: { value: 0 } },
    vertexShader: (gpu ? SHAPE_GLSL : "uniform float uGpu;") + `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 gP = position, gN = normal, gC;
        ${gpu ? "if (uGpu > 0.5) shadeVertex(position, gP, gN, gC);" : ""}
        vec4 mv = modelViewMatrix * vec4(gP, 1.0); vN = normalize(normalMatrix * gN); vV = mv.xyz; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec3 r = reflect(normalize(vV), normalize(vN)); float s = smoothstep(0.45, 0.55, fract(r.y * 7.0));
        gl_FragColor = vec4(vec3(0.08 + 0.85 * s), 1.0); }`,
  })
}

// Index layout identical to buildShade: outer skin, then (solid) inner skin and top/bottom caps
export function gridGeometry(NT: number, NZ: number, solid: boolean) {
  const sides = solid ? 2 : 1, n = NT * NZ
  const pos = new Float32Array(n * sides * 3)
  for (let s = 0; s < sides; s++) for (let i = 0; i < NZ; i++) for (let j = 0; j < NT; j++)
    pos.set([j / NT, i / (NZ - 1), s ? -1 : 1], (s * n + i * NT + j) * 3)
  const idx: number[] = []
  const O = (i: number, j: number) => i * NT + (j % NT), I = (i: number, j: number) => n + i * NT + (j % NT)
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d)
  for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NT; j++) quad(O(i, j), O(i, j + 1), O(i + 1, j + 1), O(i + 1, j))
  if (solid) {
    for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NT; j++) quad(I(i, j), I(i + 1, j), I(i + 1, j + 1), I(i, j + 1))
    for (let j = 0; j < NT; j++) {
      quad(O(NZ - 1, j), O(NZ - 1, j + 1), I(NZ - 1, j + 1), I(NZ - 1, j))
      quad(O(0, j), I(0, j), I(0, j + 1), O(0, j + 1))
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1))
  g.addGroup(0, idx.length, 0)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4) // real extent comes from the shader
  g.userData = { gpu: true, NT, NZ }
  return g
}

let texVersion = -1
export function syncShape(p: Params, geo: THREE.BufferGeometry) {
  const u = shapeU, tx = texture()
  u.uGpu.value = geo.userData.gpu ? 1 : 0
  if (geo.userData.gpu) u.uGrid.value.set(geo.userData.NT, geo.userData.NZ)
  u.uH.value = p.height; u.uSides.value = p.sides; u.uTwist.value = (p.twist * Math.PI) / 180
  u.uRip.value = p.ripples; u.uRipD.value = p.rippleDepth; u.uWav.value = p.waves; u.uWavD.value = p.waveDepth
  u.uPat.value = { none: 0, voronoi: 1, knurl: 2, weave: 3 }[p.pattern]; u.uPatN.value = p.patCount; u.uPatM.value = patternRows(p); u.uPatD.value = p.patDepth
  u.uTexD.value = tx.data ? p.texDepth : 0; u.uTexRep.value = p.texRepeat
  u.uThick0.value = p.thickness; u.uThickT.value = p.mode === "solid" ? p.wallTaper : 0
  p.profile.forEach(([t, r], i) => u.uProf.value[i].set(t, r)); u.uProfN.value = p.profile.length
  u.uBase.value.set(p.color)
  if (tx.version !== texVersion && tx.data) {
    texVersion = tx.version
    const t = new THREE.DataTexture(tx.data, TEX, TEX, THREE.RedFormat, THREE.UnsignedByteType)
    t.wrapS = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true
    u.uTex.value.dispose(); u.uTex.value = t
  }
}
