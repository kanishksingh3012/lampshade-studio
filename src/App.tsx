import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react"
import * as THREE from "three"
import { IconBulb, IconDownload, IconVolume, IconVolumeOff, IconLink, IconMoon, IconSun, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Switch } from "@/components/ui/switch"
import { DEFAULTS, HOLE, PRESETS, PRINTERS, radiusAt, addPoint, buildShade, movePoint, profileR, removePoint, volume, type Params } from "./geometry"
import { toGeometry } from "./perforate"
import { muted, setMuted } from "@/lib/sound"
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
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save() }}>
        <Input className="h-9 min-w-0 flex-1" placeholder="Name this design" value={name} onChange={(e) => setName(e.currentTarget.value)} />
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

function readHash(): Params {
  try { return { ...DEFAULTS, ...JSON.parse(atob(location.hash.slice(1))) } } catch { return DEFAULTS }
}

// Slider + exact numeric entry. `scale` shows radii as diameters.
// One control row: label, exact number, unit, then the slider. Same geometry everywhere.
function Num({ p, set, k, label, min, max, step = 1, unit = "mm", scale = 1 }:
  { p: Params; set: Set; k: NumKey; label: string; min: number; max: number; step?: number; unit?: string; scale?: number }) {
  const v = +(p[k] * scale).toFixed(2)
  const commit = (n: number) => Number.isFinite(n) && set({ [k]: Math.min(max, Math.max(min, n)) / scale })
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <Label className="flex-1 text-sm">{label}</Label>
        <Input type="number" aria-label={label} value={v} min={min} max={max} step={step}
          className="h-8 w-[76px] text-right text-sm tabular-nums" onChange={(e) => commit(e.currentTarget.valueAsNumber)} />
        <span className="w-6 text-xs text-muted-foreground">{unit}</span>
      </div>
      <Slider aria-label={label} value={v} min={min} max={max} step={step} onValueChange={(n) => commit(n as number)} />
    </div>
  )
}

