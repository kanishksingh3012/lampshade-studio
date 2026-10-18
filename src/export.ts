import * as THREE from "three"
import { STLExporter } from "three/addons/exporters/STLExporter.js"
import { strToU8, zipSync } from "fflate"
import { radiusAt, type Params } from "./geometry"

export type Part = { name: string; geo: THREE.BufferGeometry }

export function download(data: BlobPart, name: string, type: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function toStl(parts: Part[]) {
  const g = new THREE.Group()
  for (const p of parts) g.add(new THREE.Mesh(p.geo))
  return (new STLExporter().parse(g, { binary: true }) as DataView).buffer as ArrayBuffer
}

function meshXml(id: number, { name, geo }: Part) {
  const p = geo.attributes.position, ix = geo.index!.array
  const v: string[] = [], t: string[] = []
  for (let i = 0; i < p.count; i++) v.push(`<vertex x="${p.getX(i).toFixed(3)}" y="${p.getY(i).toFixed(3)}" z="${p.getZ(i).toFixed(3)}"/>`)
  for (let k = 0; k < ix.length; k += 3) t.push(`<triangle v1="${ix[k]}" v2="${ix[k + 1]}" v3="${ix[k + 2]}"/>`)
  return `<object id="${id}" name="${name}" type="model"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>`
}

// 3MF (mm). `fused`: parts become components of one object, so slicers merge them into one print
// (shade + spider). Otherwise each part is its own object, laid out side by side on the plate.
export function to3mf(parts: Part[], fused: boolean) {
  const objs = parts.map((p, i) => meshXml(i + 1, p))
  let build: string
  if (fused) {
    const id = parts.length + 1
    objs.push(`<object id="${id}" name="lampshade" type="model"><components>${parts.map((_, i) => `<component objectid="${i + 1}"/>`).join("")}</components></object>`)
    build = `<item objectid="${id}"/>`
  } else {
    let x = 0
    build = parts.map(({ geo }, i) => {
      const bb = geo.boundingBox!, item = `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${(x - bb.min.x).toFixed(3)} 0 0"/>`
      x += bb.max.x - bb.min.x + 10
      return item
    }).join("")
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objs.join("")}</resources><build>${build}</build></model>`
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": strToU8(model),
  })
}

// Side section through θ = 0 / π as a closed outline in mm (top of the print at the top)
export function profileSvg(p: Params) {
  const n = 240, right: string[] = [], left: string[] = []
  let R = 0
  for (let i = 0; i <= n; i++) { const t = i / n; R = Math.max(R, radiusAt(p, 0, t), radiusAt(p, Math.PI, t)) }
  const W = 2 * R + 20, H = p.height + 20
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = (10 + p.height * (1 - t)).toFixed(2)
    right.push(`${(W / 2 + radiusAt(p, 0, t)).toFixed(2)},${y}`)
    left.unshift(`${(W / 2 - radiusAt(p, Math.PI, t)).toFixed(2)},${y}`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}mm" height="${H.toFixed(1)}mm" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">
<polygon points="${[...right, ...left].join(" ")}" fill="none" stroke="#000" stroke-width="0.3"/>
<line x1="${(W / 2).toFixed(2)}" y1="5" x2="${(W / 2).toFixed(2)}" y2="${(H - 5).toFixed(2)}" stroke="#999" stroke-width="0.2" stroke-dasharray="2 1"/>
</svg>`
}
