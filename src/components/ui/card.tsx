import { Card as HCard } from "@heroui/react"
import type { ReactNode } from "react"

type P = { children?: ReactNode; className?: string }
export const Card = ({ children, className }: P & { size?: string }) => <HCard className={className}>{children}</HCard>
export const CardHeader = ({ children }: P) => <HCard.Header className="flex-row items-center justify-between">{children}</HCard.Header>
export const CardTitle = ({ children }: P) => <HCard.Title>{children}</HCard.Title>
export const CardAction = ({ children }: P) => <div>{children}</div>
export const CardContent = ({ children, className }: P) => <HCard.Content className={className}>{children}</HCard.Content>
