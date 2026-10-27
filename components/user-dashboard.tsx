"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  FileWarning,
  Globe2,
  LoaderCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react"
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

type UrlCheckResult = {
  reputation: "malicious" | "suspicious" | "clean" | "unknown"
  scanStatus?: string
  analysisId?: string
  threatScore?: number | null
  stats?: {
    malicious: number
    suspicious: number
    harmless: number
    undetected: number
    total: number
  } | null
  threatDetails?: string[]
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

function isPrivateUrlHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".lan") ||
    host.endsWith(".test") ||
    (!host.includes(".") && !host.includes(":"))
  ) {
    return true
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some((octet) => octet > 255)) return true
    const [first, second] = octets
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    )
  }

  return host === "::1" || /^(fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab]/.test(host)
}

function ExtensionInstallNotice({ userId }: { userId: string }) {
  const [visible, setVisible] = useState(false)
  const storageKey = `aethelguard-extension-install-dismissed-${userId}`

  useEffect(() => {
    setVisible(window.localStorage.getItem(storageKey) !== "true")
  }, [storageKey])

  function dismiss() {
    window.localStorage.setItem(storageKey, "true")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <aside
      aria-label="Install the Aethelguard browser extension"
      className="fixed right-4 top-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-primary/30 bg-card p-4 text-card-foreground shadow-xl sm:right-6 sm:top-6"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Download className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Protect your Chrome downloads</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Install the Aethelguard extension to check URLs and scan completed downloads. Download and extract the
            extension ZIP, load its <span className="font-mono">chrome-extension</span> folder in Chrome, then run
            the included Windows helper installer for file scanning.
          </p>
          <a
            href="/api/extension/download"
            onClick={dismiss}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="size-3.5" />
            Download extension files
          </a>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Manual installation is required; the extension is not yet in the Chrome Web Store.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss extension installation notice"
          onClick={dismiss}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </aside>
  )
}

export function UserDashboard({ userId }: { userId: string }) {
  const { incidents, blockedCount, pendingCount, error } = useUserIncidents(userId)
  const recentIncidents = incidents.slice(0, 5)
  const [url, setUrl] = useState("")
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlResult, setUrlResult] = useState<UrlCheckResult | null>(null)
  const [urlBusy, setUrlBusy] = useState(false)

  async function checkUrl(analysisId?: string) {
    setUrlError(null)
    setUrlBusy(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw new Error(sessionError.message)
      if (!session?.access_token) throw new Error("Sign in again to check a URL.")

      let endpoint = "/api/extension/scan-url"
      const headers: Record<string, string> = {
        Authorization: `Bearer ${session.access_token}`,
      }
      const init: RequestInit = {
        method: "POST",
        headers,
        cache: "no-store",
      }

      if (analysisId) {
        const query = new URLSearchParams({ analysisId })
        endpoint += `?${query.toString()}`
        init.method = "GET"
      } else {
        let parsed: URL
        try {
          parsed = new URL(url.trim())
        } catch {
          throw new Error("Enter a complete URL, including https://.")
        }
        if (
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.username ||
          parsed.password ||
          isPrivateUrlHost(parsed.hostname)
        ) {
          throw new Error("Enter a valid public HTTP or HTTPS URL without embedded credentials.")
        }
        parsed.search = ""
        parsed.hash = ""
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify({ url: parsed.toString() })
      }

      const response = await fetch(endpoint, init)
      let result: UrlCheckResult & { error?: string; message?: string }
      try {
        result = await response.json()
      } catch {
        throw new Error("The URL reputation service returned an invalid response.")
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(result.error || `URL check failed (HTTP ${response.status}).`)
      }

      if (response.status === 202 || (result.scanStatus && result.scanStatus !== "completed")) {
        setUrlResult({
          reputation: "unknown",
          scanStatus: result.scanStatus || "queued",
          analysisId: result.analysisId || analysisId,
        })
      } else {
        setUrlResult(result)
      }
    } catch (cause) {
      setUrlError(cause instanceof Error ? cause.message : "Unable to check this URL.")
    } finally {
      setUrlBusy(false)
    }
  }

  function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setUrlResult(null)
    void checkUrl()
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ExtensionInstallNotice userId={userId} />
      <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card px-6 py-7 shadow-sm md:px-8 md:py-8">
        <div className="relative z-10">
          <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/70 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="size-3.5" />
            Personal security
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">My Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            See files quarantined by Aethelguard and track your requests to restore them.
          </p>
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {error && <ErrorNotice message={error} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Files Quarantined" value={String(blockedCount)} icon={FileWarning} tone="destructive" hint="All recorded quarantine incidents" />
        <StatCard label="Pending Requests" value={String(pendingCount)} icon={Clock3} tone="sky" hint="Awaiting administrator review" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
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

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Globe2 className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Check a URL</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Review a link’s reputation before you visit it.</p>
          </div>
        </div>
        <div className="p-5">
          <form onSubmit={submitUrl} className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="dashboard-url-check" className="sr-only">URL to check</label>
            <input
              id="dashboard-url-check"
              type="url"
              required
              maxLength={2048}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setUrlResult(null)
                setUrlError(null)
              }}
              placeholder="https://example.com"
              disabled={urlBusy}
              className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
            />
            <Button type="submit" disabled={urlBusy || !url.trim()} className="gap-2">
              {urlBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
              Check URL
            </Button>
          </form>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            URL query strings and fragments are removed before checking. If no report exists, the URL is sent to VirusTotal to request a scan. A clean result does not guarantee a site is safe.
          </p>

          {urlError && (
            <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {urlError}
            </p>
          )}

          {urlResult && (
            <div
              role="status"
              className={
                "mt-4 rounded-xl border p-4 " +
                (urlResult.reputation === "malicious"
                  ? "border-destructive/30 bg-destructive/5"
                  : urlResult.reputation === "suspicious"
                    ? "border-amber-500/30 bg-amber-500/5"
                    : urlResult.reputation === "clean"
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-muted/40")
              }
            >
              <div className="flex flex-wrap items-start gap-3">
                {urlResult.scanStatus && urlResult.scanStatus !== "completed" ? (
                  <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
                ) : urlResult.reputation === "malicious" || urlResult.reputation === "suspicious" ? (
                  <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
                ) : (
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold capitalize text-foreground">
                    {urlResult.scanStatus && urlResult.scanStatus !== "completed"
                      ? "Scan in progress"
                      : `${urlResult.reputation} reputation`}
                  </p>
                  {urlResult.scanStatus && urlResult.scanStatus !== "completed" ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      VirusTotal is processing this URL. Check again shortly for the result.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {urlResult.stats
                          ? `${urlResult.stats.malicious} malicious and ${urlResult.stats.suspicious} suspicious detections from ${urlResult.stats.total} engines.`
                          : "No completed reputation result is available for this URL."}
                        {urlResult.threatScore !== null && urlResult.threatScore !== undefined
                          ? ` Threat score: ${urlResult.threatScore}/100.`
                          : ""}
                      </p>
                      {urlResult.threatDetails && urlResult.threatDetails.length > 0 && (
                        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
                          {urlResult.threatDetails.map((detail, index) => <li key={`${index}-${detail}`}>{detail}</li>)}
                        </ul>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        Reputation checks are signals, not a guarantee that a site is safe or harmful.
                      </p>
                    </>
                  )}
                  {urlResult.scanStatus && urlResult.scanStatus !== "completed" && urlResult.analysisId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={urlBusy}
                      onClick={() => void checkUrl(urlResult.analysisId)}
                      className="mt-3 gap-2"
                    >
                      {urlBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                      Check scan status
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
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
