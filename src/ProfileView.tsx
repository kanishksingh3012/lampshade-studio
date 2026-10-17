import { useMemo, useRef, useState, type PointerEvent } from "react"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bar } from "@/components/ui/slider"
import { ToggleGroup } from "@/components/ui/toggle-group"
import { GLUE_RIM_H, glueRimR, profileR, radiusAt, type Params } from "./geometry"

const NZ = 120
const NT = 360
const TAU = Math.PI * 2
const f1 = (n: number) => n.toFixed(1)
const fmt = (a: [number, number][]) => a.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")

// Wall cut by the plane through the axis at angle `th`: outer edge plus the inner edge offset
// perpendicular to the wall (same rule as the mesh builder).
function wallSection(p: Params, th: number, sign: 1 | -1, H: number): [number, number][] {
  const r = Array.from({ length: NZ }, (_, i) => radiusAt(p, th, i / (NZ - 1)))
  const dz = H / (NZ - 1)
  const outer = r.map((v, i) => [sign * v, H - i * dz] as [number, number])
  const inner = r.map((v, i) => {
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, NZ - 1)
    const lean = Math.atan2(r[b] - r[a], (b - a) * dz)
    return [sign * (v - p.thickness / Math.max(Math.cos(lean), 0.35)), H - i * dz] as [number, number]
  })
  return [...outer, ...inner.reverse()]
}

