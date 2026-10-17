import { Chip } from "@heroui/react"
import type { ReactNode } from "react"

const COLOR = { default: "default", success: "success", warning: "warning", destructive: "danger", info: "accent" } as const
export function Badge({ variant = "default", children }: { variant?: keyof typeof COLOR; children: ReactNode }) {
  return <Chip size="sm" variant="soft" color={COLOR[variant]}>{children}</Chip>
}
