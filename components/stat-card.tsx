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
  compact = false,
}: {
  label: string
  value: string
  icon: LucideIcon
  tone?: Tone
  hint?: string
  compact?: boolean
}) {
  return (
    <div className={`group rounded-2xl border border-border/80 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md ${compact ? "p-3" : "p-5"}`}>
      <div className={`flex justify-between gap-3 ${compact ? "items-center" : "items-start"}`}>
        <div className="min-w-0">
          <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>{label}</p>
          <p className={`font-mono font-semibold tabular-nums tracking-tight text-foreground ${compact ? "mt-0.5 text-2xl" : "mt-2 text-3xl"}`}>{value}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg border", compact ? "size-8" : "size-10", toneMap[tone])}>
          <Icon className={compact ? "size-4" : "size-5"} />
        </span>
      </div>
    </div>
  )
}
