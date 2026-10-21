import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { calculateThreatScore } from "@/lib/threat-scoring"

type VirusTotalEngineResult = { engine_name?: string; category?: string; result?: string | null }

type VirusTotalFileResponse = {
  data?: {
    attributes?: {
      last_analysis_results?: Record<string, VirusTotalEngineResult>
      last_analysis_stats?: {
        malicious?: number
        suspicious?: number
        harmless?: number
        undetected?: number
        timeout?: number
        "confirmed-timeout"?: number
        failure?: number
        type_unsupported?: number
      }
    }
  }
}

function threatDetails(
  results: Record<string, VirusTotalEngineResult> | undefined,
) {
  if (!results || typeof results !== "object") return []
  return Object.values(results)
    .filter((result) => result.category === "malicious" || result.category === "suspicious")
    .slice(0, 3)
    .map((result) => {
      const engine = result.engine_name?.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      const detection = result.result?.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      if (!engine) return null
      return `${engine}: ${(detection || result.category || "flagged").slice(0, 120)}`
    })
    .filter((detail): detail is string => detail !== null)
}

export async function POST(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const apiKey = process.env.VIRUSTOTAL_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "VirusTotal is not configured on the server." }, { status: 503 })
  }

  let body: { sha256?: unknown; fileName?: unknown; recordIncident?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 })
  }

  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : ""
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : ""
  const recordIncident = body.recordIncident === undefined ? true : body.recordIncident
  if (
    !/^[0-9a-f]{64}$/.test(sha256) ||
    !fileName ||
    fileName.length > 255 ||
    typeof recordIncident !== "boolean"
  ) {
    return NextResponse.json({ error: "Provide a valid SHA-256 hash and file name (up to 255 characters)." }, { status: 400 })
  }

  let virusTotalResponse: Response
  try {
    virusTotalResponse = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
      headers: { "x-apikey": apiKey },
      cache: "no-store",
    })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Network request failed."
    return NextResponse.json({ error: `Unable to reach VirusTotal: ${detail}` }, { status: 502 })
  }

  if (virusTotalResponse.status === 404) {
    return NextResponse.json({ error: "VirusTotal has no report for this file hash." }, { status: 404 })
  }
  if (!virusTotalResponse.ok) {
    const status = virusTotalResponse.status === 429 ? 429 : 502
    return NextResponse.json(
      { error: `VirusTotal lookup failed with status ${virusTotalResponse.status}.` },
      { status },
    )
  }

  let report: VirusTotalFileResponse
  try {
    report = (await virusTotalResponse.json()) as VirusTotalFileResponse
  } catch {
    return NextResponse.json({ error: "VirusTotal returned invalid JSON." }, { status: 502 })
  }
  const stats = report.data?.attributes?.last_analysis_stats
  if (!stats) {
    return NextResponse.json({ error: "VirusTotal returned an incomplete analysis report." }, { status: 502 })
  }

  const malicious = Number(stats.malicious ?? 0)
  const suspicious = Number(stats.suspicious ?? 0)
  const counts = Object.values(stats).filter((value) => value !== undefined)
  if (
    counts.some((value) => !Number.isInteger(value) || Number(value) < 0) ||
    !Number.isInteger(malicious) ||
    !Number.isInteger(suspicious)
  ) {
    return NextResponse.json({ error: "VirusTotal returned invalid analysis statistics." }, { status: 502 })
  }
  const total = counts.reduce((sum, value) => sum + Number(value), 0)
  if (total < malicious + suspicious) {
    return NextResponse.json({ error: "VirusTotal returned invalid analysis statistics." }, { status: 502 })
  }

  const { data: profile, error: profileError } = await createSupabaseServiceClient()
    .from("profiles")
    .select("auto_quarantine_enabled")
    .eq("id", auth.user.id)
    .single()
  if (profileError) {
    return NextResponse.json({ error: `Unable to load the user's quarantine preference: ${profileError.message}` }, { status: 500 })
  }

  const autoQuarantineEnabled = profile.auto_quarantine_enabled ?? true
  const blocked = autoQuarantineEnabled && malicious > 0
  const threatScore = calculateThreatScore(malicious, suspicious, total)
  const details = threatDetails(report.data?.attributes?.last_analysis_results)
  let incidentId: string | null = null
  if (blocked && recordIncident) {
    try {
      const { data, error } = await createSupabaseServiceClient()
        .from("block_incidents")
        .insert({
          user_id: auth.user.id,
          file_name: fileName,
          sha256,
          malicious_engines: malicious,
          total_engines: total,
          threat_score: threatScore,
          threat_details: details,
        })
        .select("id")
        .single()
      if (error) {
        return NextResponse.json({ error: `Unable to save the block incident: ${error.message}` }, { status: 500 })
      }
      incidentId = data.id
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Service role is not configured."
      return NextResponse.json({ error: detail }, { status: 503 })
    }
  }

  return NextResponse.json({
    blocked,
    incidentId,
    maliciousEngines: malicious,
    suspiciousEngines: suspicious,
    totalEngines: total,
    threatScore,
    threatDetails: details,
  })
}
