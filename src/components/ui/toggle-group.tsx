import { ToggleButton, ToggleButtonGroup } from "@heroui/react"
import { click } from "@/lib/sound"
import type { ReactNode } from "react"

type P = { children?: ReactNode; className?: string }
// Single-select segmented control; value/onValueChange keep the old string[] API
export function ToggleGroup({ value, onValueChange, size, className, children }:
  P & { value: string[]; onValueChange: (v: string[]) => void; size?: "sm"; variant?: string }) {
  return (
    <ToggleButtonGroup selectionMode="single" disallowEmptySelection selectedKeys={new Set(value)} size={size ?? "sm"} className={className}
      onSelectionChange={(keys) => { click(); onValueChange([...keys].map(String)) }}>
      {children}
    </ToggleButtonGroup>
  )
}
export const ToggleGroupItem = ({ value, children, className }: P & { value: string }) =>
  <ToggleButton id={value} className={className}>{children}</ToggleButton>
