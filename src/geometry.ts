import * as THREE from "three"

// All units mm, Z-up (printer convention). z = 0 sits on the print bed.
export type Params = {
  height: number
  profile: [number, number][] // silhouette control points: [t (0 = fitting end, 1 = open end), radius mm]
  sides: number // < 3 = round
  twist: number // degrees over full height
  ripples: number
  rippleDepth: number
  waves: number
  waveDepth: number
  thickness: number // wall in solid mode, line width in vase mode
  wallTaper: number // solid mode: extra wall (mm) added linearly towards the top; negative thins it
  pattern: "none" | "voronoi" | "knurl" | "weave"
  patCount: number // cells around
  patDepth: number // mm, outward
  engrave: string // engraved/embossed text, rendered to the relief texture (see setTexture)
  texDepth: number // relief depth, negative = engraved
  texRepeat: number // image repeats around
  nozzle: number
  tableBase: boolean // export a printable table-lamp base with a cup for an E27 socket
  baseCord: "feet" | "channel" // cord leaves under the raised disc, or through a groove in a flat bottom
  mode: "vase" | "solid"
  fitting: "E27" | "E14" | "harp" | "none"
  hole: number // ring hole Ø; measure your holder's collar
  lumens: number
  kelvin: number
  finish: "matte" | "silk" | "glossy"
  perfShape: "none" | "circle" | "slot" | "diamond"
  perfCols: number
  perfRows: number
  perfSize: number // vertical hole size, mm
  perfStart: number // band, fraction of height
  perfEnd: number
  perfStagger: boolean
  printer: keyof typeof PRINTERS
  color: string
}

export const DEFAULTS: Params = {
  height: 160, profile: [[0, 80], [0.5, 77], [1, 50]], sides: 0, twist: 0,
  ripples: 24, rippleDepth: 3, waves: 0, waveDepth: 0, thickness: 1.2, wallTaper: 0,
  pattern: "none", patCount: 12, patDepth: 2, engrave: "", texDepth: 0, texRepeat: 2, nozzle: 0.4, tableBase: false, baseCord: "channel",
  mode: "solid", fitting: "E27", hole: 41, lumens: 800, kelvin: 2700, finish: "matte",
  perfShape: "none", perfCols: 18, perfRows: 6, perfSize: 10, perfStart: 0.2, perfEnd: 0.85, perfStagger: true, printer: "Bambu P1/X1", color: "#ffffff",
}

export const PRESETS: Record<string, Partial<Params>> = {
  "Blank": { height: 160, profile: [[0, 80], [0.5, 80], [1, 80]], sides: 0, twist: 0, ripples: 0, rippleDepth: 0, waves: 0, waveDepth: 0, perfShape: "none" },
  "Ripple bell": { height: 160, profile: [[0, 80], [0.5, 77], [1, 50]], sides: 0, twist: 0, ripples: 24, rippleDepth: 3, waves: 0, waveDepth: 0 },
  "Twisted hex": { height: 180, profile: [[0, 75], [1, 75]], sides: 6, twist: 120, ripples: 0, rippleDepth: 0, waves: 0, waveDepth: 0 },
  "Wavy drum": { height: 140, profile: [[0, 85], [1, 85]], sides: 0, twist: 0, ripples: 12, rippleDepth: 4, waves: 3, waveDepth: 5 },
  "Spiral cone": { height: 200, profile: [[0, 95], [1, 40]], sides: 0, twist: 120, ripples: 16, rippleDepth: 2.5, waves: 0, waveDepth: 0 },
  "Voronoi lantern": { height: 180, profile: [[0, 70], [0.5, 85], [1, 60]], sides: 0, twist: 0, ripples: 0, rippleDepth: 0, waves: 0, waveDepth: 0, pattern: "voronoi", patCount: 9, patDepth: 2.5 },
  "Knurled drum": { height: 150, profile: [[0, 80], [1, 80]], sides: 0, twist: 0, ripples: 0, rippleDepth: 0, waves: 0, waveDepth: 0, pattern: "knurl", patCount: 24, patDepth: 2 },
  "Woven basket": { height: 140, profile: [[0, 70], [1, 95]], sides: 0, twist: 0, ripples: 0, rippleDepth: 0, waves: 0, waveDepth: 0, pattern: "weave", patCount: 16, patDepth: 2.5 },
  "Faceted twist": { height: 200, profile: [[0, 60], [0.55, 95], [1, 70]], sides: 8, twist: 90, ripples: 0, rippleDepth: 0, waves: 0, waveDepth: 0, pattern: "none" },
  "Ribbed dome": { height: 130, profile: [[0, 100], [0.6, 85], [1, 45]], sides: 0, twist: 0, ripples: 36, rippleDepth: 2, waves: 0, waveDepth: 0, pattern: "none" },
}

