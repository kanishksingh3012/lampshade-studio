import { Switch as HSwitch } from "@heroui/react"
import { click } from "@/lib/sound"

export function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <HSwitch isSelected={checked} onChange={(v) => { click(); onCheckedChange(v) }} aria-label="Toggle">
      <HSwitch.Control><HSwitch.Thumb /></HSwitch.Control>
    </HSwitch>
  )
}