type Pt = [number, number]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function ProfileView({ p, set, onDragState }: { p: Params; set: (patch: Partial<Params>) => void; onDragState: (d: boolean) => void }) {
  const stop = () => { setDrag(null); onDragState(false) }
  const svg = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ i: number; vb: string } | null>(null)
  const [mode, setMode] = useState<"side" | "top">("side")
  const [slice, setSlice] = useState(0.5)
  const H = p.height
  const solid = p.mode === "solid"

  const d = useMemo(() => {
    // Envelope = widest radius at each height, which is what a caliper would read as Ø
    const env = Array.from({ length: NZ }, (_, i) => {
      let m = 0
      for (let j = 0; j < NT; j += 2) m = Math.max(m, radiusAt(p, (j / NT) * TAU, i / (NZ - 1)))
      return m
    })
    const iMax = env.indexOf(Math.max(...env))
    return {
      env, R: env[iMax], zMax: (iMax / (NZ - 1)) * H,
      right: wallSection(p, 0, 1, H), left: wallSection(p, Math.PI, -1, H),
    }
  }, [p, H])

  const top = useMemo(() => {
    const ring = Array.from({ length: NT }, (_, j) => {
      const th = (j / NT) * TAU, r = radiusAt(p, th, slice)
      return [r * Math.cos(th), r * Math.sin(th)] as [number, number]
    })
    const inner = ring.map(([x, y], j) => {
      const [ax, ay] = ring[(j - 1 + NT) % NT], [bx, by] = ring[(j + 1) % NT]
      const tx = bx - ax, ty = by - ay, l = Math.hypot(tx, ty)
      return [x - (ty / l) * p.thickness, y + (tx / l) * p.thickness] as [number, number]
    })
    const rs = ring.map(([x, y]) => Math.hypot(x, y))
    return { ring, inner, min: Math.min(...rs), max: Math.max(...rs) }
  }, [p, slice])

  // Frame snaps to 20 mm steps (and freezes while dragging) so points don't swim under the cursor
  const R = Math.ceil(Math.max(d.R, 60) / 20) * 20
  const pad = Math.max(R, H) * 0.22
  const pts = p.profile

  const toLocal = (e: PointerEvent | React.MouseEvent) => {
    const m = svg.current!.getScreenCTM()!.inverse()
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
    return { t: clamp((H - q.y) / H, 0, 1), r: clamp(q.x, 10, 150) }
  }
  const setPts = (next: Pt[]) => set({ profile: next.map(([t, r]) => [+t.toFixed(4), +r.toFixed(2)] as Pt) })
  const move = (e: PointerEvent) => {
    if (!drag) return
    const { t, r } = toLocal(e), i = drag.i, last = pts.length - 1
    const nt = i === 0 ? 0 : i === last ? 1 : clamp(t, pts[i - 1][0] + 0.02, pts[i + 1][0] - 0.02)
    setPts(pts.map((q, k) => (k === i ? [nt, r] : q)))
  }
  const addPoint = (e: React.MouseEvent) => {
    const { t, r } = toLocal(e)
    if (mode !== "side" || t < 0.03 || t > 0.97 || pts.some(([pt]) => Math.abs(pt - t) < 0.03)) return
    const next = [...pts, [t, r] as Pt].sort((a, b) => a[0] - b[0])
    setPts(next)
    setSel(next.findIndex(([pt]) => pt === t))
  }
  const removePoint = (i: number) => {
    if (i === 0 || i === pts.length - 1) return
    setPts(pts.filter((_, k) => k !== i))
    setSel(null)
  }
  const fs = Math.max(R, H) / 13
  const sliceY = H - slice * H
  const hole = p.hole / 2, ringOut = hole + 6
  const rim = useMemo(() => glueRimR(p), [p])
  const dim = "stroke-muted-foreground"
  const txt = { fontSize: fs, className: "fill-muted-foreground" }

  const vb = mode === "side"
    ? `${-R - pad * 0.6} ${-pad} ${2 * R + pad * 2.3} ${H + pad * 2}`
    : `${-R - pad * 0.4} ${-R - pad * 0.4} ${2 * R + pad * 0.8} ${2 * R + pad * 0.8}`

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Profile section</CardTitle>
        <CardAction>
          <ToggleGroup label="Section" value={mode} options={["side", "top"] as const} onChange={setMode} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <svg ref={svg} viewBox={drag?.vb ?? vb} className="h-64 w-full touch-none select-none" role="img"
          onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onDoubleClick={addPoint}
          aria-label={mode === "side" ? `Side section, ${f1(H)} mm tall, ${f1(2 * d.R)} mm max diameter` : `Top slice at ${f1(slice * H)} mm`}>
          {mode === "side" ? (
            <>
              <line x1={0} y1={-pad * 0.3} x2={0} y2={H + pad * 0.3} className={dim} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              <polyline points={fmt(d.env.map((r, i) => [r, H - (i / (NZ - 1)) * H]))} fill="none" className={dim} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
              <polygon points={fmt(d.right)} className="fill-foreground/80" />
              <polygon points={fmt(d.left)} className="fill-foreground/80" />
              {p.fitting !== "none" && (
                <g className="fill-foreground/55">
                  <rect x={hole} y={H - 3} width={(solid ? radiusAt(p, 0, 0) : rim) - hole} height={3} />
                  <rect x={-ringOut} y={H - 3} width={6} height={3} />
                  {!solid && <>
                    <rect x={rim - 2} y={H - GLUE_RIM_H} width={2} height={GLUE_RIM_H} />
                    <rect x={-rim} y={H - GLUE_RIM_H} width={2} height={GLUE_RIM_H} />
                  </>}
                </g>
              )}
              <line x1={-R - pad * 0.4} x2={R + pad * 0.4} y1={sliceY} y2={sliceY} className="stroke-info" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />

              {/* Editable silhouette: the base curve the patterns are applied to, with its control points */}
              <polyline fill="none" className="stroke-info" strokeWidth={2} vectorEffect="non-scaling-stroke"
                points={Array.from({ length: 101 }, (_, i) => `${profileR(pts, i / 100).toFixed(2)},${(H - (i / 100) * H).toFixed(2)}`).join(" ")} />
              {pts.map(([t, r], i) => (
                <circle key={i} cx={r} cy={H - t * H} r={fs * 0.5} tabIndex={0} role="button"
                  aria-label={`Profile point ${i + 1}: ${f1(t * H)} mm up, Ø ${f1(2 * r)}`}
                  className={`cursor-grab stroke-info ${sel === i ? "fill-info" : "fill-background"}`} strokeWidth={2} vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => { e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId); setSel(i); setDrag({ i, vb }); onDragState(true) }}
                  onDoubleClick={(e) => { e.stopPropagation(); removePoint(i) }} />
              ))}

              {/* Height */}
              <line x1={R + pad * 0.5} x2={R + pad * 0.5} y1={0} y2={H} className={dim} vectorEffect="non-scaling-stroke" />
              <text {...txt} x={R + pad * 0.65} y={H / 2} dominantBaseline="middle">{f1(H)}</text>
              {/* Open end (top) and fitting end (bottom) diameters */}
              <line x1={-d.env[NZ - 1]} x2={d.env[NZ - 1]} y1={-pad * 0.35} y2={-pad * 0.35} className={dim} vectorEffect="non-scaling-stroke" />
              <text {...txt} x={0} y={-pad * 0.5} textAnchor="middle">Ø {f1(2 * d.env[NZ - 1])}</text>
              <line x1={-d.env[0]} x2={d.env[0]} y1={H + pad * 0.35} y2={H + pad * 0.35} className={dim} vectorEffect="non-scaling-stroke" />
              <text {...txt} x={0} y={H + pad * 0.35 + fs * 1.1} textAnchor="middle">Ø {f1(2 * d.env[0])}</text>
              {d.zMax > H * 0.05 && d.zMax < H * 0.95 && (
                <g>
                  <line x1={-d.R} x2={d.R} y1={H - d.zMax} y2={H - d.zMax} className={dim} vectorEffect="non-scaling-stroke" />
                  <text {...txt} x={0} y={H - d.zMax - fs * 0.4} textAnchor="middle">max Ø {f1(2 * d.R)}</text>
                </g>
              )}
            </>
          ) : (
            <>
              <line x1={-R} x2={R} y1={0} y2={0} className={dim} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              <line y1={-R} y2={R} x1={0} x2={0} className={dim} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              {/* SVG y points down; flip so the slice reads as seen from above */}
              <path fillRule="evenodd" className="fill-foreground/80" transform="scale(1,-1)"
                d={`M${fmt(top.ring)}Z M${fmt(top.inner)}Z`} />
              <circle r={top.max} fill="none" className={dim} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>

        {mode === "side" && sel !== null && pts[sel] && (() => {
          const ends = sel === 0 || sel === pts.length - 1
          return (
            <div className="space-y-2">
              {!ends && <Bar label={`Point ${sel + 1} height`} value={+(pts[sel][0] * H).toFixed(1)} step={0.5} unit="mm"
                min={+((pts[sel - 1][0] + 0.02) * H).toFixed(1)} max={+((pts[sel + 1][0] - 0.02) * H).toFixed(1)}
                onChange={(v) => setPts(pts.map((q, k) => (k === sel ? [v / H, q[1]] : q)))} />}
              <Bar label={`Point ${sel + 1} Ø`} value={+(pts[sel][1] * 2).toFixed(1)} min={20} max={300} step={0.5} unit="mm"
                onChange={(v) => setPts(pts.map((q, k) => (k === sel ? [q[0], v / 2] : q)))} />
              {!ends && <Button size="sm" variant="ghost" className="w-full" onClick={() => removePoint(sel)}>Remove point</Button>}
            </div>
          )
        })()}

        <Bar label="Slice height" value={+(slice * H).toFixed(1)} min={0} max={H} step={0.5} unit="mm" onChange={(v) => setSlice(v / H)} />
        <p className="text-xs tabular-nums text-muted-foreground">
          At {f1(slice * H)} mm: Ø {f1(2 * top.min)} – {f1(2 * top.max)} · wall {p.thickness} mm
          {p.fitting !== "none" && ` · ring hole Ø ${f1(p.hole)}`}
          {!solid && p.fitting !== "none" && ` · glue rim Ø ${f1(2 * rim)}`}
        </p>
      </CardContent>
    </Card>
  )
}
