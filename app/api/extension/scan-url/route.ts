import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"
import { calculateThreatScore } from "@/lib/threat-scoring"

type VirusTotalStats = {
  malicious?: number
  suspicious?: number
  harmless?: number
  undetected?: number
  timeout?: number
  "confirmed-timeout"?: number
  failure?: number
  type_unsupported?: number
}

type VirusTotalUrlReport = {
  data?: {
    id?: string
    attributes?: {
      last_analysis_stats?: VirusTotalStats
      last_analysis_results?: Record<string, VirusTotalEngineResult>
      reputation?: number
      last_analysis_date?: number
    }
  }
}

type VirusTotalEngineResult = {
  engine_name?: string
  category?: string
  result?: string | null
}

type VirusTotalAnalysis = {
  data?: {
    id?: string
    attributes?: {
      status?: string
      stats?: VirusTotalStats
      results?: Record<string, VirusTotalEngineResult>
    }
  }
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null

  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

async function virusTotalFetch(path: string, apiKey: string, init?: RequestInit) {
  return fetch(`https://www.virustotal.com/api/v3${path}`, {
    ...init,
    headers: { "x-apikey": apiKey, ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
}

function upstreamError(status: number) {
  if (status === 429) {
    return NextResponse.json(
      { error: "VirusTotal rate limit reached. Wait before requesting another scan." },
      { status: 429 },
    )
  }
  return NextResponse.json({ error: `VirusTotal request failed with status ${status}.` }, { status: 502 })
}

async function readReport(response: Response) {
  try {
    return (await response.json()) as VirusTotalUrlReport
  } catch {
    return null
  }
}

function threatDetails(results: Record<string, VirusTotalEngineResult> | undefined) {
  if (!results) return []
  return Object.values(results)
    .filter(
      (result) =>
        result.category === "malicious" ||
        result.category === "suspicious",
    )
    .slice(0, 3)
    .map((result) => {
      const engine = result.engine_name?.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      const detection = result.result?.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      if (!engine) return null
      return `${engine}: ${(detection || result.category || "flagged").slice(0, 120)}`
    })
    .filter((detail): detail is string => detail !== null)
}

function reportResult(report: VirusTotalUrlReport) {
  const attributes = report.data?.attributes
  const stats = attributes?.last_analysis_stats
  if (!stats) return null

  const result = reputationResult(stats)
  if (!result) return null

  return {
    ...result,
    threatDetails: threatDetails(attributes.last_analysis_results),
    communityReputation: attributes.reputation ?? 0,
    lastAnalysisAt: attributes.last_analysis_date
      ? new Date(attributes.last_analysis_date * 1000).toISOString()
      : null,
  }
}

function reputationResult(stats: VirusTotalStats) {
  const values = Object.values(stats)
  if (values.some((value) => value !== undefined && (!Number.isInteger(value) || value < 0))) return null

  const malicious = stats.malicious ?? 0
  const suspicious = stats.suspicious ?? 0
  const totalEngines = values.reduce((sum, value) => sum + (value ?? 0), 0)
  const reputation =
    malicious > 0 ? "malicious" : suspicious > 0 ? "suspicious" : totalEngines > 0 ? "clean" : "unknown"

  return {
    reputation,
    threatScore: calculateThreatScore(malicious, suspicious, totalEngines),
    stats: {
      malicious,
      suspicious,
      harmless: stats.harmless ?? 0,
      undetected: stats.undetected ?? 0,
      total: totalEngines,
    },
  }
}

async function handleRequest(request: Request, submitIfMissing: boolean) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const apiKey = process.env.VIRUSTOTAL_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "VirusTotal is not configured on the server." }, { status: 503 })
  }

  const requestUrl = new URL(request.url)
  const analysisId = request.method === "GET" ? requestUrl.searchParams.get("analysisId") : null
  if (analysisId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(analysisId)) {
      return NextResponse.json({ error: "Provide a valid VirusTotal analysis ID." }, { status: 400 })
    }

    let analysisResponse: Response
    try {
      analysisResponse = await virusTotalFetch(`/analyses/${encodeURIComponent(analysisId)}`, apiKey)
    } catch {
      return NextResponse.json({ error: "Unable to reach VirusTotal for the analysis status." }, { status: 502 })
    }
    if (!analysisResponse.ok) return upstreamError(analysisResponse.status)

    let analysis: VirusTotalAnalysis
    try {
      analysis = (await analysisResponse.json()) as VirusTotalAnalysis
    } catch {
      return NextResponse.json({ error: "VirusTotal returned an invalid analysis response." }, { status: 502 })
    }

    const attributes = analysis.data?.attributes
    const status = attributes?.status
    if (!status) {
      return NextResponse.json({ error: "VirusTotal returned an incomplete analysis response." }, { status: 502 })
    }
    if (status !== "completed") {
      return NextResponse.json({ scanStatus: status, analysisId })
    }

    const result = attributes?.stats && reputationResult(attributes.stats)
    if (!result) {
      return NextResponse.json({ error: "VirusTotal returned invalid analysis statistics." }, { status: 502 })
    }
    return NextResponse.json({
      scanStatus: status,
      analysisId,
      ...result,
      threatDetails: threatDetails(attributes.results),
    })
  }

  let submittedUrl: string | null
  if (request.method === "GET") {
    submittedUrl = parseUrl(requestUrl.searchParams.get("url"))
  } else {
    let body: { url?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 })
    }
    submittedUrl = parseUrl(body.url)
  }

  if (!submittedUrl) {
    return NextResponse.json(
      { error: "Provide a valid HTTP or HTTPS URL without embedded credentials (maximum 2,048 characters)." },
      { status: 400 },
    )
  }

  const urlId = Buffer.from(submittedUrl, "utf8").toString("base64url")
  let reportResponse: Response
  try {
    reportResponse = await virusTotalFetch(`/urls/${urlId}`, apiKey)
  } catch {
    return NextResponse.json({ error: "Unable to reach VirusTotal for the URL reputation lookup." }, { status: 502 })
  }

  if (reportResponse.ok) {
    const report = await readReport(reportResponse)
    const result = report && reportResult(report)
    if (!result) {
      return NextResponse.json({ error: "VirusTotal returned an incomplete or invalid URL report." }, { status: 502 })
    }
    return NextResponse.json({ ...result, scanStatus: "completed" })
  }

  if (reportResponse.status !== 404) return upstreamError(reportResponse.status)
  if (!submitIfMissing) {
    return NextResponse.json(
      { error: "VirusTotal has no completed URL report yet. Submit a POST request to start a scan." },
      { status: 404 },
    )
  }

  let submission: Response
  try {
    submission = await virusTotalFetch("/urls", apiKey, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: submittedUrl }),
    })
  } catch {
    return NextResponse.json({ error: "Unable to submit the URL to VirusTotal." }, { status: 502 })
  }

  if (!submission.ok) return upstreamError(submission.status)

  let analysis: VirusTotalAnalysis
  try {
    analysis = (await submission.json()) as VirusTotalAnalysis
  } catch {
    return NextResponse.json({ error: "VirusTotal returned an invalid scan submission response." }, { status: 502 })
  }

  if (!analysis.data?.id) {
    return NextResponse.json({ error: "VirusTotal did not return an analysis ID." }, { status: 502 })
  }

  return NextResponse.json(
    {
      scanStatus: analysis.data.attributes?.status ?? "queued",
      analysisId: analysis.data.id,
      message: "URL submitted. Check the URL report again after VirusTotal completes its analysis.",
    },
    { status: 202 },
  )
}

export async function POST(request: Request) {
  return handleRequest(request, true)
}

export async function GET(request: Request) {
  return handleRequest(request, false)
}
