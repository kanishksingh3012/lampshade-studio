import { click } from "@/lib/sound"
import type { ReactNode } from "react"

// Segmented row: optional label inside the track, options share the remaining width.
// `bare` drops the track (for use inside an existing toolbar pill).
export function ToggleGroup<T extends string>({ label, value, options, labels, onChange, bare = false }:
  { label?: string; value: T; options: readonly T[]; labels?: Partial<Record<T, ReactNode>>; onChange: (v: T) => void; bare?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label}
      className={`flex items-center gap-0.5 text-sm ${bare ? "" : "h-9 rounded-lg bg-default p-1"}`}>
      {label && <span className="shrink-0 pr-2 pl-2 whitespace-nowrap">{label}</span>}
      <div className={`flex items-center gap-0.5 ${bare ? "" : "min-w-0 flex-1"}`}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => { if (o !== value) { click(); onChange(o) } }}
            className={`h-7 rounded-md whitespace-nowrap capitalize transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus ${bare ? "px-2.5" : "min-w-0 flex-1 truncate px-1"} ${o === value ? "bg-segment font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {labels?.[o] ?? o}
          </button>
        ))}
      </div>
    </div>
  )
}
