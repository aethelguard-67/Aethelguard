import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Tone = "primary" | "destructive" | "amber" | "sky"

const toneMap: Record<Tone, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "primary",
  hint,
}: {
  label: string
  value: string
  icon: LucideIcon
  tone?: Tone
  hint?: string
}) {
  return (
    <div className="group rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border", toneMap[tone])}>
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  )
}
