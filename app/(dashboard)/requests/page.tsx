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
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 17
  const contentWidth = pageWidth - margin * 2
  const pageBottom = pageHeight - 22
  const lineHeight = 5
  const colors = {
    ink: [25, 39, 61] as const,
    muted: [103, 117, 137] as const,
    accent: [18, 139, 137] as const,
    pale: [241, 247, 248] as const,
    border: [222, 230, 235] as const,
    white: [255, 255, 255] as const,
  }
  let y = 0

  function addPageHeader(isCover = false) {
    if (isCover) {
      pdf.setFillColor(...colors.ink)
      pdf.rect(0, 0, pageWidth, 53, "F")
      pdf.setFillColor(...colors.accent)
      pdf.rect(0, 53, pageWidth, 2, "F")
      pdf.setTextColor(...colors.white)
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(10)
      pdf.text("AETHELGUARD", margin, 15)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(8)
      pdf.setTextColor(190, 207, 220)
      pdf.text("SECURITY OPERATIONS  /  USER ISSUE", margin, 22)
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(19)
      pdf.setTextColor(...colors.white)
      pdf.text("Incident report", margin, 36)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(8)
      pdf.setTextColor(190, 207, 220)
      pdf.text(`Generated ${new Date().toLocaleString()}`, margin, 45)

      const statusColors: Record<RequestRow["status"], readonly [number, number, number]> = {
        pending: [232, 171, 69],
        approved: [71, 190, 149],
        rejected: [226, 107, 112],
      }
      const statusLabel = request.status.toUpperCase()
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(8)
      const badgeWidth = pdf.getTextWidth(statusLabel) + 10
      const badgeX = pageWidth - margin - badgeWidth
      pdf.setFillColor(...statusColors[request.status])
      pdf.roundedRect(badgeX, 10, badgeWidth, 8, 2, 2, "F")
      pdf.setTextColor(...colors.white)
      pdf.text(statusLabel, badgeX + 5, 15.5)
      y = 66
      return
    }

    pdf.setFillColor(...colors.ink)
    pdf.rect(0, 0, pageWidth, 14, "F")
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(8)
    pdf.setTextColor(...colors.white)
    pdf.text("AETHELGUARD  /  INCIDENT REPORT", margin, 9)
    pdf.setFont("helvetica", "normal")
    pdf.setTextColor(...colors.muted)
    pdf.text(`Request ${request.id.slice(0, 8)}`, pageWidth - margin, 9, { align: "right" })
    y = 24
  }

  function ensureSpace(height: number) {
    if (y + height > pageBottom) {
      pdf.addPage()
      addPageHeader()
    }
  }

  function addSectionHeading(title: string) {
    ensureSpace(13)
    pdf.setFillColor(...colors.accent)
    pdf.roundedRect(margin, y - 3.2, 1.4, 5, 0.6, 0.6, "F")
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(9)
    pdf.setTextColor(...colors.ink)
    pdf.text(title.toUpperCase(), margin + 5, y)
    y += 7
  }

  function addFieldRow(fields: { label: string; value: string; x: number; width: number }[]) {
    const prepared = fields.map((field) => {
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(9)
      return {
        ...field,
        lines: pdf.splitTextToSize(field.value, field.width) as string[],
      }
    })
    const rowHeight = Math.max(...prepared.map((field) => 11 + field.lines.length * lineHeight))
    ensureSpace(rowHeight + 3)

    for (const field of prepared) {
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(7)
      pdf.setTextColor(...colors.muted)
      pdf.text(field.label.toUpperCase(), field.x, y)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(9)
      pdf.setTextColor(...colors.ink)
      field.lines.forEach((line, index) => {
        pdf.text(line, field.x, y + 5 + index * lineHeight)
      })
    }
    y += rowHeight + 4
  }

  function addParagraph(text: string) {
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(10)
    const lines = pdf.splitTextToSize(text || "No description provided.", contentWidth - 12) as string[]
    const boxPadding = 7
    let lineIndex = 0
    while (lineIndex < lines.length) {
      const availableLines = Math.floor((pageBottom - y - boxPadding * 2 - 1) / 5)
      if (availableLines < 1) {
        pdf.addPage()
        addPageHeader()
        continue
      }

      const chunk = lines.slice(lineIndex, lineIndex + availableLines)
      const boxHeight = chunk.length * 5 + boxPadding * 2
      pdf.setFillColor(...colors.pale)
      pdf.setDrawColor(...colors.border)
      pdf.roundedRect(margin, y, contentWidth, boxHeight, 2, 2, "FD")
      pdf.setFillColor(...colors.accent)
      pdf.roundedRect(margin, y, 1.2, boxHeight, 0.5, 0.5, "F")
      y += boxPadding + 1
      for (const line of chunk) {
        pdf.setFont("helvetica", "normal")
        pdf.setFontSize(10)
        pdf.setTextColor(...colors.ink)
        pdf.text(line, margin + 7, y)
        y += 5
      }
      y += boxPadding + 3
      lineIndex += chunk.length
      if (lineIndex < lines.length) {
        pdf.addPage()
        addPageHeader()
      }
    }
  }

  addPageHeader(true)
  addSectionHeading("Request & requester")
  const halfWidth = (contentWidth - 10) / 2
  addFieldRow([
    { label: "Request ID", value: request.id, x: margin, width: halfWidth },
    { label: "Submitted", value: new Date(request.requested_at).toLocaleString(), x: margin + halfWidth + 10, width: halfWidth },
  ])
  addFieldRow([
    { label: "Requester", value: profile?.display_name || profile?.email || request.user_id, x: margin, width: halfWidth },
    { label: "Email", value: profile?.email ?? "Unavailable", x: margin + halfWidth + 10, width: halfWidth },
  ])
  if (request.reviewed_at) {
    addFieldRow([{ label: "Reviewed", value: new Date(request.reviewed_at).toLocaleString(), x: margin, width: contentWidth }])
  }

  addSectionHeading("Affected incident")
  addFieldRow([
    { label: "File name", value: incident?.file_name ?? "File name unavailable", x: margin, width: halfWidth },
    { label: "Blocked", value: incident?.blocked_at ? new Date(incident.blocked_at).toLocaleString() : "Unavailable", x: margin + halfWidth + 10, width: halfWidth },
  ])
  addFieldRow([{ label: "SHA-256", value: incident?.sha256 ?? "Unavailable", x: margin, width: contentWidth }])
  addFieldRow([{ label: "Incident ID", value: request.incident_id, x: margin, width: contentWidth }])

  addSectionHeading("Issue description")
  addParagraph(request.reason)

  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    pdf.setDrawColor(...colors.border)
    pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(7)
    pdf.setTextColor(...colors.muted)
    pdf.text("CONFIDENTIAL  /  ADMINISTRATIVE USE", margin, pageHeight - 9)
    pdf.text(`PAGE ${page} OF ${pageCount}`, pageWidth - margin, pageHeight - 9, { align: "right" })
  }

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
