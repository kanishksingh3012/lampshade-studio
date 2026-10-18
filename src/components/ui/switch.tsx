import { click } from "@/lib/sound"

// Plain accessible switch (the HeroUI one rendered without its input here, so clicks never toggled it)
export function Switch({ checked, onCheckedChange, label = "Toggle" }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => { click(); onCheckedChange(!checked) }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus ${checked ? "bg-foreground" : "bg-foreground/20"}`}>
      <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform ${checked ? "translate-x-4" : ""}`} />
    </button>
  )
}