// Build volume in mm (x, y, z)
export const PRINTERS = {
  "Bambu P1/X1": [256, 256, 256],
  "Prusa MK4": [250, 210, 220],
  "Ender 3": [220, 220, 250],
  "Bambu A1 mini": [180, 180, 180],
} as const

// Press-fit ring hole diameters. Harp: a washer ring that drops over a table-lamp harp's finial rod.
export const HOLE = { E27: 41, E14: 29, harp: 13 }
const PLA = 1.24 // g/cm³
const GLUE_GAP = 0.3 // clearance between glue-in rim and the vase skin

// Smooth silhouette through the control points: cubic Hermite with Catmull-Rom slopes
export function profileR(pts: [number, number][], t: number) {
  const n = pts.length
  if (t <= pts[0][0]) return pts[0][1]
  if (t >= pts[n - 1][0]) return pts[n - 1][1]
  let i = 0
  while (t > pts[i + 1][0]) i++
  const [t0, r0] = pts[i], [t1, r1] = pts[i + 1], h = t1 - t0
  const slope = (k: number) => {
    const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)]
    return (b[1] - a[1]) / (b[0] - a[0])
  }
  const u = (t - t0) / h, u2 = u * u, u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * r0 + (u3 - 2 * u2 + u) * h * slope(i) + (-2 * u3 + 3 * u2) * r1 + (u3 - u2) * h * slope(i + 1)
}

// Profile edits shared by the 3D handles and the section editor. Ends stay pinned to t = 0 and 1,
// middle points keep 2% height apart, radius stays within 10–150 mm.
type Pt = [number, number]
const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const round = ([t, r]: Pt): Pt => [+t.toFixed(4), +r.toFixed(2)]
export function movePoint(pts: Pt[], i: number, t: number, r: number): Pt[] {
  const last = pts.length - 1
  const nt = i === 0 ? 0 : i === last ? 1 : clampN(t, pts[i - 1][0] + 0.02, pts[i + 1][0] - 0.02)
  return pts.map((q, k) => (k === i ? round([nt, clampN(r, 10, 150)]) : q))
}
export const MAX_POINTS = 16 // the GPU preview holds at most this many profile points
export function addPoint(pts: Pt[], t: number, r: number): Pt[] {
  if (pts.length >= MAX_POINTS || t < 0.03 || t > 0.97 || pts.some(([pt]) => Math.abs(pt - t) < 0.03)) return pts
  return [...pts, round([t, clampN(r, 10, 150)])].sort((a, b) => a[0] - b[0])
}
export function removePoint(pts: Pt[], i: number): Pt[] {
  return i === 0 || i === pts.length - 1 ? pts : pts.filter((_, k) => k !== i)
}

