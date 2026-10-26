const REPORT_CACHE_MS = 30 * 60 * 1000
const NATIVE_HOST = "com.aethelguard.file_guard"
const reportCache = new Map()
const pendingReports = new Map()
const sourceReportCache = new Map()
const notificationTimers = new Map()

function normalizedPublicUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password || isPrivateHost(url.hostname)) return null
  url.search = ""
  url.hash = ""
  return url.toString()
}

function isPrivateHost(hostname) {
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

  return (
    host === "::1" ||
    /^(fc|fd)[0-9a-f]{2}:/i.test(host) ||
    /^fe[89ab]/.test(host)
  )
}

async function getConfig() {
  const config = await chrome.storage.local.get(["apiBaseUrl", "supabaseUrl", "supabaseAnonKey"])
  if (!config.apiBaseUrl || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Open the extension and configure the app and Supabase connection first.")
  }
  return config
}

async function refreshSession(config, session) {
  if (!session.refresh_token) throw new Error("Your extension session expired. Sign in again.")

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  })
  const result = await response.json()
  if (!response.ok || !result.access_token || !result.refresh_token) {
    await chrome.storage.local.remove("session")
    throw new Error("Your extension session expired. Sign in again.")
  }

  const refreshed = {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: result.expires_at ?? Math.floor(Date.now() / 1000) + result.expires_in,
  }
  await chrome.storage.local.set({ session: refreshed })
  return refreshed
}

async function getSession(config) {
  const { session } = await chrome.storage.local.get("session")
  if (!session?.access_token) throw new Error("Sign in through the extension popup to check this site.")
  if (!session.expires_at || session.expires_at * 1000 < Date.now() + 60_000) {
    return refreshSession(config, session)
  }
  return session
}

async function checkUrl(value) {
  const url = normalizedPublicUrl(value)
  if (!url) {
    return {
      status: "skipped",
      message: "Not checked: this is a local, private-network, or unsupported URL.",
    }
  }

  const cached = reportCache.get(url)
  if (cached && Date.now() - cached.checkedAt < REPORT_CACHE_MS) return cached.result
  if (pendingReports.has(url)) return pendingReports.get(url)

  const pending = requestReport(url)
    .then((result) => {
      reportCache.set(url, { checkedAt: Date.now(), result })
      return result
    })
    .finally(() => pendingReports.delete(url))
  pendingReports.set(url, pending)
  return pending
}

async function requestReport(url) {
  const config = await getConfig()
  let session = await getSession(config)
  const endpoint = new URL("/api/extension/scan-url", config.apiBaseUrl)
  endpoint.searchParams.set("url", url)

  let response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  })
  if (response.status === 401) {
    session = await refreshSession(config, session)
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    })
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(`The scoring service returned an invalid response (HTTP ${response.status}).`)
  }

  if (response.status === 404) {
    return { status: "unrated", message: "No existing VirusTotal report; this URL was not submitted for scanning." }
  }
  if (!response.ok) {
    throw new Error(result.error ?? `URL check failed (HTTP ${response.status}).`)
  }
  if (result.scanStatus && result.scanStatus !== "completed") {
    return { status: "pending", message: "VirusTotal has not completed this URL report yet." }
  }

  return {
    status: result.reputation ?? "unknown",
    threatScore: Number.isInteger(result.threatScore) ? result.threatScore : null,
    stats: result.stats ?? null,
    threatDetails: Array.isArray(result.threatDetails) ? result.threatDetails : [],
    message: "",
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "AETHELGUARD_CHECK_URL" || typeof message.url !== "string") return

  checkUrl(message.url)
    .then((result) => sendResponse({ result }))
    .catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : "Unable to check this URL." })
    })
  return true
})

chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId, url }) => {
  if (frameId !== 0) return
  chrome.tabs.sendMessage(tabId, { type: "AETHELGUARD_URL_CHANGED", url }, () => {
    void chrome.runtime.lastError
  })
})

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
      } else if (!response || response.ok !== true) {
        reject(new Error(response?.error || "The local file helper returned an invalid response."))
      } else {
        resolve(response)
      }
    })
  })
}

