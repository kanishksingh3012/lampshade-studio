import { useRef, useState } from "react"
import { tick } from "@/lib/sound"

// Shared "a bar is being scrubbed" flag: the app builds a light draft mesh until release
let scrubbing = false
const subs = new Set<() => void>()
const setScrub = (v: boolean) => { if (v !== scrubbing) { scrubbing = v; subs.forEach((f) => f()) } }
export const scrub = { get: () => scrubbing, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } } }

type Props = {
  label: string; value: number; min: number; max: number; step?: number; unit?: string
  onChange: (v: number) => void
}

// Full-width value bar: the fill shows the value, drag anywhere to scrub, click the number to type,
// arrow keys step (Shift = ×10). Each step change plays a knob tick.
export function Bar({ label, value, min, max, step = 1, unit, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const dp = (String(step).split(".")[1] ?? "").length
  const pct = ((value - min) / (max - min)) * 100
  const set = (v: number) => {
    if (!Number.isFinite(v)) return
    const c = +Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(dp)
    if (c !== value) { tick(); onChange(c) }
  }
  const fromX = (x: number) => {
    const b = ref.current!.getBoundingClientRect()
    return min + Math.min(1, Math.max(0, (x - b.left) / b.width)) * (max - min)
  }
  const commit = () => { if (draft !== null) set(parseFloat(draft)); setDraft(null) }
  return (
    <div ref={ref} role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      className="relative flex h-9 cursor-ew-resize touch-none select-none items-center overflow-hidden rounded-lg bg-default px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return
        e.currentTarget.setPointerCapture(e.pointerId)
        setScrub(true)
        set(fromX(e.clientX))
      }}
      onLostPointerCapture={() => setScrub(false)}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) set(fromX(e.clientX)) }}
      onKeyDown={(e) => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
        if (d && (e.target as HTMLElement).tagName !== "INPUT") { e.preventDefault(); set(value + d * step * (e.shiftKey ? 10 : 1)) }
      }}>
      <div className="absolute inset-y-0 left-0 bg-foreground/[0.09]" style={{ width: `${pct}%` }} />
      <span className="relative flex-1 truncate">{label}</span>
      <input inputMode="decimal" aria-label={`${label} value`} value={draft ?? value.toFixed(dp)}
        onFocus={(e) => { setDraft(e.currentTarget.value); e.currentTarget.select() }}
        onChange={(e) => setDraft(e.currentTarget.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); e.currentTarget.blur() } }}
        className="relative w-16 cursor-text bg-transparent text-right font-mono text-[13px] tabular-nums outline-none" />
      {unit && <span className="relative ml-1.5 w-5 text-xs text-muted-foreground">{unit}</span>}
    </div>
  )
}
