import { Input as HInput } from "@heroui/react"
import type { ComponentProps } from "react"

export function Input({ size: _size, ...props }: Omit<ComponentProps<typeof HInput>, "size"> & { size?: string }) {
  return <HInput {...props} />
}
