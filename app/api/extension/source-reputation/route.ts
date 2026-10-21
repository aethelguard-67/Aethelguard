import { isIP } from "node:net"
import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"
import { calculateThreatScore } from "@/lib/threat-scoring"

type VirusTotalDomainReport = {
  data?: {
    attributes?: {
      last_analysis_date?: number
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
      reputation?: number
    }
  }
}

function parsePublicDomain(value: string | null) {
  if (!value || value.length > 253 || value !== value.trim()) return null

  let parsed: URL
  try {
    parsed = new URL(`https://${value}`)
  } catch {
    return null
  }

  const domain = parsed.hostname.toLowerCase().replace(/\.$/, "")
  if (
    domain.length > 253 ||
    !domain.includes(".") ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    value.toLowerCase().replace(/\.$/, "") !== domain ||
    isIP(domain) ||
    domain === "localhost" ||
    /\.(localhost|local|internal|home\.arpa|lan|test)$/.test(domain) ||
    domain.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    return null
  }

  return domain
}

export async function GET(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const domain = parsePublicDomain(new URL(request.url).searchParams.get("domain"))
  if (!domain) {
    return NextResponse.json({ error: "Provide a valid public domain name." }, { status: 400 })
  }

  const apiKey = process.env.VIRUSTOTAL_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "VirusTotal is not configured on the server." }, { status: 503 })
  }

  let reportResponse: Response
  try {
    reportResponse = await fetch(
      `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`,
      {
        headers: { "x-apikey": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    )
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Network request failed."
    return NextResponse.json({ error: `Unable to reach VirusTotal: ${detail}` }, { status: 502 })
  }

  if (reportResponse.status === 404) {
    return NextResponse.json({ domain, reputation: "unknown", message: "No existing domain report." })
  }
  if (!reportResponse.ok) {
    const status = reportResponse.status === 429 ? 429 : 502
    return NextResponse.json(
      { error: `VirusTotal domain lookup failed with status ${reportResponse.status}.` },
      { status },
    )
  }

  let report: VirusTotalDomainReport
  try {
    report = (await reportResponse.json()) as VirusTotalDomainReport
  } catch {
    return NextResponse.json({ error: "VirusTotal returned invalid domain report JSON." }, { status: 502 })
  }

  const attributes = report.data?.attributes
  const stats = attributes?.last_analysis_stats
  if (!stats) {
    return NextResponse.json({ error: "VirusTotal returned an incomplete domain report." }, { status: 502 })
  }

  const values = Object.values(stats).filter((value) => value !== undefined)
  if (values.some((value) => !Number.isInteger(value) || Number(value) < 0)) {
    return NextResponse.json({ error: "VirusTotal returned invalid domain statistics." }, { status: 502 })
  }

  const malicious = stats.malicious ?? 0
  const suspicious = stats.suspicious ?? 0
  const totalEngines = values.reduce((sum, value) => sum + Number(value), 0)
  if (totalEngines < malicious + suspicious) {
    return NextResponse.json({ error: "VirusTotal returned invalid domain statistics." }, { status: 502 })
  }

  return NextResponse.json({
    domain,
    reputation: malicious > 0 ? "malicious" : suspicious > 0 ? "suspicious" : totalEngines > 0 ? "clean" : "unknown",
    maliciousEngines: malicious,
    suspiciousEngines: suspicious,
    totalEngines,
    threatScore: calculateThreatScore(malicious, suspicious, totalEngines),
    communityReputation: attributes.reputation ?? 0,
    lastAnalysisAt: attributes.last_analysis_date
      ? new Date(attributes.last_analysis_date * 1000).toISOString()
      : null,
  })
}
