import { Tabs as HTabs } from "@heroui/react"
import { click } from "@/lib/sound"
import type { ReactNode } from "react"

type P = { children?: ReactNode; className?: string }
export const Tabs = ({ defaultValue, children }: P & { defaultValue: string }) =>
  <HTabs defaultSelectedKey={defaultValue} onSelectionChange={click}>{children}</HTabs>
export const TabsList = ({ children }: P) =>
  <HTabs.ListContainer><HTabs.List aria-label="Settings">{children}</HTabs.List></HTabs.ListContainer>
export const TabsTrigger = ({ value, children }: P & { value: string }) =>
  <HTabs.Tab id={value}>{children}<HTabs.Indicator /></HTabs.Tab>
export const TabsContent = ({ value, children, className }: P & { value: string }) =>
  <HTabs.Panel id={value} className={className}>{children}</HTabs.Panel>