// ---- Surface patterns and image relief. Mirrored line by line in shapeShader.ts (GPU preview);
// keep both in sync so the preview matches the export.
const fract = (x: number) => x - Math.floor(x)
const smooth = (a: number, b: number, x: number) => { const k = Math.min(Math.max((x - a) / (b - a), 0), 1); return k * k * (3 - 2 * k) }
// Integer hash on uint32 maths (Math.imul wraps like GLSL uint)
export function hash3(i: number, j: number, k: number) {
  let x = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) >>> 0
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}
// Rows of pattern cells, chosen so cells come out roughly square at mid-height
let rowsFor: Params | null = null, rowsVal = 1
export function patternRows(p: Params) {
  if (rowsFor !== p) { rowsFor = p; rowsVal = Math.max(1, Math.round((p.patCount * p.height) / (2 * Math.PI * profileR(p.profile, 0.5)))) }
  return rowsVal
}
function patternAt(p: Params, th: number, t: number) {
  const n = p.patCount, u = (th / (2 * Math.PI)) * n, w = t * patternRows(p)
  if (p.pattern === "voronoi") {
    // Raised ridges along cell borders (F2 − F1 small), jittered grid that wraps around the shade
    const ci = Math.floor(u), cj = Math.floor(w)
    let f1 = 9, f2 = 9
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di, j = cj + dj, im = i - n * Math.floor(i / n)
      const d = Math.hypot(u - (i + 0.15 + 0.7 * hash3(im, j + 1000, 1)), w - (j + 0.15 + 0.7 * hash3(im, j + 1000, 2)))
      if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
    }
    return 1 - smooth(0.04, 0.16, f2 - f1)
  }
  if (p.pattern === "knurl") return Math.min(1 - Math.abs(2 * fract(u + w) - 1), 1 - Math.abs(2 * fract(u - w) - 1))
  // weave: horizontal strands that go over/under, alternating every row
  return Math.abs(Math.sin(Math.PI * w)) * (0.5 + 0.5 * Math.sin(2 * Math.PI * u + Math.PI * Math.floor(w)))
}

