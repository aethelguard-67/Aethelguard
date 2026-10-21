"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Activity, BellRing, LockKeyhole, Users } from "lucide-react"
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

function DashboardOverview() {
  const [quarantinedCount, setQuarantinedCount] = useState<string>("—")
  const [activeUsersCount, setActiveUsersCount] = useState<string>("—")
  const [pendingCount, setPendingCount] = useState(0)
  const [alerts, setAlerts] = useState<RequestAlert[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    const supabase = createSupabaseBrowserClient()
    const activeSince = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const [files, users, requests] = await Promise.all([
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
    ])

    const failed = [files.error, users.error, requests.error].find(Boolean)
    if (failed) {
      setError(failed.message)
      return
    }

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Main Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current quarantine totals, active extension users, and incoming user requests.
        </p>
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

      <section className="rounded-xl border border-border bg-card">
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