function Choice<T extends string>({ label, value, options, onChange, labels, full = true }:
  { label?: string; value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>>; full?: boolean }) {
  return (
    <div className="space-y-2.5">
      {label && <Label className="text-sm">{label}</Label>}
      <ToggleGroup value={[value]} onValueChange={(v) => v[0] && onChange(v[0] as T)} className={full ? "w-full" : ""}>
        {options.map((o) => <ToggleGroupItem key={o} value={o} className={`capitalize ${full ? "flex-1" : ""}`}>{labels?.[o] ?? o}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
  )
}

// Hairline-separated panel section with a small uppercase title
function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 border-b px-5 py-5 last:border-b-0">
      {(title || action) && <div className="flex items-center justify-between">{title && <h2 className="section-title">{title}</h2>}{action}</div>}
      {children}
    </section>
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
  const stat = (ok: boolean) => <span className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-warning"}`} />
  return (
    // Desktop: shape tools left, model centre, surface/finish/print + export right (BottleLab-style).
    // Mobile: brand bar, model, then both panels stacked in one scroll.
    <div className="flex h-dvh flex-col overflow-y-auto bg-background text-foreground lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-6 rounded-md" />
            <div className="flex items-baseline gap-2">
              <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Lampshade Studio</h1>
              <a href="https://github.com/kanishksingh3012" target="_blank" rel="noreferrer"
                className="text-xs whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline">by Kanishk</a>
            </div>
            <div className="ml-auto flex items-center">
              <SoundToggle />
              <ThemeToggle dark={dark} setDark={setDark} />
            </div>
      </header>

      <main className="relative h-[60dvh] shrink-0 bg-background lg:order-2 lg:h-auto">
        <Viewer shot={shot} dark={dark} edit={edit} geo={shade} fitting={fitting} p={dp} view={view} bed={PRINTERS[p.printer]} />

        {/* Top toolbars: light + view modes centred, camera on the right */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-start p-4 sm:justify-center">
          <div className="pointer-events-auto flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-xl border bg-surface/95 p-1 shadow-sm backdrop-blur [scrollbar-width:none]">
            <Button size="sm" variant={lit ? "default" : "ghost"} aria-pressed={lit} onClick={() => setLit(!lit)}>
              <IconBulb /> Lit
            </Button>
            <span className="h-5 w-px bg-separator" />
            <Choice full={false} value={baseView} options={["studio", "overhangs", "zebra", "wire", "mesh"] as const} onChange={setView}
              labels={{ overhangs: "Print check", wire: "Wireframe" }} />
          </div>
        </div>
        {/* Camera presets: compact vertical rail on the right edge */}
        <div className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2">
          <div className="pointer-events-auto flex flex-col gap-1 rounded-xl border bg-surface/95 p-1 shadow-sm backdrop-blur" role="group" aria-label="Camera views">
            {(["front", "side", "top", "fit"] as const).map((k) => (
              <Button key={k} size="sm" variant="ghost" className="capitalize" onClick={() => setShot({ kind: k, n: Date.now() })}>{k}</Button>
            ))}
          </div>
        </div>

        {view === "overhangs" && (
          <div className="absolute right-4 bottom-16 w-60 space-y-2 rounded-xl border bg-surface/95 p-3.5 text-xs shadow-sm backdrop-blur">
            <p className="text-sm font-medium">Print check</p>
            <p className="leading-relaxed text-muted-foreground">Overhangs are walls that lean out with nothing below them. Past 45° the printer lays plastic on thin air and it sags.</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#e5484d]" /> Over 45°: likely to sag</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#f5a524]" /> 35–45°: borderline</p>
            <p className="flex items-center gap-2"><span className="size-2.5 rounded-full border bg-surface" /> Under 35°: prints fine</p>
          </div>
        )}

        {/* Bottom status bar: one pill, consistent separators */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border bg-surface/95 px-4 py-2 text-xs tabular-nums shadow-sm backdrop-blur">
            <span>Ø {Math.max(w, d).toFixed(1)} × {h.toFixed(1)} mm</span>
            <span className="h-3 w-px bg-separator" />
            <span>≈ {grams.toFixed(0)} g PLA</span>
            <span className="h-3 w-px bg-separator" />
            <span className="flex items-center gap-1.5">{stat(stats.maxOverhang <= 45)} Overhang {stats.maxOverhang.toFixed(0)}°</span>
            <span className="h-3 w-px bg-separator" />
            <span className="flex items-center gap-1.5">{stat(stats.fitsBed)} {stats.fitsBed ? "Fits" : "Too big for"} {p.printer}</span>
            {pending && <><span className="h-3 w-px bg-separator" /><span className="text-muted-foreground">Cutting holes…</span></>}
          </div>
        </div>
      </main>

      <aside className="flex flex-col border-t bg-background lg:order-1 lg:min-h-0 lg:border-t-0 lg:border-r">
        <div className="hidden h-14 shrink-0 items-center gap-2.5 border-b px-5 lg:flex">
            <img src="/favicon.svg" alt="" className="size-7 rounded-md" />
            <div className="flex items-baseline gap-2">
              <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Lampshade Studio</h1>
              <a href="https://github.com/kanishksingh3012" target="_blank" rel="noreferrer"
                className="text-xs whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline">by Kanishk</a>
            </div>
            <div className="ml-auto flex items-center">
              <SoundToggle />
              <ThemeToggle dark={dark} setDark={setDark} />
            </div>
        </div>
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <Section title="Start from">
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(PRESETS).map(([name, pr]) => (
                <button key={name} onClick={() => set(pr)} title={name} aria-label={name}
                  className="flex aspect-square items-center justify-center rounded-lg border bg-surface transition-colors hover:border-foreground/30 hover:bg-surface-secondary">
                  <PresetThumb preset={pr} />
                </button>
              ))}
            </div>
          </Section>
          <Section>
            <ProfileView p={p} set={set} onDragState={setDragging} />
          </Section>
          <Section title="Form">
            <Num p={p} set={set} k="height" label="Height" min={60} max={300} step={0.5} />
            <Num p={p} set={set} k="sides" label="Sides (0 = round)" min={0} max={12} unit="" />
            <p className="text-xs leading-relaxed text-muted-foreground">Drag the blue points on the model or in the profile to shape the silhouette. Double-click to add or remove a point.</p>
          </Section>
        </div>
      </aside>

      <aside className="flex flex-col border-t bg-background lg:order-3 lg:min-h-0 lg:border-t-0 lg:border-l">
        <Tabs defaultValue="surface" className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center border-b px-4">
            <TabsList>
              <TabsTrigger value="surface">Surface</TabsTrigger>
              <TabsTrigger value="finish">Finish</TabsTrigger>
              <TabsTrigger value="print">Print</TabsTrigger>
            </TabsList>
          </div>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {stats.warnings.length > 0 && (
              <div className="mx-5 mt-5 space-y-1 rounded-lg bg-warning/10 px-3.5 py-3 text-xs leading-relaxed">
                {stats.warnings.map((m) => <p key={m}>{m}</p>)}
              </div>
            )}

            <TabsContent value="surface">
              <Section title="Pattern">
                <Num p={p} set={set} k="twist" label="Twist" min={-360} max={360} step={5} unit="°" />
                <Num p={p} set={set} k="ripples" label="Ripples" min={0} max={60} unit="" />
                <Num p={p} set={set} k="rippleDepth" label="Ripple depth" min={0} max={15} step={0.1} />
                <Num p={p} set={set} k="waves" label="Vertical waves" min={0} max={10} unit="" />
                <Num p={p} set={set} k="waveDepth" label="Wave depth" min={0} max={15} step={0.1} />
              </Section>
              <Section title="Perforation">
                <Choice value={p.perfShape} options={["none", "circle", "slot", "diamond"] as const} onChange={(perfShape) => set({ perfShape })} />
                {p.perfShape !== "none" && <>
                  {p.mode === "vase" && <p className="text-xs text-muted-foreground">Holes need solid mode (Print tab). Vase mode can't print them.</p>}
                  <Num p={p} set={set} k="perfCols" label="Holes around" min={3} max={60} unit="" />
                  <Num p={p} set={set} k="perfRows" label="Rows" min={1} max={30} unit="" />
                  <Num p={p} set={set} k="perfSize" label="Hole height" min={2} max={40} step={0.5} />
                  <Num p={p} set={set} k="perfStart" label="Band start" min={0} max={100} step={1} unit="%" scale={100} />
                  <Num p={p} set={set} k="perfEnd" label="Band end" min={0} max={100} step={1} unit="%" scale={100} />
                  <div className="flex items-center justify-between text-sm">
                    Stagger rows
                    <Switch checked={p.perfStagger} onCheckedChange={(v) => set({ perfStagger: v })} />
                  </div>
                </>}
              </Section>
            </TabsContent>

            <TabsContent value="finish">
              <Section title="Filament">
                <div className="flex flex-wrap items-center gap-2.5">
                  {Object.entries(COLORS).map(([name, c]) => (
                    <button key={c} aria-label={name} title={name} onClick={() => set({ color: c })} style={{ background: c }}
                      className={`size-7 rounded-full border transition-shadow ${p.color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`} />
                  ))}
                  <input type="color" aria-label="Custom colour" value={p.color} onChange={(e) => set({ color: e.target.value })}
                    className="size-7 cursor-pointer rounded-full border bg-transparent" />
                </div>
                <Choice label="Finish" value={p.finish} options={["matte", "silk", "glossy"] as const} onChange={(finish) => set({ finish })} />
              </Section>
              <Section title="Bulb">
                <Num p={p} set={set} k="lumens" label="Brightness" min={200} max={1600} step={50} unit="lm" />
                <Num p={p} set={set} k="kelvin" label="Colour temperature" min={2200} max={6500} step={100} unit="K" />
                <p className="text-xs leading-relaxed text-muted-foreground">Turn on Lit above the model to see filament, wall and bulb glow together.</p>
              </Section>
            </TabsContent>

            <TabsContent value="print">
              <Section title="Print">
                <Choice label="Mode" value={p.mode} options={["solid", "vase"] as const} onChange={(mode) => set({ mode })} />
                <Num p={p} set={set} k="thickness" label={p.mode === "vase" ? "Line width" : "Wall thickness"} min={0.4} max={3} step={0.05} />
                <div className="space-y-2.5">
                  <Label className="text-sm">Printer</Label>
                  <select value={p.printer} onChange={(e) => set({ printer: e.target.value as Params["printer"] })} aria-label="Printer"
                    className="h-9 w-full rounded-xl bg-field px-3 text-sm text-field-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus">
                    {Object.keys(PRINTERS).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </Section>
              <Section title="Bulb fitting">
                <Choice value={p.fitting} options={["E27", "E14", "none"] as const}
                  onChange={(fitting) => set(fitting === "none" ? { fitting } : { fitting, hole: HOLE[fitting] })} />
                {p.fitting !== "none" && <Num p={p} set={set} k="hole" label="Ring hole Ø" min={20} max={60} step={0.1} />}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {vase ? "Vase mode exports a separate glue-in ring. Spiralize only the shade (bottom layers 0)." : "The ring prints on the bed, fused to the wall."} Measure your holder's collar. PLA softens near 55 °C, so use LED bulbs only.
                </p>
              </Section>
            </TabsContent>

            <Section title="My designs">
              <MyDesigns p={p} load={setP} />
            </Section>
          </div>
        </Tabs>

        <div className="sticky bottom-0 flex shrink-0 gap-2 border-t bg-background px-5 py-4">
          <Button className="flex-1" disabled={pending} onClick={export3mf}><IconDownload /> Export 3MF</Button>
          <Button variant="outline" disabled={pending} onClick={exportStl}>STL</Button>
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(location.href)}><IconLink /> Share</Button>
        </div>
      </aside>
    </div>
  )
}
