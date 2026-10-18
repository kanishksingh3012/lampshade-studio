import * as THREE from "three"
import type { ManifoldToplevel } from "manifold-3d"
import { radiusAt, type Params } from "./geometry"

// Hole centres in print coordinates. Columns follow the twist so holes ride with the pattern;
// odd rows are offset half a column when staggered.
export function holeLayout(p: Params) {
  const out: { th: number; z: number }[] = []
  const z0 = p.perfStart * p.height, z1 = p.perfEnd * p.height
  for (let r = 0; r < p.perfRows; r++) {
    const z = p.perfRows === 1 ? (z0 + z1) / 2 : z0 + ((z1 - z0) * r) / (p.perfRows - 1)
    const t = z / p.height
    for (let c = 0; c < p.perfCols; c++) {
      const th = ((c + (p.perfStagger && r % 2 ? 0.5 : 0)) / p.perfCols) * Math.PI * 2 + (p.twist * Math.PI / 180) * t
      out.push({ th, z })
    }
  }
  return out
}

// Hole outline in the cutter's local frame: x = vertical, y = around the shade.
function outline(w: ManifoldToplevel, p: Params) {
  const s = p.perfSize, { CrossSection } = w
  if (p.perfShape === "circle") return CrossSection.circle(s / 2, 32)
  if (p.perfShape === "slot") {
    const r = s * 0.22
    return CrossSection.hull([CrossSection.circle(r, 24).translate(s / 2 - r, 0), CrossSection.circle(r, 24).translate(r - s / 2, 0)])
  }
  // Diamond with 60° flanks: self-supporting, no bridging at the top
  return new CrossSection([[[s / 2, 0], [0, s * 0.29], [-s / 2, 0], [0, -s * 0.29]]])
}

// Boolean on raw arrays so it can run in a worker. Returns a closed mesh.
export function cutHoles(w: ManifoldToplevel, pos: Float32Array, idx: Uint32Array, p: Params) {
  const { Manifold, Mesh } = w
  const shade = new Manifold(new Mesh({ numProp: 3, vertProperties: pos, triVerts: idx }))

  // Each cutter is a radial prism from inside the wall to outside it, so it only pierces its own side
  const shape = outline(w, p), holes = holeLayout(p)
  let rMin = Infinity, rMax = 0
  for (const { th, z } of holes) {
    const r = radiusAt(p, th, z / p.height)
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r)
  }
  const r0 = Math.max(rMin - p.thickness * 3 - Math.max(p.wallTaper, 0) - Math.abs(p.texDepth) - 4, 1), len = rMax + 10 + Math.abs(p.texDepth) - r0
  const proto = shape.extrude(len).rotate([0, 90, 0]).translate([r0, 0, 0])
  const cutters = holes.map(({ th, z }) => proto.rotate([0, 0, (th * 180) / Math.PI]).translate([0, 0, z]))
  const all = Manifold.union(cutters)
  const res = shade.subtract(all)
  const m = res.getMesh(), np = m.numProp, vp = m.vertProperties
  const out = new Float32Array((vp.length / np) * 3)
  for (let i = 0, j = 0; i < vp.length; i += np, j += 3) { out[j] = vp[i]; out[j + 1] = vp[i + 1]; out[j + 2] = vp[i + 2] }
  const ok = shade.status() === "NoError"
  const tri = Uint32Array.from(m.triVerts)
  for (const o of [shade, shape, proto, all, res, ...cutters]) o.delete()
  return { pos: out, idx: tri, ok }
}

export function toGeometry(pos: Float32Array, idx: Uint32Array, color: string) {
  const g = new THREE.BufferGeometry(), c = new THREE.Color(color)
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pos.length).map((_, i) => [c.r, c.g, c.b][i % 3]), 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  g.computeBoundingBox()
  g.addGroup(0, idx.length, 0)
  return g
}