// Greyscale relief image, TEX×TEX, row 0 = bottom (t = 0). White pushes the wall out by texDepth.
export const TEX = 128
let tex: Uint8Array | null = null, texVersion = 0
export function setTexture(data: Uint8Array | null) { tex = data; texVersion++ }
export const texture = () => ({ data: tex, version: texVersion })
// Bilinear sample matching GL LINEAR filtering with repeat around / clamp vertically
function texAt(th: number, t: number, rep: number) {
  const x = fract((th / (2 * Math.PI)) * rep) * TEX - 0.5, y = Math.min(Math.max(t, 0), 1) * TEX - 0.5
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const v = (a: number, b: number) => tex![Math.min(TEX - 1, Math.max(0, b)) * TEX + (((a % TEX) + TEX) % TEX)] / 255
  return (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy
}

export function radiusAt(p: Params, theta: number, t: number) {
  const th = theta - (p.twist * Math.PI / 180) * t
  let r = profileR(p.profile, t)
  if (p.sides >= 3) {
    const s = (2 * Math.PI) / p.sides
    const a = (((th % s) + s) % s) - s / 2
    r *= Math.cos(Math.PI / p.sides) / Math.cos(a)
  }
  if (p.ripples > 0) r += p.rippleDepth * Math.cos(p.ripples * th)
  if (p.waves > 0) r += p.waveDepth * Math.sin(p.waves * 2 * Math.PI * t)
  if (p.pattern !== "none" && p.patDepth > 0) r += p.patDepth * patternAt(p, th, t)
  if (tex && p.texDepth !== 0) r += p.texDepth * texAt(th, t, p.texRepeat)
  return r
}

// Glue-in ring (vase mode): round rim touching the skin's innermost point over the rim height
export const GLUE_RIM_H = 8
export function glueRimR(p: Params) {
  let m = Infinity
  for (let i = 0; i <= 16; i++) for (let j = 0; j < 720; j++)
    m = Math.min(m, radiusAt(p, (j / 720) * Math.PI * 2, (i / 16) * (GLUE_RIM_H / p.height)))
  return m - p.thickness - GLUE_GAP
}

export type Stats = {
  size: [number, number, number]
  grams: number
  maxOverhang: number
  fitsBed: boolean
  minInnerR: number
  minutes: number
  warnings: string[]
}

// Small indexed-mesh builder shared by the shade and the fitting part
function mesher(base: THREE.Color) {
  const pos: number[] = [], col: number[] = [], idx: number[] = []
  const vert = (x: number, y: number, z: number, c = base) => {
    pos.push(x, y, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1
  }
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d)
  function tube(r0: number, r1: number, h: number, seg = 96) {
    const s = pos.length / 3
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a)
      vert(r1 * c, r1 * si, 0); vert(r1 * c, r1 * si, h); vert(r0 * c, r0 * si, 0); vert(r0 * c, r0 * si, h)
    }
    const V = (j: number, k: number) => s + (j % seg) * 4 + k
    for (let j = 0; j < seg; j++) {
      quad(V(j, 0), V(j + 1, 0), V(j + 1, 1), V(j, 1)) // outer
      quad(V(j, 2), V(j, 3), V(j + 1, 3), V(j + 1, 2)) // inner
      quad(V(j, 1), V(j + 1, 1), V(j + 1, 3), V(j, 3)) // top
      quad(V(j, 0), V(j, 2), V(j + 1, 2), V(j + 1, 0)) // bottom
    }
  }

  function box(x0: number, x1: number, w: number, h: number, a: number) {
    const s = pos.length / 3, c = Math.cos(a), si = Math.sin(a)
    for (const [x, y, z] of [[x0, -w / 2, 0], [x1, -w / 2, 0], [x1, w / 2, 0], [x0, w / 2, 0],
      [x0, -w / 2, h], [x1, -w / 2, h], [x1, w / 2, h], [x0, w / 2, h]]) vert(x * c - y * si, x * si + y * c, z)
    for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]])
      quad(s + f[0], s + f[1], s + f[2], s + f[3])
  }

  function build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.computeBoundingBox()
    return g
  }
  // Closed solid of revolution from a counter-clockwise (r, z) outline
  function lathe(pts: [number, number][], seg = 96) {
    const s = pos.length / 3, n = pts.length
    for (const [r, z] of pts) for (let j = 0; j < seg; j++) { const a = (j / seg) * Math.PI * 2; vert(r * Math.cos(a), r * Math.sin(a), z) }
    const V = (k: number, j: number) => s + (k % n) * seg + (j % seg)
    for (let k = 0; k < n; k++) for (let j = 0; j < seg; j++) quad(V(k, j), V(k, j + 1), V(k + 1, j + 1), V(k + 1, j))
  }
  // Prism from a counter-clockwise outline (may be concave), z from z0 to z1
  function extrude(pts: [number, number][], z0: number, z1: number) {
    const s = pos.length / 3, n = pts.length
    for (const [x, y] of pts) vert(x, y, z0)
    for (const [x, y] of pts) vert(x, y, z1)
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
      const ccw = THREE.ShapeUtils.area([a, b, c].map((k) => new THREE.Vector2(...pts[k]))) > 0
      const [p, q] = ccw ? [b, c] : [c, b]
      idx.push(s + a, s + q, s + p) // bottom faces down
      idx.push(s + n + a, s + n + p, s + n + q) // top faces up
    }
    for (let k = 0; k < n; k++) quad(s + k, s + ((k + 1) % n), s + n + ((k + 1) % n), s + n + k)
  }
  return { pos, idx, vert, quad, tube, box, lathe, extrude, build }
}

// Signed volume of a closed mesh, mm³
export function volume(g: THREE.BufferGeometry) {
  const p = g.attributes.position, ix = g.index!.array
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3()
  let v = 0
  for (let k = 0; k < ix.length; k += 3) {
    A.fromBufferAttribute(p, ix[k]); B.fromBufferAttribute(p, ix[k + 1]); C.fromBufferAttribute(p, ix[k + 2])
    v += A.dot(B.cross(C)) / 6
  }
  return v
}

