"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, FileWarning, LoaderCircle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/stat-card"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type Incident = {
  id: string
  file_name: string
  malicious_engines: number
  total_engines: number
  threat_score: number | null
  threat_details: string[]
  status: "blocked" | "released"
  blocked_at: string
}

type UserRequest = {
  incident_id: string
  status: "pending" | "approved" | "rejected"
  requested_at: string
}

function useUserIncidents(userId: string) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [requests, setRequests] = useState<Map<string, UserRequest>>(new Map())
  const [blockedCount, setBlockedCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient()
    const [incidentResult, pendingResult] = await Promise.all([
      supabase
        .from("block_incidents")
        .select("id, file_name, malicious_engines, total_engines, threat_score, threat_details, status, blocked_at", {
          count: "exact",
        })
        .eq("user_id", userId)
        .order("blocked_at", { ascending: false })
        .limit(100),
      supabase.from("unquarantine_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
    ])
    const failed = [incidentResult.error, pendingResult.error].find(Boolean)
    if (failed) {
      setError(failed.message)
      return
    }

    const loadedIncidents = incidentResult.data ?? []
    const latestRequests = new Map<string, UserRequest>()
    if (loadedIncidents.length > 0) {
      const { data: requestData, error: requestError } = await supabase
        .from("unquarantine_requests")
        .select("incident_id, status, requested_at")
        .in("incident_id", loadedIncidents.map((incident) => incident.id))
        .order("requested_at", { ascending: false })
      if (requestError) {
        setError(requestError.message)
        return
      }
      for (const request of requestData ?? []) {
        if (!latestRequests.has(request.incident_id)) latestRequests.set(request.incident_id, request)
      }
    }
    setIncidents(loadedIncidents)
    setRequests(latestRequests)
    setBlockedCount(incidentResult.count ?? 0)
    setPendingCount(pendingResult.count ?? 0)
    setError(null)
  }, [userId])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    void load()
    const channel = supabase
      .channel(`user-quarantine-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "block_incidents", filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "unquarantine_requests", filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      .subscribe((status, subscriptionError) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(`Live quarantine updates are unavailable: ${subscriptionError?.message ?? status}.`)
        }
      })
    const timer = window.setInterval(() => void load(), 60_000)

    return () => {
      window.clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [load, userId])

  return { incidents, requests, blockedCount, pendingCount, error, setError, reload: load }
}

function incidentReason(incident: Incident) {
  if (incident.threat_details.length > 0) return incident.threat_details
  return [`${incident.malicious_engines} of ${incident.total_engines} security engines detected malicious content.`]
}

export function UserDashboard({ userId }: { userId: string }) {
  const { incidents, blockedCount, pendingCount, error } = useUserIncidents(userId)
  const recentIncidents = incidents.slice(0, 5)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See files quarantined by Aethelguard and track your requests to restore them.
        </p>
      </div>

      {error && <ErrorNotice message={error} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Files Quarantined" value={String(blockedCount)} icon={FileWarning} tone="destructive" hint="All recorded quarantine incidents" />
        <StatCard label="Pending Requests" value={String(pendingCount)} icon={Clock3} tone="sky" hint="Awaiting administrator review" />
      </div>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <CalendarClock className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Recently Quarantined Files</h2>
          <Link href="/quarantine" className="ml-auto text-sm font-medium text-primary hover:underline">
            View quarantine
          </Link>
        </div>
        {recentIncidents.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No quarantined files have been recorded.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recentIncidents.map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-foreground">{incident.file_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(incident.blocked_at).toLocaleString()}
                    {" · "}
                    {incident.threat_score === null ? "Risk score unavailable" : `Risk score ${incident.threat_score}/100`}
                  </p>
                </div>
                <span className="rounded-full border border-border px-2.5 py-1 text-xs capitalize text-muted-foreground">
                  {incident.status === "blocked" ? "quarantined" : "released"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        Files detected as malicious are quarantined automatically. Only an administrator can approve a release request.
      </p>
    </div>
  )
}

export function UserQuarantine({ userId }: { userId: string }) {
  const { incidents, requests, error, setError, reload } = useUserIncidents(userId)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const sortedIncidents = incidents

  async function requestRelease(incidentId: string) {
    const reason = reasons[incidentId]?.trim() ?? ""
    if (!reason) {
      setError("Please explain why this file should be reviewed before submitting a request.")
      return
    }

    setBusyId(incidentId)
    setError(null)
    const { error: requestError } = await createSupabaseBrowserClient()
      .from("unquarantine_requests")
      .insert({ user_id: userId, incident_id: incidentId, reason })
    if (requestError) {
      setError(requestError.message)
    } else {
      setReasons((current) => ({ ...current, [incidentId]: "" }))
      await reload()
    }
    setBusyId(null)
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Quarantine</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review why files were quarantined. Submit a request if you need an administrator to approve a release.
        </p>
      </div>

      {error && <ErrorNotice message={error} />}

      {sortedIncidents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <CheckCircle2 className="mx-auto size-8 text-primary" />
          <p className="mt-3 text-sm font-medium text-foreground">No quarantined files</p>
          <p className="mt-1 text-xs text-muted-foreground">Files quarantined by the extension will appear here.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {sortedIncidents.map((incident) => {
            const request = requests.get(incident.id)
            const blocked = incident.status === "blocked"
            return (
              <li key={incident.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-medium text-foreground">{incident.file_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Blocked {new Date(incident.blocked_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={
                      "rounded-full border px-2.5 py-1 text-xs font-medium " +
                      (blocked
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                        : "border-primary/30 bg-primary/10 text-primary")
                    }
                  >
                    {blocked ? "Quarantined" : "Released by administrator"}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                  <ShieldAlert className="size-4 shrink-0 text-destructive" />
                  <p className="text-sm font-medium text-foreground">
                    Risk score: {incident.threat_score === null ? "Not available" : `${incident.threat_score}/100`}
                  </p>
                  {incident.threat_score !== null && incident.threat_score >= 70 && (
                    <span className="text-xs font-medium text-destructive">High risk</span>
                  )}
                </div>
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why it was blocked</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {incidentReason(incident).map((detail, index) => <li key={`${incident.id}-${index}`}>{detail}</li>)}
                  </ul>
                </div>

                {blocked && (
                  <div className="mt-5 border-t border-border pt-4">
                    {request?.status === "pending" ? (
                      <p className="flex items-center gap-2 text-sm text-amber-400">
                          <Clock3 className="size-4" /> Quarantine release request submitted {new Date(request.requested_at).toLocaleString()} — waiting for administrator review.
                      </p>
                    ) : (
                      <>
                        {request && (
                          <p className="mb-3 text-xs text-muted-foreground">
                            Your previous request was {request.status}. You may submit a new request for review.
                          </p>
                        )}
                        <label htmlFor={`request-reason-${incident.id}`} className="mb-2 block text-sm font-medium text-foreground">
                          Request administrator review
                        </label>
                        <textarea
                          id={`request-reason-${incident.id}`}
                          value={reasons[incident.id] ?? ""}
                          onChange={(event) => setReasons((current) => ({ ...current, [incident.id]: event.target.value }))}
                          maxLength={2000}
                          rows={3}
                          placeholder="Explain why you believe this file should be released."
                          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <div className="mt-3 flex justify-end">
                          <Button
                            size="sm"
                            disabled={busyId === incident.id}
                            onClick={() => void requestRelease(incident.id)}
                            className="gap-2"
                          >
                            {busyId === incident.id && <LoaderCircle className="size-4 animate-spin" />}
                            Request release
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {incidents.length >= 100 && (
        <p className="text-center text-xs text-muted-foreground">Showing the 100 most recent incidents.</p>
      )}
    </div>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      Quarantine update failed: {message}
    </p>
  )
}
