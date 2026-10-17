import { Slider as HSlider } from "@heroui/react"
import { tick } from "@/lib/sound"

type Props = { value: number; min?: number; max?: number; step?: number; onValueChange: (v: number) => void; "aria-label"?: string; className?: string }
// Every step change plays a soft knob tick
export function Slider({ value, min = 0, max = 100, step = 1, onValueChange, className, ...rest }: Props) {
  return (
    <HSlider value={value} minValue={min} maxValue={max} step={step} className={className} aria-label={rest["aria-label"]}
      onChange={(v) => { tick(); onValueChange(Array.isArray(v) ? v[0] : v) }}>
      <HSlider.Track><HSlider.Fill /><HSlider.Thumb /></HSlider.Track>
    </HSlider>
  )
}