// Grid resolution, shared by the export mesh and the GPU preview grid so both sample the same points.
// Adapts to the pattern: ≥12 samples per ripple, ~24 per pattern cell, polygon corners on vertices.
export function resolution(p: Params) {
  const pat = p.pattern !== "none" && p.patDepth > 0, img = tex && p.texDepth !== 0
  const nt = Math.min(1080, Math.max(360, p.ripples * 12, pat ? p.patCount * 24 : 0, img ? p.texRepeat * 96 : 0))
  const NT = p.sides >= 3 ? Math.ceil(nt / p.sides) * p.sides : nt
  const NZ = Math.min(400, Math.max(160, p.waves * 30, Math.ceil(Math.abs(p.twist) / 2), pat ? patternRows(p) * 24 : 0, img ? 192 : 0))
  return { NT, NZ }
}

// Fitting part, built on the bed (z = 0). Solid: ring + spokes fused into the wall (slicer unions
// the overlap). Vase: separate glue-in spider whose round rim touches the skin's innermost points.
export function buildFitting(p: Params, base: THREE.Color, warnings: string[] = []) {
  if (p.fitting === "none") return null
  const f = mesher(base), hr = p.hole / 2, ringOut = hr + 6, rh = 3
  f.tube(hr, ringOut, rh)
  if (p.mode === "solid") {
    const wallR = Math.min(...[0, 1, 2].map((k) => radiusAt(p, (k * 2 * Math.PI) / 3, 0))) - p.thickness
    if (wallR < ringOut + 2) warnings.push("Base is too narrow for the fitting ring")
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3
      f.box(ringOut - 1, radiusAt(p, a, 0) - p.thickness / 2, 6, rh, a)
    }
  } else {
    const rimOut = glueRimR(p)
    if (rimOut - 2 < ringOut + 2) warnings.push("Base is too narrow for the glue-in ring")
    f.tube(rimOut - 2, rimOut, GLUE_RIM_H)
    for (let s = 0; s < 3; s++) f.box(ringOut - 1, rimOut - 1, 6, rh, (s * 2 * Math.PI) / 3)
  }
  return f.build()
}

// Table-lamp base: weighted disc with a cup that holds an E27 socket (Ø 40 mm body); the cord drops
// through a Ø 10 mm centre hole. "feet": the disc stands on three feet and the cord leaves between
// them. "channel": flat bottom with a keyhole groove (8 mm wide, 7 mm tall) running from the hole
// to the edge. Overlapping parts are unioned by the slicer, like the spider spokes.
export const BASE_R = 65
export function buildBase(base: THREE.Color, cord: Params["baseCord"] = "channel") {
  const f = mesher(base), R = BASE_R, cup = 21, wall = 3, stem = 45, z = 8, hole = 5
  f.lathe([[hole, z], [R, z], [R, z + 10], [cup + wall, z + 10], [cup + wall, z + 10 + stem], [cup, z + 10 + stem], [cup, z + 14], [hole, z + 14]])
  if (cord === "feet") {
    for (let k = 0; k < 3; k++) f.box(R - 30, R - 6, 14, z + 1, (k * 2 * Math.PI) / 3 + Math.PI / 6)
  } else {
    // Keyhole slab under the disc: full circle minus the centre hole and a slot along +x
    const w = 4, a = Math.asin(w / R), b = Math.asin(w / hole), pts: [number, number][] = []
    for (let i = 0; i <= 90; i++) { const t = a + ((2 * Math.PI - 2 * a) * i) / 90; pts.push([R * Math.cos(t), R * Math.sin(t)]) }
    for (let i = 0; i <= 24; i++) { const t = -b - ((2 * Math.PI - 2 * b) * i) / 24; pts.push([hole * Math.cos(t), hole * Math.sin(t)]) }
    f.extrude(pts, 0, z + 1)
  }
  return f.build()
}

