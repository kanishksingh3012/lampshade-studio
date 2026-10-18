import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import * as THREE from "three"
import { IconArrowBackUp, IconArrowForwardUp, IconBulb, IconChevronDown, IconColumns, IconDownload, IconVolume, IconVolumeOff, IconLink, IconMoon, IconSun, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Bar, scrub } from "@/components/ui/slider"
import { ToggleGroup } from "@/components/ui/toggle-group"
import { Switch } from "@/components/ui/switch"
import { DEFAULTS, HOLE, PRESETS, PRINTERS, TEX, radiusAt, addPoint, BASE_R, buildBase, buildFitting, buildShade, movePoint, profileR, removePoint, resolution, ringUpInUse, setTexture, tableLayout, texture, volume, type Params } from "./geometry"
import { gridGeometry } from "./shapeShader"
import { toGeometry } from "./perforate"
import { muted, setMuted } from "@/lib/sound"
import { Viewer, type Shot, type View } from "./Viewer"
import { ProfileView } from "./ProfileView"
import { download, profileSvg, to3mf, toStl, type Part } from "./export"

const COLORS = { "Natural": "#f2e8d5", "White": "#ffffff", "Sun": "#e9c46a", "Coral": "#e76f51", "Teal": "#2a9d8f", "Navy": "#3d405b" }
type Set = (patch: Partial<Params>) => void
type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params]

