import { useDeferredValue, useEffect, useMemo, useState } from "react"
import * as THREE from "three"
import { IconBulb, IconDownload, IconLink, IconMoon, IconSun, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Switch } from "@/components/ui/switch"
import { DEFAULTS, HOLE, PRESETS, PRINTERS, addPoint, buildShade, movePoint, profileR, removePoint, volume, type Params } from "./geometry"
import { toGeometry } from "./perforate"
import { Viewer, type Shot, type View } from "./Viewer"
import { ProfileView } from "./ProfileView"
import { download, to3mf, toStl, type Part } from "./export"

const COLORS = { "Natural": "#f2e8d5", "White": "#ffffff", "Sun": "#e9c46a", "Coral": "#e76f51", "Teal": "#2a9d8f", "Navy": "#3d405b" }
type Set = (patch: Partial<Params>) => void
type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params]

// Saved designs live in this browser only (no accounts). Storage can be unavailable, so never trust it.
type Saved = { name: string; p: Params }
const KEY = "lampshade-designs"
function loadSaved(): Saved[] { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") } catch { return [] } }
function storeSaved(list: Saved[]) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* private mode */ } }

function MyDesigns({ p, load }: { p: Params; load: (p: Params) => void }) {
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
      <Label>My designs</Label>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save() }}>
        <Input size="sm" placeholder="Name this design" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Button size="sm" type="submit">Save</Button>
      </form>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((s) => (
            <span key={s.name} className="inline-flex items-center rounded-md border">
              <Button size="sm" variant="ghost" onClick={() => load({ ...DEFAULTS, ...s.p })}>{s.name}</Button>
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

function readHash(): Params {
  try { return { ...DEFAULTS, ...JSON.parse(atob(location.hash.slice(1))) } } catch { return DEFAULTS }
}

// Slider + exact numeric entry. `scale` shows radii as diameters.
function Num({ p, set, k, label, min, max, step = 1, unit = "mm", scale = 1 }:
  { p: Params; set: Set; k: NumKey; label: string; min: number; max: number; step?: number; unit?: string; scale?: number }) {
  const v = +(p[k] * scale).toFixed(2)
  const commit = (n: number) => Number.isFinite(n) && set({ [k]: Math.min(max, Math.max(min, n)) / scale })
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <Label>{label}</Label>
        <div className="flex items-center gap-1.5">
          <Input size="sm" type="number" aria-label={label} value={v} min={min} max={max} step={step}
            className="w-20 text-right tabular-nums" onChange={(e) => commit(e.currentTarget.valueAsNumber)} />
          <span className="w-6 text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <Slider aria-label={label} value={v} min={min} max={max} step={step} onValueChange={(n) => commit(n as number)} />
    </div>
  )
}

function Choice<T extends string>({ label, value, options, onChange, labels }:
  { label?: string; value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <ToggleGroup variant="outline" value={[value]} onValueChange={(v) => v[0] && onChange(v[0] as T)} className="flex-wrap">
        {options.map((o) => <ToggleGroupItem key={o} value={o} className="capitalize">{labels?.[o] ?? o}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
  )
}

export default function App() {
  const [p, setP] = useState<Params>(readHash)
  const [baseView, setView] = useState<View>("studio")
  // Lit is a separate on/off switch layered over whichever view is picked
  const [lit, setLit] = useState(false)
  const view: View = lit ? "lit" : baseView
  const [dark, setDark] = useTheme()
  const [shot, setShot] = useState<{ kind: Shot; n: number } | null>(null)
  const set: Set = (patch) => setP((prev) => ({ ...prev, ...patch }))
  const dp = useDeferredValue(p)
  // While a profile point is dragged, build a light draft mesh and pause hole cutting; full detail on release
  const [dragging, setDragging] = useState(false)
  const { geo, fitting, stats } = useMemo(() => buildShade(dp, new THREE.Color(dp.color), dragging), [dp, dragging])
  const edit = {
    profile: p.profile, height: p.height, onDragState: setDragging,
    onMove: (i: number, t: number, r: number) => setP((v) => ({ ...v, profile: movePoint(v.profile, i, t, r) })),
    onAdd: (t: number) => setP((v) => ({ ...v, profile: addPoint(v.profile, t, profileR(v.profile, t)) })),
    onRemove: (i: number) => setP((v) => ({ ...v, profile: removePoint(v.profile, i) })),
  }

  // Perforations: manifold-3d boolean in a worker, debounced, keyed to the shade it was cut from
  const worker = useMemo(() => new Worker(new URL("./perf.worker.ts", import.meta.url), { type: "module" }), [])
  const [cut, setCut] = useState<{ from: THREE.BufferGeometry; geo: THREE.BufferGeometry; grams: number } | null>(null)
  const perforating = dp.perfShape !== "none" && dp.mode === "solid"
  useEffect(() => {
    if (!perforating || dragging) return
    worker.onmessage = (e) => {
      if (e.data.id !== geo.uuid) return
      const g = toGeometry(e.data.pos, e.data.idx, dp.color)
      setCut({ from: geo, geo: g, grams: ((volume(geo) - volume(g)) / 1000) * 1.24 })
    }
    const t = setTimeout(() => worker.postMessage({
      id: geo.uuid, p: dp,
      pos: Float32Array.from(geo.attributes.position.array), idx: Uint32Array.from(geo.index!.array),
    }), 200)
    return () => clearTimeout(t)
  }, [geo, perforating, dragging, worker, dp])
  const ready = cut?.from === geo
  const shade = perforating && ready ? cut.geo : geo
  const pending = perforating && !ready
  const grams = stats.grams - (perforating && ready ? cut.grams : 0)

  useEffect(() => { history.replaceState(null, "", "#" + btoa(JSON.stringify(p))) }, [p])

  const vase = p.mode === "vase"
  const parts: Part[] = [{ name: "shade", geo: shade }, ...(fitting ? [{ name: vase ? "glue-in-ring" : "spider", geo: fitting }] : [])]
  // Solid: one fused print. Vase: shade and ring are separate prints (the ring can't be spiralized).
  const exportStl = () => vase
    ? parts.forEach((pt) => download(toStl([pt]), `lampshade-${pt.name}.stl`, "model/stl"))
    : download(toStl(parts), "lampshade.stl", "model/stl")
  const export3mf = () => download(to3mf(parts, !vase), "lampshade.3mf", "model/3mf")

  const [w, d, h] = stats.size
  return (
    // Desktop: shape tools left, model centre, surface/finish/print + export right (BottleLab-style).
    // Mobile: model on top, then both panels stacked in one scroll.
    <div className="flex h-dvh flex-col overflow-y-auto bg-background text-foreground lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:overflow-hidden">
      <main className="relative h-[55dvh] shrink-0 lg:order-2 lg:h-auto">
        <Viewer shot={shot} dark={dark} edit={edit} geo={shade} fitting={fitting} p={dp} view={view} bed={PRINTERS[p.printer]} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-2 p-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 whitespace-nowrap lg:invisible">
            <img src="/favicon.svg" alt="" className="size-6 rounded-md" />
            <span className="flex items-baseline gap-2">
            <span className={`font-semibold ${view === "lit" ? "text-white" : ""}`}>Lampshade Studio</span>
            <a href="https://github.com/kanishksingh3012" target="_blank" rel="noreferrer"
              className={`pointer-events-auto text-xs opacity-70 ${view === "lit" ? "text-white" : ""}`}>by Kanishk</a>
            </span>
            <ThemeToggle dark={dark} setDark={setDark} className={`pointer-events-auto ${view === "lit" ? "text-white" : ""}`} />
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="pointer-events-auto flex items-center gap-2">
              <Button size="sm" variant={lit ? "default" : "outline"} aria-pressed={lit} onClick={() => setLit(!lit)}
                className="bg-background/90 backdrop-blur aria-pressed:bg-primary">
                <IconBulb /> Lit
              </Button>
            <div className="rounded-lg bg-background/90 p-1 backdrop-blur">
              <Choice value={baseView} options={["studio", "overhangs", "zebra", "wire", "mesh"] as const} onChange={setView} labels={{ overhangs: "Print check", wire: "Wireframe" }} />
            </div>
            </div>
            <div className="pointer-events-auto flex rounded-lg border bg-background/90 p-0.5 backdrop-blur" role="group" aria-label="Camera views">
              {(["front", "side", "top", "fit"] as const).map((k) => (
                <Button key={k} size="xs" variant="ghost" className="capitalize" onClick={() => setShot({ kind: k, n: Date.now() })}>{k}</Button>
              ))}
            </div>
          </div>
        </div>
        {view === "overhangs" && (
          <div className="absolute right-4 bottom-14 max-w-56 space-y-1.5 rounded-lg border bg-background/95 p-3 text-xs shadow-sm">
            <p className="font-medium">Print check</p>
            <p className="text-muted-foreground">Overhangs are walls that lean out with nothing below them. Past 45° the printer lays plastic on thin air and it sags.</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#e5484d]" /> Over 45°: likely to sag</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#f5a524]" /> 35–45°: borderline</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full border bg-background" /> Under 35°: prints fine</p>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap gap-1.5 p-4">
          <Badge>Ø {Math.max(w, d).toFixed(1)} × {h.toFixed(1)} mm</Badge>
          <Badge>≈ {grams.toFixed(0)} g PLA</Badge>
          {pending && <Badge variant="info">Cutting holes…</Badge>}
          <Badge variant={stats.maxOverhang > 45 ? "warning" : "success"}>max overhang {stats.maxOverhang.toFixed(0)}°</Badge>
          <Badge variant={stats.fitsBed ? "success" : "destructive"}>{stats.fitsBed ? "Fits" : "Exceeds"} {p.printer}</Badge>
        </div>
      </main>

      <aside className="space-y-6 border-t p-4 lg:order-1 lg:overflow-y-auto lg:border-t-0 lg:border-r">
          <div className="hidden lg:block">
            <div className="flex items-center gap-2">
              <img src="/favicon.svg" alt="" className="size-7 rounded-md" />
              <div className="flex items-baseline gap-2">
                <h1 className="text-base font-semibold whitespace-nowrap">Lampshade Studio</h1>
                <a href="https://github.com/kanishksingh3012" target="_blank" rel="noreferrer"
                  className="text-xs whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline">by Kanishk</a>
              </div>
              <ThemeToggle dark={dark} setDark={setDark} className="ml-auto shrink-0" />
            </div>
          </div>
        <div className="space-y-2">
          <Label>Start from</Label>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(PRESETS).map((name) => (
              <Button key={name} size="sm" variant="outline" onClick={() => set(PRESETS[name])}>{name}</Button>
            ))}
          </div>
        </div>

        <ProfileView p={p} set={set} onDragState={setDragging} />
        <div className="space-y-5">
            <Num p={p} set={set} k="height" label="Height" min={60} max={300} step={0.5} />
          <p className="text-xs text-muted-foreground">Shape the silhouette by dragging the blue points, on the model or in the section above. Double-click to add or remove a point.</p>
          <Num p={p} set={set} k="sides" label="Sides (0 = round)" min={0} max={12} unit="" />
        </div>
      </aside>

      <aside className="space-y-5 border-t p-4 lg:order-3 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <Tabs defaultValue="surface">
          <TabsList className="w-full">
            <TabsTrigger value="surface">Surface</TabsTrigger>
            <TabsTrigger value="finish">Finish</TabsTrigger>
            <TabsTrigger value="print">Print</TabsTrigger>
          </TabsList>

          <TabsContent value="surface" className="space-y-5 pt-4">
            <Num p={p} set={set} k="twist" label="Twist" min={-360} max={360} step={5} unit="°" />
            <Num p={p} set={set} k="ripples" label="Ripples" min={0} max={60} unit="" />
            <Num p={p} set={set} k="rippleDepth" label="Ripple depth" min={0} max={15} step={0.1} />
            <Num p={p} set={set} k="waves" label="Vertical waves" min={0} max={10} unit="" />
            <Num p={p} set={set} k="waveDepth" label="Wave depth" min={0} max={15} step={0.1} />
            <Choice label="Perforation" value={p.perfShape} options={["none", "circle", "slot", "diamond"] as const}
              onChange={(perfShape) => set({ perfShape })} />
            {p.perfShape !== "none" && <>
              {p.mode === "vase" && <p className="text-xs text-muted-foreground">Holes need solid mode (Print tab). Vase mode can't print them.</p>}
              <Num p={p} set={set} k="perfCols" label="Holes around" min={3} max={60} unit="" />
              <Num p={p} set={set} k="perfRows" label="Rows" min={1} max={30} unit="" />
              <Num p={p} set={set} k="perfSize" label="Hole height" min={2} max={40} step={0.5} />
              <Num p={p} set={set} k="perfStart" label="Band start" min={0} max={100} step={1} unit="%" scale={100} />
              <Num p={p} set={set} k="perfEnd" label="Band end" min={0} max={100} step={1} unit="%" scale={100} />
              <label className="flex items-center justify-between text-sm">
                Stagger rows
                <Switch checked={p.perfStagger} onCheckedChange={(v) => set({ perfStagger: v })} />
              </label>
            </>}
          </TabsContent>

          <TabsContent value="finish" className="space-y-5 pt-4">
            <div className="space-y-2">
              <Label>Filament colour</Label>
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(COLORS).map(([name, c]) => (
                  <button key={c} aria-label={name} title={name} onClick={() => set({ color: c })} style={{ background: c }}
                    className={`size-8 rounded-full border ${p.color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`} />
                ))}
                <input type="color" aria-label="Custom colour" value={p.color} onChange={(e) => set({ color: e.target.value })}
                  className="size-8 cursor-pointer rounded-full border bg-transparent" />
              </div>
            </div>
            <Choice label="Finish" value={p.finish} options={["matte", "silk", "glossy"] as const} onChange={(finish) => set({ finish })} />
            <Num p={p} set={set} k="lumens" label="Bulb brightness" min={200} max={1600} step={50} unit="lm" />
            <Num p={p} set={set} k="kelvin" label="Colour temperature" min={2200} max={6500} step={100} unit="K" />
            <p className="text-xs text-muted-foreground">Open the "lit" view to see how this filament, wall and bulb glow together.</p>
          </TabsContent>

          <TabsContent value="print" className="space-y-5 pt-4">
            <Choice label="Print mode" value={p.mode} options={["solid", "vase"] as const} onChange={(mode) => set({ mode })} />
            <Num p={p} set={set} k="thickness" label={p.mode === "vase" ? "Line width" : "Wall thickness"} min={0.4} max={3} step={0.05} />
            <Choice label={vase ? "Bulb fitting (glue-in ring)" : "Bulb fitting (ring on the bed)"} value={p.fitting} options={["E27", "E14", "none"] as const}
              onChange={(fitting) => set(fitting === "none" ? { fitting } : { fitting, hole: HOLE[fitting] })} />
            {p.fitting !== "none" && <Num p={p} set={set} k="hole" label="Ring hole Ø (measure your holder)" min={20} max={60} step={0.1} />}
            <Choice label="Printer" value={p.printer} options={Object.keys(PRINTERS) as Params["printer"][]}
              onChange={(printer) => set({ printer })} />
          </TabsContent>
        </Tabs>

        <MyDesigns p={p} load={setP} />

        {stats.warnings.length > 0 && (
          <ul className="space-y-1 rounded-md bg-warning/10 p-3 text-sm">
            {stats.warnings.map((m) => <li key={m}>• {m}</li>)}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          PLA softens around 55 °C, so use LED bulbs only. Vase mode exports the shade and a glue-in ring as separate parts: spiralize only the shade (bottom layers 0), print the ring normally and glue it inside the fitting end.
        </p>

        <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t bg-background p-4">
          <Button className="flex-1" disabled={pending} onClick={export3mf}><IconDownload /> Export 3MF</Button>
          <Button variant="outline" disabled={pending} onClick={exportStl}>STL</Button>
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(location.href)}><IconLink /> Share</Button>
        </div>
      </aside>
    </div>
  )
}
