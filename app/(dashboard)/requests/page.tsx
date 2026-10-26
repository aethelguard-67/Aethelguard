"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Clock3, Download, RefreshCw, X } from "lucide-react"
import { jsPDF } from "jspdf"
import { AdminGate } from "@/components/admin-gate"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type RequestRow = {
  id: string
  user_id: string
  incident_id: string
  reason: string
  status: "pending" | "approved" | "rejected"
  requested_at: string
  reviewed_at: string | null
}

type ProfileRow = { id: string; email: string; display_name: string }
type IncidentRow = { id: string; file_name: string; sha256: string; blocked_at: string }

function downloadRequestReport(request: RequestRow, profile?: ProfileRow, incident?: IncidentRow) {
  const pdf = new jsPDF()
  const margin = 18
  const lineHeight = 7
  const pageBottom = 280
  const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2
  let y = 22

  function addText(value: string, options?: { bold?: boolean; gap?: number }) {
    pdf.setFont("helvetica", options?.bold ? "bold" : "normal")
    const lines = pdf.splitTextToSize(value, contentWidth) as string[]
    for (const line of lines) {
      if (y > pageBottom) {
        pdf.addPage()
        y = 20
      }
      pdf.text(line, margin, y)
      y += lineHeight
    }
    y += options?.gap ?? 2
  }

  pdf.setFontSize(18)
  addText("Aethelguard User Issue Report", { bold: true, gap: 5 })
  pdf.setFontSize(11)
  addText(`Report generated: ${new Date().toLocaleString()}`)
  addText(`Request ID: ${request.id}`)
  addText(`Status: ${request.status}`)
  addText(`User: ${profile?.display_name || profile?.email || request.user_id}`)
  if (profile?.display_name && profile.email) addText(`Email: ${profile.email}`)
  addText(`Submitted: ${new Date(request.requested_at).toLocaleString()}`)
  if (request.reviewed_at) addText(`Reviewed: ${new Date(request.reviewed_at).toLocaleString()}`)
  addText(`Affected file: ${incident?.file_name ?? "File name unavailable"}`)
  addText(`SHA-256: ${incident?.sha256 ?? "Unavailable"}`)
  addText(`Incident ID: ${request.incident_id}`)
  if (incident?.blocked_at) addText(`Blocked: ${new Date(incident.blocked_at).toLocaleString()}`)
  addText("Issue description submitted by user:", { bold: true, gap: 0 })
  addText(request.reason)

  pdf.save(`aethelguard-issue-report-${request.id.slice(0, 8)}.pdf`)
}

function RequestsContent() {
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [profiles, setProfiles] = useState<Map<string, ProfileRow>>(new Map())
  const [incidents, setIncidents] = useState<Map<string, IncidentRow>>(new Map())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadRequests = useCallback(async () => {
    const supabase = createSupabaseBrowserClient()
    const [requestResult, profileResult, incidentResult] = await Promise.all([
      supabase
        .from("unquarantine_requests")
        .select("id, user_id, incident_id, reason, status, requested_at, reviewed_at")
        .order("requested_at", { ascending: false }),
      supabase.from("profiles").select("id, email, display_name"),
      supabase.from("block_incidents").select("id, file_name, sha256, blocked_at"),
    ])

    const failed = [requestResult.error, profileResult.error, incidentResult.error].find(Boolean)
    if (failed) {
      setError(failed.message)
      return
    }

    setError(null)
    setRequests(requestResult.data ?? [])
    setProfiles(new Map((profileResult.data ?? []).map((profile) => [profile.id, profile])))
    setIncidents(new Map((incidentResult.data ?? []).map((incident) => [incident.id, incident])))
  }, [])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    void loadRequests()
    const channel = supabase
      .channel("admin-unquarantine-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "unquarantine_requests" }, () => {
        void loadRequests()
      })
      .subscribe((status, subscriptionError) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(
            `Realtime request alerts are unavailable: ${subscriptionError?.message ?? status}. Check the Supabase Realtime publication.`,
          )
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadRequests])

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusyId(id)
    setError(null)
    const { error: reviewError } = await createSupabaseBrowserClient().rpc("review_unquarantine_request", {
      request_id: id,
      decision,
    })
    if (reviewError) {
      setError(reviewError.message)
    } else {
      await loadRequests()
    }
    setBusyId(null)
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Unquarantine Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review requests submitted by extension users. Approvals notify the extension to release the blocked file.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Request operation failed: {error}
        </p>
      )}

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <Clock3 className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">No unquarantine requests</p>
          <p className="mt-1 text-xs text-muted-foreground">New requests will appear here as users submit them.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {requests.map((request) => {
            const profile = profiles.get(request.user_id)
            const incident = incidents.get(request.incident_id)
            const pending = request.status === "pending"
            return (
              <li key={request.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium text-foreground">
                      {incident?.file_name ?? "File name unavailable"}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      SHA-256: {incident?.sha256 ?? request.incident_id}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {profile?.display_name || profile?.email || request.user_id}
                      {" · Requested "}
                      {new Date(request.requested_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={
                      "rounded-full border px-2.5 py-1 text-xs font-medium " +
                      (request.status === "approved"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : request.status === "rejected"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-400")
                    }
                  >
                    {request.status}
                  </span>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{request.reason}</p>
                {incident && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Blocked {new Date(incident.blocked_at).toLocaleString()}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadRequestReport(request, profile, incident)}
                    className="gap-2"
                  >
                    <Download className="size-4" />
                    Download PDF report
                  </Button>
                  {pending && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => void decide(request.id, "rejected")}
                        className="gap-2"
                      >
                        {busyId === request.id ? (
                          <RefreshCw className="size-4 animate-spin" />
                        ) : (
                          <X className="size-4" />
                        )}
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => void decide(request.id, "approved")}
                        className="gap-2"
                      >
                        {busyId === request.id ? (
                          <RefreshCw className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                        Approve & release
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function RequestsPage() {
  return (
    <AdminGate>
      <RequestsContent />
    </AdminGate>
  )
}