// Saved designs live in this browser only (no accounts). Storage can be unavailable, so never trust it.
type Saved = { name: string; p: Params }
const KEY = "lampshade-designs"
function loadSaved(): Saved[] { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") } catch { return [] } }
function storeSaved(list: Saved[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* private mode */ } }

function MyDesigns({ p, load, compare, setCompare }: { p: Params; load: (p: Params) => void; compare: Saved | null; setCompare: (s: Saved | null) => void }) {
  const [list, setList] = useState(loadSaved)
  const [name, setName] = useState("")
  const update = (next: Saved[]) => { setList(next); storeSaved(next) }
  const save = () => {
    const n = name.trim() || `Lampshade ${list.length + 1}`
    update([{ name: n, p }, ...list.filter((s) => s.name !== n)])
    setName("")
  }
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save() }}>
        <Input className="h-9 min-w-0 flex-1" placeholder="Name this design" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Button size="sm" type="submit">Save</Button>
      </form>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((s) => (
            <span key={s.name} className="inline-flex items-center rounded-md border">
              <Button size="sm" variant="ghost" onClick={() => load({ ...DEFAULTS, ...s.p })}>{s.name}</Button>
              <Button size="icon-sm" variant={compare?.name === s.name ? "default" : "ghost"} aria-label={`Compare with ${s.name}`} title="Show beside the current design"
                onClick={() => setCompare(compare?.name === s.name ? null : { name: s.name, p: { ...DEFAULTS, ...s.p } })}><IconColumns /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Copy link to ${s.name}`} title="Copy share link"
                onClick={() => navigator.clipboard.writeText(location.origin + location.pathname + "#" + btoa(JSON.stringify(s.p)))}><IconLink /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => update(list.filter((x) => x !== s))}><IconX /></Button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Light by default; a dark choice is remembered (index.html applies it before first paint)
function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    try { localStorage.setItem("theme", dark ? "dark" : "light") } catch { /* storage blocked */ }
  }, [dark])
  return [dark, setDark] as const
}

function ThemeToggle({ dark, setDark, className = "" }: { dark: boolean; setDark: (d: boolean) => void; className?: string }) {
  return (
    <Button size="icon-sm" variant="ghost" className={className} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setDark(!dark)}>
      {dark ? <IconSun /> : <IconMoon />}
    </Button>
  )
}

// Silhouette thumbnail of a preset: side cut at θ = 0 / π, scaled into a 40×48 box
function PresetThumb({ preset }: { preset: Partial<Params> }) {
  const q = { ...DEFAULTS, ...preset }, n = 40
  const right = Array.from({ length: n + 1 }, (_, i) => [radiusAt(q, 0, i / n), i / n] as const)
  const left = Array.from({ length: n + 1 }, (_, i) => [-radiusAt(q, Math.PI, i / n), i / n] as const).reverse()
  const R = Math.max(...[...right, ...left].map(([x]) => Math.abs(x)))
  const s = Math.min(18 / R, 44 / q.height)
  const pts = [...right, ...left].map(([x, t]) => `${(20 + x * s).toFixed(1)},${(46 - t * q.height * s).toFixed(1)}`).join(" ")
  return <svg viewBox="0 0 40 48" className="h-8 w-7" aria-hidden><polygon points={pts} className="fill-foreground/75" /></svg>
}

function SoundToggle() {
  const [off, setOff] = useState(muted)
  return (
    <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label={off ? "Turn sounds on" : "Mute sounds"}
      onClick={() => { setMuted(!off); setOff(!off) }}>
      {off ? <IconVolumeOff /> : <IconVolume />}
    </Button>
  )
}

// Engraved text → TEX×TEX greyscale relief. Drawn at the aspect of one repeat of the wall
// (circumference ÷ repeats by height) so letters keep their shape once wrapped, and rotated 180°
// because the fitting end (t = 0) is at the top when the lamp is in use (pendant or harp), so the
// text reads upright on the hanging lamp. Rows are stored bottom-up (row 0 = t = 0).
function textTexture(text: string, aspect: number, flip: boolean) {
  const c = document.createElement("canvas")
  c.height = 256; c.width = Math.max(32, Math.round(256 * aspect))
  const g = c.getContext("2d")!
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height)
  g.translate(c.width / 2, c.height / 2); if (flip) g.rotate(Math.PI)
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"
  let size = 80
  g.font = `bold ${size}px system-ui, sans-serif`
  size = Math.min(size, (size * c.width * 0.85) / g.measureText(text).width)
  g.font = `bold ${size}px system-ui, sans-serif`
  g.fillText(text, 0, 0)
  const sq = document.createElement("canvas")
  sq.width = sq.height = TEX
  const q = sq.getContext("2d")!
  q.drawImage(c, 0, 0, TEX, TEX)
  const px = q.getImageData(0, 0, TEX, TEX).data, out = new Uint8Array(TEX * TEX)
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) out[y * TEX + x] = px[((TEX - 1 - y) * TEX + x) * 4]
  return out
}

function readHash(): Params {
  try { return { ...DEFAULTS, ...JSON.parse(atob(location.hash.slice(1))) } } catch { return DEFAULTS }
}

// Slider + exact numeric entry. `scale` shows radii as diameters.
// One control: a full-width value bar (see ui/slider.tsx). `scale` shows radii as diameters, fractions as %.
function Num({ p, set, k, label, min, max, step = 1, unit = "mm", scale = 1 }:
  { p: Params; set: Set; k: NumKey; label: string; min: number; max: number; step?: number; unit?: string; scale?: number }) {
  return <Bar label={label} value={+(p[k] * scale).toFixed(2)} min={min} max={max} step={step} unit={unit || undefined}
    onChange={(v) => set({ [k]: v / scale })} />
}

const Choice = ToggleGroup

// Collapsible panel section: title row with chevron, 8px rhythm between controls
function Section({ title, open: initial = true, children }: { title: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className="border-b last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex h-12 w-full items-center justify-between px-4 text-sm font-semibold outline-none focus-visible:bg-default">
        {title}
        <IconChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="space-y-2 px-4 pb-4">{children}</div>}
    </section>
  )
}

const Note = ({ children }: { children: ReactNode }) => <p className="px-1 pt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>


// Slider + exact numeric entry. `scale` shows radii as diameters.
export default function App() {
  const [p, setP] = useState<Params>(readHash)
  const [baseView, setView] = useState<View>("studio")
  // Lit is a separate on/off switch layered over whichever view is picked
  const [lit, setLit] = useState(false)
  const view: View = lit ? "lit" : baseView
  const [dark, setDark] = useTheme()
  const [shot, setShot] = useState<{ kind: Shot; n: number } | null>(null)
  const set: Set = (patch) => setP((prev) => ({ ...prev, ...patch }))
  // The view draws the live params on the GPU (shapeShader.ts). The exact CPU mesh (export, stats,
  // hole cutting) follows the settled params: 250 ms after the last change, never mid-drag.
  const [handleDrag, setDragging] = useState(false)
  const dragging = useSyncExternalStore(scrub.subscribe, scrub.get) || handleDrag
  // Engraving texture follows the design (aspect rounded so dragging the profile doesn't redraw it)
  const aspect = Math.round(((2 * Math.PI * profileR(p.profile, 0.5)) / p.texRepeat / p.height) * 20) / 20
  const flipText = ringUpInUse(p)
  const texVer = useMemo(() => { setTexture(p.engrave ? textTexture(p.engrave, aspect, flipText) : null); return texture().version }, [p.engrave, aspect, flipText])
  const keyOf = (q: Params) => { const { lumens: _l, kelvin: _k, finish: _f, ...rest } = q; return JSON.stringify(rest) + texVer }
  const [sp, setSp] = useState(p)
  useEffect(() => {
    if (dragging) return
    const t = setTimeout(() => setSp(p), 250)
    return () => clearTimeout(t)
  }, [p, dragging])
  const pKey = keyOf(p), spKey = keyOf(sp), settled = pKey === spKey
  const { geo, fitting: fullFitting, stats } = useMemo(() => buildShade(sp, new THREE.Color(sp.color)), [spKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const { NT, NZ } = resolution(p)
  const solidMode = p.mode === "solid"
  const grid = useMemo(() => gridGeometry(NT, NZ, solidMode), [NT, NZ, solidMode])
  const fitting = useMemo(() => settled ? fullFitting : buildFitting(p, new THREE.Color(p.color)), [pKey, settled, fullFitting]) // eslint-disable-line react-hooks/exhaustive-deps
  const perfKey = JSON.stringify([sp.perfShape, sp.perfCols, sp.perfRows, sp.perfSize, sp.perfStart, sp.perfEnd, sp.perfStagger, sp.color])
  const edit = {
    profile: p.profile, height: p.height, onDragState: setDragging,
    onMove: (i: number, t: number, r: number) => setP((v) => ({ ...v, profile: movePoint(v.profile, i, t, r) })),
    onAdd: (t: number) => setP((v) => ({ ...v, profile: addPoint(v.profile, t, profileR(v.profile, t)) })),
    onRemove: (i: number) => setP((v) => ({ ...v, profile: removePoint(v.profile, i) })),
  }

  // Perforations: manifold-3d boolean in a worker, keyed to the settled shade it was cut from.
  // Until it lands the GPU preview draws the holes in the shader.
  const worker = useMemo(() => new Worker(new URL("./perf.worker.ts", import.meta.url), { type: "module" }), [])
  const [cut, setCut] = useState<{ from: THREE.BufferGeometry; geo: THREE.BufferGeometry; grams: number } | null>(null)
  const perforating = p.perfShape !== "none" && p.mode === "solid"
  const spPerf = sp.perfShape !== "none" && sp.mode === "solid"
  useEffect(() => {
    if (!spPerf) return
    worker.onmessage = (e) => {
      if (e.data.id !== geo.uuid) return
      const g = toGeometry(e.data.pos, e.data.idx, sp.color)
      setCut({ from: geo, geo: g, grams: ((volume(geo) - volume(g)) / 1000) * 1.24 })
    }
    worker.postMessage({
      id: geo.uuid, p: sp,
      pos: Float32Array.from(geo.attributes.position.array), idx: Uint32Array.from(geo.index!.array),
    })
  }, [geo, spPerf, worker, perfKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = cut?.from === geo
  const showCut = perforating && settled && ready
  const shade = showCut ? cut.geo : grid
  const pending = perforating && !showCut
  const grams = stats.grams - (spPerf && ready ? cut.grams : 0)
  const exportGeo = spPerf && ready ? cut.geo : geo
  const tableBaseGeo = useMemo(() => buildBase(new THREE.Color(p.color), p.baseCord), [p.color, p.baseCord])
  const baseGeo = p.tableBase ? tableBaseGeo : null
  // Side-by-side extras in the studio view: the table base, and a saved design picked for comparison
  const [compare, setCompare] = useState<Saved | null>(null)
  const compareGeo = useMemo(() => compare ? buildShade(compare.p, new THREE.Color("#9ca3af")).geo : null, [compare])

  // Undo / redo: a snapshot is taken once the design rests for 400 ms
  const hist = useRef({ past: [] as Params[], future: [] as Params[], cur: p, skip: false })
  const [, bump] = useState(0)
  useEffect(() => {
    const h = hist.current
    if (h.skip) { h.skip = false; h.cur = p; return }
    const t = setTimeout(() => {
      if (h.cur === p) return
      h.past.push(h.cur); if (h.past.length > 100) h.past.shift()
      h.future = []; h.cur = p; bump((n) => n + 1)
    }, 400)
    return () => clearTimeout(t)
  }, [p])
  const go = (from: "past" | "future") => {
    const h = hist.current, to = from === "past" ? "future" : "past"
    if (p !== h.cur) { h[to].push(p); h.skip = true; setP(h.cur); return } // unsaved change: undo to last snapshot
    const q = h[from].pop()
    if (!q) return
    h[to].push(p); h.skip = true; setP(q); bump((n) => n + 1)
  }
  const undo = () => go("past"), redo = () => go("future")
  const canUndo = hist.current.past.length > 0 || p !== hist.current.cur, canRedo = hist.current.future.length > 0
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select")) return
      const mod = e.metaKey || e.ctrlKey, z = e.key.toLowerCase() === "z"
      if (mod && z && !e.shiftKey) { e.preventDefault(); undo() }
      else if (mod && ((z && e.shiftKey) || e.key.toLowerCase() === "y")) { e.preventDefault(); redo() }
    }
    addEventListener("keydown", k)
    return () => removeEventListener("keydown", k)
  })

  useEffect(() => { history.replaceState(null, "", "#" + btoa(JSON.stringify(p))) }, [p])

  const vase = p.mode === "vase"
  const parts: Part[] = [{ name: "shade", geo: exportGeo }, ...(fitting ? [{ name: vase ? "glue-in-ring" : "spider", geo: fitting }] : [])]
  // Solid: one fused print. Vase: shade and ring are separate prints (the ring can't be spiralized).
  const exportStl = () => {
    if (baseGeo) download(toStl([{ name: "table-base", geo: baseGeo }]), "lampshade-table-base.stl", "model/stl")
    exportShadeStl()
  }
  const exportShadeStl = () => vase
    ? parts.forEach((pt) => download(toStl([pt]), `lampshade-${pt.name}.stl`, "model/stl"))
    : download(toStl(parts), "lampshade.stl", "model/stl")
  const export3mf = () => download(to3mf(parts, !vase, baseGeo ? [{ name: "table-base", geo: baseGeo }] : []), "lampshade.3mf", "model/3mf")

  const R = stats.size[0] / 2
  const extras = useMemo(() => [
    ...(compareGeo ? [{ geo: compareGeo, x: R + (compareGeo.boundingBox!.max.x) + 40, color: "#9ca3af" }] : []),
    ...(baseGeo ? [{ geo: baseGeo, x: -(R + BASE_R + 40), color: p.color }] : []),
  ], [compareGeo, baseGeo, R, p.color])
  const undoRedo = <>
    <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}><IconArrowBackUp /></Button>
    <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}><IconArrowForwardUp /></Button>
  </>
  const exportSvg = () => download(profileSvg(p), "lampshade-profile.svg", "image/svg+xml")
  const time = stats.minutes < 60 ? `${Math.round(stats.minutes)} min` : `${Math.floor(stats.minutes / 60)} h ${Math.round(stats.minutes % 60)} min`
  const [w, d, h] = stats.size
  const stat = (ok: boolean) => <span className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-warning"}`} />
  return (
    // Desktop: full-screen canvas with two floating panels (shape tools left, settings right).
    // Mobile: brand bar, canvas, then both panels stacked in one scroll.
    <div className="relative flex h-dvh flex-col overflow-y-auto overflow-x-hidden bg-background text-foreground lg:block lg:overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 leading-tight">
              <h1 className="truncate text-sm font-semibold tracking-tight">Lampshade Studio</h1>
              <a href="https://github.com/kanishksingh3012" target="_blank" rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline">by Kanishk</a>
            </div>
            <div className="-mr-1 flex shrink-0 items-center">
              <SoundToggle />
              <ThemeToggle dark={dark} setDark={setDark} />
            </div>
      </header>

      <main className="relative h-[60dvh] shrink-0 lg:absolute lg:inset-0 lg:h-auto">
        <Viewer shot={shot} dark={dark} edit={edit} geo={shade} holes={pending} fitting={fitting} p={p} extras={extras} baseGeo={tableBaseGeo} view={view} bed={PRINTERS[p.printer]} />

        {/* View toolbar, centred over the canvas */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-start p-3 sm:justify-center lg:top-3 lg:p-0">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-surface/95 p-1 shadow-sm backdrop-blur max-w-full overflow-x-auto [scrollbar-width:none]">
            {undoRedo}
            <span className="h-5 w-px shrink-0 bg-separator" />
            <Button size="sm" variant={lit ? "default" : "ghost"} aria-pressed={lit} onClick={() => setLit(!lit)}>
              <IconBulb /> Lit
            </Button>
            {lit && <Choice bare value={p.mount} options={["pendant", "table"] as const} onChange={(mount) => set({ mount })} />}
            <span className="h-5 w-px shrink-0 bg-separator" />
            <Choice bare value={baseView} options={["studio", "overhangs", "zebra", "wire", "mesh"] as const} onChange={setView}
              labels={{ overhangs: "Print check", wire: "Wireframe" }} />
          </div>
        </div>

        {/* Camera rail, just inside the right panel */}
        <div className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 lg:right-[324px]">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-surface/95 p-1 shadow-sm backdrop-blur flex-col" role="group" aria-label="Camera views">
            {(["front", "side", "top", "fit"] as const).map((k) => (
              <Button key={k} size="sm" variant="ghost" className="w-full justify-start capitalize" onClick={() => setShot({ kind: k, n: Date.now() })}>{k}</Button>
            ))}
          </div>
        </div>

        {view === "overhangs" && (
          <div className="absolute right-3 bottom-16 w-60 space-y-2 rounded-xl border bg-surface/95 p-3.5 text-xs shadow-sm backdrop-blur lg:right-[324px]">
            <p className="text-sm font-medium">Print check</p>
            <p className="leading-relaxed text-muted-foreground">Overhangs are walls that lean out with nothing below them. Past 45° the printer lays plastic on thin air and it sags.</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#e5484d]" /> Over 45°: likely to sag</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#f5a524]" /> 35–45°: borderline</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full border bg-surface" /> Under 35°: prints fine</p>
          </div>
        )}

        {/* Status bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 lg:bottom-3 lg:p-0">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border bg-surface/95 px-4 py-2 text-xs tabular-nums shadow-sm backdrop-blur">
            <span>Ø {Math.max(w, d).toFixed(1)} × {h.toFixed(1)} mm</span>
            <span className="h-3 w-px bg-separator" />
            <span>≈ {grams.toFixed(0)} g PLA</span>
            <span className="h-3 w-px bg-separator" />
            <span title="Rough estimate at ~10 mm³/s">≈ {time}</span>
            <span className="h-3 w-px bg-separator" />
            <span className="flex items-center gap-1.5">{stat(stats.maxOverhang <= 45)} Overhang {stats.maxOverhang.toFixed(0)}°</span>
            <span className="h-3 w-px bg-separator" />
            <span className="flex items-center gap-1.5">{stat(stats.fitsBed)} {stats.fitsBed ? "Fits" : "Too big for"} {p.printer}</span>
            {pending && <><span className="h-3 w-px bg-separator" /><span className="text-muted-foreground">Cutting holes…</span></>}
          </div>
        </div>
      </main>

      <aside className="flex flex-col border-t bg-surface lg:absolute lg:top-3 lg:bottom-3 lg:z-10 lg:w-[300px] lg:overflow-hidden lg:rounded-2xl lg:border lg:bg-surface/95 lg:shadow-[0_8px_30px_rgb(0_0_0/0.08)] lg:backdrop-blur-md lg:left-3">
        <div className="hidden h-16 shrink-0 items-center gap-3 border-b px-4 lg:flex">
            <img src="/favicon.svg" alt="" className="size-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 leading-tight">
              <h1 className="truncate text-sm font-semibold tracking-tight">Lampshade Studio</h1>
              <a href="https://github.com/kanishksingh3012" target="_blank" rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline">by Kanishk</a>
            </div>
            <div className="-mr-1 flex shrink-0 items-center">
              <SoundToggle />
              <ThemeToggle dark={dark} setDark={setDark} />
            </div>
        </div>
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overflow-x-hidden">
          <Section title="Start from">
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(PRESETS).map(([name, pr]) => (
                <button key={name} onClick={() => set(pr)} title={name} aria-label={name}
                  className="flex aspect-square items-center justify-center rounded-lg bg-default transition-colors hover:bg-foreground/[0.09]">
                  <PresetThumb preset={pr} />
                </button>
              ))}
            </div>
          </Section>
          <Section title="Profile">
            <ProfileView p={p} set={set} onDragState={setDragging} />
          </Section>
          <Section title="Form">
            <Num p={p} set={set} k="height" label="Height" min={60} max={300} step={0.5} />
            <Num p={p} set={set} k="sides" label="Sides (0 = round)" min={0} max={12} unit="" />
            <Note>Drag the blue points on the model or in the profile to shape the silhouette. Double-click to add or remove a point.</Note>
          </Section>
        </div>
      </aside>

      <aside className="flex flex-col border-t bg-surface lg:absolute lg:top-3 lg:bottom-3 lg:z-10 lg:w-[300px] lg:overflow-hidden lg:rounded-2xl lg:border lg:bg-surface/95 lg:shadow-[0_8px_30px_rgb(0_0_0/0.08)] lg:backdrop-blur-md lg:right-3">
        <div className="hidden h-16 shrink-0 items-center border-b px-4 lg:flex">
          <h2 className="text-sm font-semibold">Settings</h2>
        </div>
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overflow-x-hidden">
          {stats.warnings.length > 0 && (
            <div className="mx-4 mt-4 space-y-1 rounded-lg bg-warning/10 px-3.5 py-3 text-xs leading-relaxed">
              {stats.warnings.map((m) => <p key={m}>{m}</p>)}
            </div>
          )}
          <Section title="Surface">
            <Num p={p} set={set} k="twist" label="Twist" min={-360} max={360} step={5} unit="°" />
            <Num p={p} set={set} k="ripples" label="Ripples" min={0} max={60} unit="" />
            <Num p={p} set={set} k="rippleDepth" label="Ripple depth" min={0} max={15} step={0.1} />
            <Num p={p} set={set} k="waves" label="Vertical waves" min={0} max={10} unit="" />
            <Num p={p} set={set} k="waveDepth" label="Wave depth" min={0} max={15} step={0.1} />
          </Section>
          <Section title="Pattern">
            <Choice label="Type" value={p.pattern} options={["none", "voronoi", "knurl", "weave"] as const} onChange={(pattern) => set({ pattern })} />
            {p.pattern !== "none" && <>
              <Num p={p} set={set} k="patCount" label="Cells around" min={3} max={40} unit="" />
              <Num p={p} set={set} k="patDepth" label="Relief depth" min={0} max={6} step={0.1} />
            </>}
          </Section>
          <Section title="Text engraving" open={false}>
            <Input aria-label="Engraved text" className="h-9 w-full" placeholder="Type text to engrave" value={p.engrave} maxLength={24}
              onChange={(e) => { const engrave = e.currentTarget.value; set(p.texDepth ? { engrave } : { engrave, texDepth: -0.8 }) }} />
            {p.engrave && <>
              <Num p={p} set={set} k="texDepth" label="Depth" min={-3} max={3} step={0.1} />
              <Num p={p} set={set} k="texRepeat" label="Repeats around" min={1} max={12} unit="" />
            </>}
            <Note>Negative depth cuts the letters in, positive raises them. Text reads upright when the lamp hangs, so it looks upside down in the print views.</Note>
          </Section>
          <Section title="Perforation" open={false}>
            <Choice label="Shape" value={p.perfShape} options={["none", "circle", "slot", "diamond"] as const} onChange={(perfShape) => set({ perfShape })} />
            {p.perfShape !== "none" && <>
              <Num p={p} set={set} k="perfCols" label="Holes around" min={3} max={60} unit="" />
              <Num p={p} set={set} k="perfRows" label="Rows" min={1} max={30} unit="" />
              <Num p={p} set={set} k="perfSize" label="Hole height" min={2} max={40} step={0.5} />
              <Num p={p} set={set} k="perfStart" label="Band start" min={0} max={100} step={1} unit="%" scale={100} />
              <Num p={p} set={set} k="perfEnd" label="Band end" min={0} max={100} step={1} unit="%" scale={100} />
              <div className="flex h-9 items-center justify-between rounded-lg bg-default px-3 text-sm">
                Stagger rows
                <Switch label="Stagger rows" checked={p.perfStagger} onCheckedChange={(v) => set({ perfStagger: v })} />
              </div>
              {p.mode === "vase" && <Note>Holes need solid mode (see Print). Vase mode can't print them.</Note>}
            </>}
          </Section>
          <Section title="Color">
            <div className="flex items-center gap-2 rounded-lg bg-default px-3 py-2">
              {Object.entries(COLORS).map(([name, c]) => (
                <button key={c} aria-label={name} title={name} onClick={() => set({ color: c })} style={{ background: c }}
                  className={`size-6 rounded-full border border-black/10 transition-shadow ${p.color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-default" : ""}`} />
              ))}
              <input type="color" aria-label="Custom colour" value={p.color} onChange={(e) => set({ color: e.target.value })}
                className="ml-auto size-6 cursor-pointer rounded-full border-0 bg-transparent" />
            </div>
            <Choice label="Finish" value={p.finish} options={["matte", "silk", "glossy"] as const} onChange={(finish) => set({ finish })} />
          </Section>
          <Section title="Light" open={false}>
            <Num p={p} set={set} k="lumens" label="Brightness" min={200} max={1600} step={50} unit="lm" />
            <Num p={p} set={set} k="kelvin" label="Temperature" min={2200} max={6500} step={100} unit="K" />
            <Note>Turn on Lit above the model to see filament, wall and bulb glow together.</Note>
          </Section>
          <Section title="Print" open={false}>
            <Choice label="Mode" value={p.mode} options={["solid", "vase"] as const} onChange={(mode) => set({ mode })} />
            <Num p={p} set={set} k="thickness" label={p.mode === "vase" ? "Line width" : "Wall"} min={0.4} max={3} step={0.05} />
            {p.mode === "solid" && <Num p={p} set={set} k="wallTaper" label="Extra wall at top" min={-1} max={2} step={0.05} />}
            <Choice label="Nozzle" value={String(p.nozzle) as "0.4" | "0.6" | "0.8"} options={["0.4", "0.6", "0.8"] as const}
              labels={{ "0.4": <span className="normal-case">0.4 mm</span>, "0.6": <span className="normal-case">0.6 mm</span>, "0.8": <span className="normal-case">0.8 mm</span> }} onChange={(v) => set({ nozzle: +v })} />
            <label className="flex h-9 items-center gap-3 rounded-lg bg-default pr-2 pl-3 text-sm">
              <span className="flex-1">Printer</span>
              <select value={p.printer} onChange={(e) => set({ printer: e.target.value as Params["printer"] })}
                className="h-7 rounded-md bg-segment px-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {Object.keys(PRINTERS).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <Choice label="Fitting" value={p.fitting} options={["E27", "E14", "harp", "none"] as const}
              onChange={(fitting) => set(fitting === "none" ? { fitting } : { fitting, hole: HOLE[fitting], ...(fitting === "harp" ? { mount: "table" as const } : {}) })} />
            <div className="flex h-9 items-center justify-between rounded-lg bg-default px-3 text-sm">
              Table-lamp base
              <Switch label="Table-lamp base" checked={p.tableBase} onCheckedChange={(v) => set(v ? { tableBase: v, fitting: "harp", hole: HOLE.harp, mount: "table" } : { tableBase: v })} />
            </div>
            {p.tableBase && <>
              <Choice label="Cord exit" value={p.baseCord} options={["channel", "feet"] as const} labels={{ channel: "Groove", feet: "Feet" }} onChange={(baseCord) => set({ baseCord })} />
              <Note>Exported as its own part: a Ø {BASE_R * 2} mm disc with a cup for an E27 socket. Thread the cord down through the centre hole; {p.baseCord === "channel" ? "it runs out through the groove under the flat bottom." : "it leaves between the three feet."} Add a harp to hold the shade.</Note>
            </>}
            {p.mount === "table" && (() => {
              const L = tableLayout(p)
              return <Note>{L.ringUp ? `Table lamp: use a ${L.harpIn}-inch (${Math.round(L.harpIn * 25.4)} mm) harp, so the shade's lower edge hides the socket.` : "Table lamp: the ring sits on the socket's shade ring and the shade opens upwards."} Switch Lit on and pick Table to see it.</Note>
            })()}
            {p.fitting !== "none" && <Num p={p} set={set} k="hole" label="Ring hole Ø" min={6} max={60} step={0.1} />}
            <Note>
              {vase ? "Vase mode exports a separate glue-in ring. Spiralize only the shade (bottom layers 0)." : "The ring prints on the bed, fused to the wall."} Measure your holder's collar{p.fitting === "harp" ? " or the harp's finial rod" : ""}. {p.sides >= 3 && "Set the slicer's seam to Aligned or Sharpest corner so it hides in a corner. "}PLA softens near 55 °C, so use LED bulbs only.
            </Note>
          </Section>
          <Section title="My designs" open={false}>
            <MyDesigns p={p} load={setP} compare={compare} setCompare={setCompare} />
            <Note>Designs are saved in this browser only, so clearing site data or using a private window loses them. Use the link button to keep a copy or open a design on another device. The columns button shows a saved design in grey beside the current one.</Note>
          </Section>
        </div>
        <div className="flex shrink-0 gap-1.5 border-t p-3">
          <Button className="min-w-0 flex-1" disabled={!settled || (spPerf && !ready)} onClick={export3mf}><IconDownload /> Export 3MF</Button>
          <Button variant="outline" disabled={!settled || (spPerf && !ready)} className="px-3" onClick={exportStl}>STL</Button>
          <Button variant="outline" className="px-3" title="Profile section as SVG (for paper or laser-cut templates)" onClick={exportSvg}>SVG</Button>
          <Button variant="outline" size="icon-sm" className="size-9 shrink-0" aria-label="Copy share link" title="Copy share link"
            onClick={() => navigator.clipboard.writeText(location.href)}><IconLink /></Button>
        </div>
      </aside>
    </div>
  )
}