export function buildShade(p: Params, base: THREE.Color) {
  const { NT, NZ } = resolution(p)
  const { pos, idx, vert, quad, build } = mesher(base)
  const solid = p.mode === "solid"
  const red = new THREE.Color("#e5484d"), amber = new THREE.Color("#f5a524"), tmp = new THREE.Color()

  // Outer rings plus their outward horizontal normals
  const outer: THREE.Vector2[][] = []
  const normals: THREE.Vector2[][] = []
  for (let i = 0; i < NZ; i++) {
    const t = i / (NZ - 1), ring: THREE.Vector2[] = []
    for (let j = 0; j < NT; j++) {
      const th = (j / NT) * Math.PI * 2, r = radiusAt(p, th, t)
      ring.push(new THREE.Vector2(r * Math.cos(th), r * Math.sin(th)))
    }
    outer.push(ring)
    normals.push(ring.map((_, j) => {
      const tg = ring[(j + 1) % NT].clone().sub(ring[(j - 1 + NT) % NT])
      return new THREE.Vector2(tg.y, -tg.x).normalize()
    }))
  }

  const warnings: string[] = []
  // Overhang per vertex: horizontal step between rings vs vertical step (thin walls overhang both ways)
  const dz = p.height / (NZ - 1)
  let maxOverhang = 0
  const o0 = pos.length / 3
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NT; j++) {
    const prev = outer[Math.max(i - 1, 0)][j], cur = outer[i][j]
    const ang = i === 0 ? 0 : Math.atan2(Math.abs(cur.clone().sub(prev).dot(normals[i][j])), dz) * 180 / Math.PI
    maxOverhang = Math.max(maxOverhang, ang)
    // Smooth ramp (30° → amber at 40° → red at 50°) instead of hard thresholds, which looked jagged
    const k = Math.min(Math.max((ang - 30) / 20, 0), 1)
    tmp.copy(base).lerp(amber, Math.min(k * 2, 1))
    if (k > 0.5) tmp.lerp(red, (k - 0.5) * 2)
    vert(cur.x, cur.y, i * dz, tmp)
  }
  const O = (i: number, j: number) => o0 + i * NT + (j % NT)
  for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NT; j++) quad(O(i, j), O(i, j + 1), O(i + 1, j + 1), O(i + 1, j))

  let minInnerR = Infinity
  let capStart = -1 // vase-mode caps: exported for the slicer, hidden in the preview
  if (solid) {
    const n0 = pos.length / 3
    for (let i = 0; i < NZ; i++) for (let j = 0; j < NT; j++) {
      const lo = outer[Math.max(i - 1, 0)][j], hi = outer[Math.min(i + 1, NZ - 1)][j]
      const lean = Math.atan2(hi.clone().sub(lo).dot(normals[i][j]), (Math.min(i + 1, NZ - 1) - Math.max(i - 1, 0)) * dz)
      const wall = p.thickness + p.wallTaper * (i / (NZ - 1))
      const q = outer[i][j].clone().addScaledVector(normals[i][j], -wall / Math.max(Math.cos(lean), 0.35))
      minInnerR = Math.min(minInnerR, q.length())
      vert(q.x, q.y, i * dz)
    }
    const N = (i: number, j: number) => n0 + i * NT + (j % NT)
    for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NT; j++) quad(N(i, j), N(i + 1, j), N(i + 1, j + 1), N(i, j + 1))
    const top = NZ - 1
    for (let j = 0; j < NT; j++) {
      quad(O(top, j), O(top, j + 1), N(top, j + 1), N(top, j))
      quad(O(0, j), N(0, j), N(0, j + 1), O(0, j + 1))
    }
  } else {
    // Vase mode: closed solid with flat caps; the slicer's spiralize mode prints only the outer skin
    minInnerR = Math.min(...outer.flat().map((v) => v.length())) - p.thickness
    capStart = idx.length
    const cb = vert(0, 0, 0), ct = vert(0, 0, p.height)
    for (let j = 0; j < NT; j++) {
      idx.push(cb, O(0, j + 1), O(0, j))
      idx.push(ct, O(NZ - 1, j), O(NZ - 1, j + 1))
    }
  }

  const fitting = buildFitting(p, base, warnings)

  const geo = build()
  const end = capStart < 0 ? idx.length : capStart
  geo.addGroup(0, end, 0)
  geo.addGroup(end, idx.length - end, 1)

  // Material estimate: signed volume (solid) or skin area × line width (vase)
  let vol = 0, area = 0
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3()
  for (let k = 0; k < idx.length; k += 3) {
    A.fromArray(pos, idx[k] * 3); B.fromArray(pos, idx[k + 1] * 3); C.fromArray(pos, idx[k + 2] * 3)
    vol += A.dot(B.clone().cross(C)) / 6
    if (k < (NZ - 1) * NT * 6) area += B.clone().sub(A).cross(C.clone().sub(A)).length() / 2
  }
  const grams = (((solid ? vol : area * p.thickness) + (fitting ? volume(fitting) : 0)) / 1000) * PLA

  const bb = geo.boundingBox!
  const size: Stats["size"] = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z]
  const [bx, by, bz] = PRINTERS[p.printer]
  const fitsBed = size[0] <= bx && size[1] <= by && size[2] <= bz
  if (!fitsBed) warnings.push(`Too big for the ${p.printer} build volume`)
  if (p.perfShape !== "none") {
    const across = { circle: 1, slot: 0.44, diamond: 0.58 }[p.perfShape] * p.perfSize
    const gapAround = (2 * Math.PI * (minInnerR + p.thickness)) / p.perfCols - across
    const gapUp = p.perfRows > 1 ? ((p.perfEnd - p.perfStart) * p.height) / (p.perfRows - 1) / (p.perfStagger ? 0.5 : 1) - p.perfSize : Infinity
    if (!solid) warnings.push("Perforations need solid mode: vase mode can't print holes")
    else if (Math.min(gapAround, gapUp) < 2) warnings.push("Holes are closer than 2 mm: reduce size, columns or rows")
    if (p.perfShape !== "diamond" && p.perfSize > 8) warnings.push("Round tops over 8 mm sag without support: try diamonds")
    if (p.perfStart * p.height < 12 && p.fitting !== "none") warnings.push("Holes reach the fitting ring: raise the band start")
  }
  if (tex && p.texDepth < 0 && solid && -p.texDepth > p.thickness * 0.7) warnings.push("Engraving is nearly as deep as the wall: reduce the depth or thicken the wall")
  if (maxOverhang > 45) warnings.push("Red zones overhang more than 45° and may sag")
  if (minInnerR < 45) warnings.push("Wall is within 15 mm of a standard bulb: use a low-wattage LED")
  // Print-readiness: walls that slicers can fill cleanly with whole extrusion lines
  const line = p.nozzle * 1.125
  if (!solid && (p.thickness < p.nozzle * 0.9 || p.thickness > p.nozzle * 2))
    warnings.push(`Vase line width ${p.thickness} mm doesn't suit a ${p.nozzle} mm nozzle: use ${p.nozzle}–${+(p.nozzle * 2).toFixed(2)} mm`)
  // Slicers stretch lines to ~100–120% of the nozzle, so a wall is clean if some whole line count fits that range
  if (solid && p.wallTaper === 0 && p.thickness >= line * 0.95 && Math.floor(p.thickness / p.nozzle + 1e-6) < Math.ceil(p.thickness / (p.nozzle * 1.2) - 1e-6)) {
    const n = Math.max(1, Math.round(p.thickness / line))
    warnings.push(`Wall doesn't split into whole ${p.nozzle} mm lines: try ${(n * line).toFixed(2)} mm (${n} lines)`)
  }
  if (solid && Math.min(p.thickness, p.thickness + p.wallTaper) < line * 0.95) warnings.push("Part of the wall is thinner than one extrusion line")
  // Rough time: plastic volume at ~10 mm³/s plus 25% for travel and slower outer walls
  const minutes = (((solid ? vol : area * p.thickness) + (fitting ? volume(fitting) : 0)) / 10 / 60) * 1.25

  return { geo, fitting, stats: { size, grams, maxOverhang, fitsBed, minInnerR, minutes, warnings } satisfies Stats }
}