async function notifyDownload(downloadId, title, message) {
  const notificationId = `aethelguard-download-${downloadId}`
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/aethelguard.png"),
    title,
    message: message.slice(0, 240),
    priority: 2,
  })

  const existingTimer = notificationTimers.get(notificationId)
  if (existingTimer) clearTimeout(existingTimer)
  notificationTimers.set(
    notificationId,
    setTimeout(() => {
      notificationTimers.delete(notificationId)
      void chrome.notifications.clear(notificationId)
    }, 6_000),
  )
}

chrome.notifications.onClosed.addListener((notificationId) => {
  const timer = notificationTimers.get(notificationId)
  if (!timer) return
  clearTimeout(timer)
  notificationTimers.delete(notificationId)
})

async function requestFileScan(config, session, file, recordIncident) {
  const endpoint = new URL("/api/extension/scan", config.apiBaseUrl)
  const body = JSON.stringify({
    sha256: file.sha256,
    fileName: file.fileName,
    recordIncident,
  })
  const send = (accessToken) => fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body,
    cache: "no-store",
  })

  let response = await send(session.access_token)
  if (response.status === 401) {
    session = await refreshSession(config, session)
    response = await send(session.access_token)
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(`The scoring service returned an invalid response (HTTP ${response.status}).`)
  }
  return { response, result, session }
}

function downloadSourceDomain(download) {
  const sourceUrl = normalizedPublicUrl(download.finalUrl || download.url)
  return sourceUrl ? new URL(sourceUrl).hostname : null
}

function sourceReputationSummary(source) {
  if (!source.domain) return "Download source domain could not be checked."
  if (source.reputation === "malicious" || source.reputation === "suspicious") {
    return `Source ${source.domain} is ${source.reputation} on VirusTotal (${source.maliciousEngines} malicious, ${source.suspiciousEngines} suspicious detections).`
  }
  if (source.reputation === "clean") {
    return `Source ${source.domain} has no current malicious or suspicious VirusTotal flags; this does not prove the file is safe.`
  }
  if (source.reputation === "unknown") {
    return `No existing VirusTotal domain report for ${source.domain}; source reputation is unknown.`
  }
  const detail = source.error ? ` (${source.error.slice(0, 100)})` : ""
  return `Could not check the reputation of ${source.domain}.${detail}`
}

async function requestSourceReputation(config, session, domain) {
  const endpoint = new URL("/api/extension/source-reputation", config.apiBaseUrl)
  endpoint.searchParams.set("domain", domain)
  const send = (accessToken) => fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })

  let response = await send(session.access_token)
  if (response.status === 401) {
    session = await refreshSession(config, session)
    response = await send(session.access_token)
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(`The source reputation service returned invalid JSON (HTTP ${response.status}).`)
  }
  if (!response.ok) throw new Error(result.error || `Source lookup failed (HTTP ${response.status}).`)
  return { result, session }
}

async function checkDownloadSource(config, session, domain) {
  if (!domain) return { domain: null, reputation: "unavailable", session }

  const cached = sourceReportCache.get(domain)
  if (cached && Date.now() - cached.checkedAt < REPORT_CACHE_MS) {
    return { ...cached.result, session }
  }

  const { result, session: updatedSession } = await requestSourceReputation(config, session, domain)
  if (result.domain !== domain || !["malicious", "suspicious", "clean", "unknown"].includes(result.reputation)) {
    throw new Error("The source reputation service returned an invalid result.")
  }

  const source = {
    domain,
    reputation: result.reputation,
    maliciousEngines: result.maliciousEngines ?? 0,
    suspiciousEngines: result.suspiciousEngines ?? 0,
  }
  sourceReportCache.set(domain, { checkedAt: Date.now(), result: source })
  return { ...source, session: updatedSession }
}

