"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Activity, BellRing, LockKeyhole, ShieldCheck, Users } from "lucide-react"
import { UserDashboard } from "@/components/user-dashboard"
import { AdminGate } from "@/components/admin-gate"
import { StatCard } from "@/components/stat-card"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

type RequestAlert = {
  id: string
  user_id: string
  incident_id: string
  reason: string
  requested_at: string
  user_email?: string
  file_name?: string
}

type QuarantineActivityDay = { date: string; count: number }

function QuarantineActivityChart({ days }: { days: QuarantineActivityDay[] }) {
  const chartWidth = 760
  const chartHeight = 220
  const plotLeft = 42
  const plotTop = 20
  const plotWidth = 700
  const plotHeight = 145
  const maxCount = Math.max(1, ...days.map((day) => day.count))
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const step = plotWidth / days.length
  const barWidth = Math.min(14, step * 0.7)
  const tickValues = [0, Math.ceil(maxCount / 2), maxCount].filter((value, index, values) => values.indexOf(value) === index)
  const labelIndexes = [0, 5, 10, 15, 20, 25, 29]

  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Quarantine Activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">Files quarantined per day over the last 30 days</p>
        </div>
        <p className="text-sm font-medium text-foreground">
          <span className="font-mono text-lg tabular-nums">{total}</span>{" "}
          <span className="text-muted-foreground">files quarantined</span>
        </p>
      </div>
      <div className="px-3 py-4 sm:px-5">
        {total === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No quarantined files recorded in the last 30 days.
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={`Quarantine activity in the last 30 days: ${total} files across ${days.filter((day) => day.count > 0).length} days.`}
            className="h-auto w-full overflow-visible"
          >
            {tickValues.map((value) => {
              const y = plotTop + plotHeight - (value / maxCount) * plotHeight
              return (
                <g key={value}>
                  <line
                    x1={plotLeft}
                    y1={y}
                    x2={plotLeft + plotWidth}
                    y2={y}
                    className="stroke-border"
                    strokeDasharray="3 4"
                  />
                  <text x={plotLeft - 9} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
                    {value}
                  </text>
                </g>
              )
            })}
            {days.map((day, index) => {
              const height = (day.count / maxCount) * plotHeight
              const x = plotLeft + index * step + (step - barWidth) / 2
              const labelDate = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
              return (
                <g key={day.date}>
                  <rect
                    x={x}
                    y={plotTop + plotHeight - height}
                    width={barWidth}
                    height={height}
                    rx="3"
                    className="fill-primary"
                  >
                    <title>{`${labelDate}: ${day.count} ${day.count === 1 ? "file" : "files"} quarantined`}</title>
                  </rect>
                  {labelIndexes.includes(index) && (
                    <text
                      x={x + barWidth / 2}
                      y={plotTop + plotHeight + 20}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {labelDate}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Each bar shows the number of quarantine incidents recorded on that date.
        </p>
      </div>
    </section>
  )
}

function DashboardOverview() {
  const [quarantinedCount, setQuarantinedCount] = useState<string>("—")
  const [activeUsersCount, setActiveUsersCount] = useState<string>("—")
  const [quarantineActivity, setQuarantineActivity] = useState<QuarantineActivityDay[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [alerts, setAlerts] = useState<RequestAlert[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    const supabase = createSupabaseBrowserClient()
    const activeSince = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
    const activityDays = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(todayUtc - (29 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      return { date, count: 0 }
    })
    const [files, users, requests, incidents] = await Promise.all([
      supabase.from("block_incidents").select("id", { count: "exact", head: true }).eq("status", "blocked"),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "user")
        .eq("extension_active", true)
        .gt("last_seen_at", activeSince),
      supabase
        .from("unquarantine_requests")
        .select("id, user_id, incident_id, reason, requested_at", { count: "exact" })
        .eq("status", "pending")
        .order("requested_at", { ascending: false })
        .limit(5),
      supabase
        .from("block_incidents")
        .select("blocked_at")
        .gte("blocked_at", `${activityDays[0].date}T00:00:00.000Z`)
        .order("blocked_at", { ascending: true }),
    ])

    const failed = [files.error, users.error, requests.error, incidents.error].find(Boolean)
    if (failed) {
      setError(failed.message)
      return
    }

    const countsByDate = new Map(activityDays.map((day) => [day.date, 0]))
    for (const incident of incidents.data ?? []) {
      const date = new Date(incident.blocked_at).toISOString().slice(0, 10)
      const count = countsByDate.get(date)
      if (count !== undefined) countsByDate.set(date, count + 1)
    }
    setQuarantineActivity(activityDays.map((day) => ({ ...day, count: countsByDate.get(day.date) ?? 0 })))

    const pendingRequests = requests.data ?? []
    let enrichedRequests: RequestAlert[] = pendingRequests
    if (pendingRequests.length > 0) {
      const userIds = [...new Set(pendingRequests.map((request) => request.user_id))]
      const incidentIds = [...new Set(pendingRequests.map((request) => request.incident_id))]
      const [profiles, incidents] = await Promise.all([
        supabase.from("profiles").select("id, email").in("id", userIds),
        supabase.from("block_incidents").select("id, file_name").in("id", incidentIds),
      ])
      const lookupError = profiles.error ?? incidents.error
      if (lookupError) {
        setError(lookupError.message)
        return
      }
      const emails = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.email]))
      const names = new Map((incidents.data ?? []).map((incident) => [incident.id, incident.file_name]))
      enrichedRequests = pendingRequests.map((request) => ({
        ...request,
        user_email: emails.get(request.user_id),
        file_name: names.get(request.incident_id),
      }))
    }

    setError(null)
    setQuarantinedCount(String(files.count ?? 0))
    setActiveUsersCount(String(users.count ?? 0))
    setPendingCount(requests.count ?? 0)
    setAlerts(enrichedRequests)
  }, [])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    void loadDashboard()

    const channel = supabase
      .channel("dashboard-admin-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "unquarantine_requests" }, () => {
        void loadDashboard()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "block_incidents" }, () => {
        void loadDashboard()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void loadDashboard()
      })
      .subscribe((status, subscriptionError) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(
            `Realtime updates are unavailable: ${subscriptionError?.message ?? status}. Check the Supabase Realtime publication.`,
          )
        }
      })

    const timer = window.setInterval(() => void loadDashboard(), 60_000)
    return () => {
      window.clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [loadDashboard])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card px-6 py-7 shadow-sm md:px-8 md:py-8">
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/70 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="size-3.5" />
              Security overview
            </span>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">Main Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              A clear view of quarantined files, active protection, and incoming user requests.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/70 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_10px] shadow-primary/50" />
            Live monitoring
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load dashboard data: {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Currently Quarantined Files"
          value={quarantinedCount}
          icon={LockKeyhole}
          tone="amber"
          hint="Files currently in quarantine"
        />
        <StatCard
          label="Active Extension Users"
          value={activeUsersCount}
          icon={Users}
          tone="primary"
          hint="Active in the last 5 minutes"
        />
      </div>

      <QuarantineActivityChart days={quarantineActivity} />

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <BellRing className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Unquarantine Request Alerts</h2>
          <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {pendingCount} pending
          </span>
        </div>
        {alerts.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No pending user requests.</p>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Activity className="size-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-foreground">
                    {alert.file_name ?? `Incident ${alert.incident_id}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {alert.user_email ?? alert.user_id} · {new Date(alert.requested_at).toLocaleString()}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{alert.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border px-5 py-3">
          <Link href="/requests" className="text-sm font-medium text-primary hover:underline">
            Review requests
          </Link>
        </div>
      </section>
    </div>
  )
}

function DashboardEntry() {
  const [identity, setIdentity] = useState<{ userId: string; isAdmin: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured. Set the public Supabase URL and anon key to continue.")
      return
    }
    const supabase = createSupabaseBrowserClient()

    async function loadIdentity() {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) {
        if (active) setError(authError.message)
        return
      }
      if (!authData.user) {
        window.location.replace("/login")
        return
      }

      const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin")
      if (adminError) {
        if (active) setError(adminError.message)
        return
      }
      if (active) setIdentity({ userId: authData.user.id, isAdmin: Boolean(isAdmin) })
    }

    void loadIdentity()
    return () => {
      active = false
    }
  }, [])

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Unable to verify dashboard access: {error}
      </p>
    )
  }
  if (!identity) return <p className="text-sm text-muted-foreground">Verifying account access…</p>
  if (!identity.isAdmin) return <UserDashboard userId={identity.userId} />

  return (
    <AdminGate>
      <DashboardOverview />
    </AdminGate>
  )
}

export default function OverviewPage() {
  return <DashboardEntry />
}
