import { Button as HButton } from "@heroui/react"
import { click } from "@/lib/sound"
import type { ComponentProps, ReactNode } from "react"

const VARIANT = { default: "primary", secondary: "secondary", outline: "outline", ghost: "ghost" } as const
type Props = {
  variant?: keyof typeof VARIANT; size?: "xs" | "sm" | "default" | "icon-sm"
  onClick?: () => void; disabled?: boolean; children?: ReactNode; className?: string; title?: string
} & Omit<ComponentProps<typeof HButton>, "variant" | "size" | "onClick" | "children">

// HeroUI button behind the old shadcn-style API (variant/size/onClick/disabled)
export function Button({ variant = "default", size = "default", onClick, disabled, children, ...rest }: Props) {
  return (
    <HButton variant={VARIANT[variant]} size={size === "default" ? "md" : "sm"} isIconOnly={size === "icon-sm"} isDisabled={disabled}
      onPress={() => { click(); onClick?.() }} {...rest}>
      {children}
    </HButton>
  )
}