async function scanCompletedDownload(downloadId) {
  try {
    const downloads = await chrome.downloads.search({ id: downloadId })
    const download = downloads[0]
    if (!download || download.state !== "complete" || download.incognito || !download.filename) return

    const config = await getConfig()
    let session
    try {
      session = await getSession(config)
    } catch (error) {
      await notifyDownload(
        downloadId,
        "Download not scanned",
        error instanceof Error ? error.message : "Sign in to enable download scanning.",
      )
      return
    }

    const domain = downloadSourceDomain(download)
    let source
    try {
      const sourceResult = await checkDownloadSource(config, session, domain)
      source = sourceResult
      session = sourceResult.session
    } catch (error) {
      source = {
        domain,
        reputation: "unavailable",
        error: error instanceof Error ? error.message : "Unexpected source lookup error.",
      }
    }
    const sourceSummary = sourceReputationSummary(source)

    const file = await sendNativeMessage({ operation: "hash", path: download.filename })
    let scan = await requestFileScan(config, session, file, false)
    session = scan.session
    const { response, result } = scan
    if (response.status === 404) {
      await notifyDownload(
        downloadId,
        source.reputation === "malicious" || source.reputation === "suspicious"
          ? "Source flagged — file not rated"
          : "Download not rated",
        `${file.fileName}: VirusTotal has no existing file report. It was not uploaded and remains in Downloads. ${sourceSummary}`,
      )
      return
    }
    if (!response.ok) {
      throw new Error(result.error || `File lookup failed (HTTP ${response.status}).`)
    }

    const scoreText = Number.isInteger(result.threatScore)
      ? `Threat score ${result.threatScore}/100. `
      : "No score available. "
    const detailText = Array.isArray(result.threatDetails) && result.threatDetails.length > 0
      ? ` ${result.threatDetails.join("; ")}`
      : ""

    if (result.blocked) {
      let quarantine
      try {
        quarantine = await sendNativeMessage({
          operation: "quarantine",
          path: download.filename,
          sha256: file.sha256,
        })
      } catch (error) {
        await notifyDownload(
          downloadId,
          "Threat found — quarantine failed",
          `${file.fileName}: ${scoreText}${result.maliciousEngines} engines marked it malicious. File contents were not uploaded, but the file may still be in Downloads. ${sourceSummary} ${error instanceof Error ? error.message : ""}`,
        )
        return
      }

      let incident
      try {
        incident = await requestFileScan(config, session, file, true)
      } catch (error) {
        await notifyDownload(
          downloadId,
          "Threat found — file quarantined",
          `${file.fileName}: ${scoreText}The file was isolated, but Aethelguard could not save the incident to the dashboard. ${sourceSummary} ${error instanceof Error ? error.message : ""}`,
        )
        return
      }
      if (!incident.response.ok) {
        await notifyDownload(
          downloadId,
          "Threat found — file quarantined",
          `${file.fileName}: ${scoreText}The file was isolated, but Aethelguard could not save the incident to the dashboard: ${incident.result.error || `HTTP ${incident.response.status}`}. ${sourceSummary}`,
        )
        return
      }

      const remainder = quarantine.originalRemoved
        ? ""
        : " The quarantine copy was made, but the original also remains in Downloads."
      await notifyDownload(
        downloadId,
        "Threat found — file quarantined",
        `${file.fileName.slice(0, 80)}: ${scoreText}${result.maliciousEngines} malicious detections. Request release in the dashboard; administrator approval is required. ${sourceSummary}${remainder}`,
      )
      return
    }

    if ((result.suspiciousEngines ?? 0) > 0) {
      await notifyDownload(
        downloadId,
        "Suspicious download — review it",
        `${file.fileName}: ${scoreText}${result.suspiciousEngines} engines marked it suspicious. It was left in Downloads, not automatically quarantined. ${sourceSummary}${detailText}`,
      )
      return
    }

    await notifyDownload(
      downloadId,
      source.reputation === "malicious" || source.reputation === "suspicious"
        ? "Source flagged — review download"
        : "Download report available",
      `${file.fileName}: ${scoreText}No malicious detections in the available file report; this does not guarantee the file is safe. ${sourceSummary}`,
    )
  } catch (error) {
    await notifyDownload(
      downloadId,
      "Download not scanned",
      error instanceof Error ? error.message : "Aethelguard could not scan this download.",
    )
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current !== "complete") return
  void scanCompletedDownload(delta.id)
})
