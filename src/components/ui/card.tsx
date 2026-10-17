import type { ReactNode } from "react"

// Plain panel section (the sidebars already provide the surface), styled like every other section
type P = { children?: ReactNode; className?: string }
export const Card = ({ children, className = "" }: P & { size?: string }) => <section className={className}>{children}</section>
// The surrounding Section supplies the title, so the card header only carries its controls
export const CardHeader = ({ children }: P) => <div className="mb-2">{children}</div>
export const CardTitle = (_: P) => null
export const CardAction = ({ children }: P) => <>{children}</>
export const CardContent = ({ children, className = "" }: P) => <div className={`space-y-2 ${className}`}>{children}</div>
