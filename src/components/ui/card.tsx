import type { ReactNode } from "react"

// Plain panel section (the sidebars already provide the surface), styled like every other section
type P = { children?: ReactNode; className?: string }
export const Card = ({ children, className = "" }: P & { size?: string }) => <section className={className}>{children}</section>
export const CardHeader = ({ children }: P) => <div className="mb-3 flex items-center justify-between">{children}</div>
export const CardTitle = ({ children }: P) => <h2 className="section-title">{children}</h2>
export const CardAction = ({ children }: P) => <div>{children}</div>
export const CardContent = ({ children, className = "" }: P) => <div className={`space-y-4 ${className}`}>{children}</div>
