(() => {
  if (window.top !== window || document.getElementById("aethelguard-url-guard")) return

  const host = document.createElement("div")
  host.id = "aethelguard-url-guard"
  host.style.cssText = "all:initial;position:fixed;right:16px;top:16px;z-index:2147483647"
  let dismissTimer
  const shadow = host.attachShadow({ mode: "closed" })
  const style = document.createElement("style")
  style.textContent = `
    .card{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e2e8f0;background:#101b30;border:1px solid #334155;border-radius:12px;box-shadow:0 8px 28px #0005;width:min(340px,calc(100vw - 40px));padding:14px}
    .top{display:flex;align-items:center;gap:9px}.brand{font-weight:700;flex:1}.score{font-weight:700;font-size:15px}
    .status{display:inline-flex;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700;text-transform:uppercase}
    .malicious{color:#fecaca;background:#7f1d1d}.suspicious{color:#fde68a;background:#78350f}.clean{color:#a7f3d0;background:#064e3b}.other{color:#cbd5e1;background:#334155}
    .message{margin:9px 0 0;color:#cbd5e1;overflow-wrap:anywhere}.detail{margin:6px 0 0;padding-left:16px;color:#fecaca;font-size:12px}
    .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:11px}
    button{font:inherit;border:1px solid #475569;border-radius:7px;padding:5px 9px;background:#1e293b;color:#e2e8f0;cursor:pointer}
    button.back{background:#10b981;border-color:#10b981;color:#052e2b;font-weight:700}
    .close{font-size:18px;line-height:1;padding:0 5px;background:transparent;border:0}
    .foot{margin-top:7px;color:#94a3b8;font-size:10px}
  `
  const card = document.createElement("section")
  card.className = "card"
  card.setAttribute("role", "status")
  const top = document.createElement("div")
  top.className = "top"
  const brand = document.createElement("span")
  brand.className = "brand"
  brand.textContent = "Aethelguard"
  const score = document.createElement("span")
  score.className = "score"
  score.textContent = "Checking URL…"
  const close = document.createElement("button")
  close.className = "close"
  close.type = "button"
  close.setAttribute("aria-label", "Dismiss URL report")
  close.textContent = "×"
  close.addEventListener("click", () => {
    clearTimeout(dismissTimer)
    host.remove()
  })
  top.append(brand, score, close)
  const status = document.createElement("span")
  status.className = "status other"
  status.textContent = "Checking"
  const message = document.createElement("p")
  message.className = "message"
  message.textContent = "Looking for an existing VirusTotal report."
  const details = document.createElement("ul")
  details.className = "detail"
  details.hidden = true
  const foot = document.createElement("p")
  foot.className = "foot"
  foot.textContent = "URL query strings and fragments are not sent. Unknown URLs are not submitted."
  const actions = document.createElement("div")
  actions.className = "actions"
  const back = document.createElement("button")
  back.className = "back"
  back.type = "button"
  back.textContent = "Go back to safety"
  back.hidden = true
  back.addEventListener("click", () => history.back())
  actions.append(back)
  card.append(top, status, message, details, foot, actions)
  shadow.append(style, card)
  document.documentElement.append(host)

  function scheduleDismiss() {
    clearTimeout(dismissTimer)
    dismissTimer = setTimeout(() => host.remove(), 6_000)
  }

  function display(result) {
    const state = result.status
    status.textContent = state
    status.className = `status ${state === "malicious" ? "malicious" : state === "suspicious" ? "suspicious" : state === "clean" ? "clean" : "other"}`
    details.replaceChildren()
    for (const text of result.threatDetails ?? []) {
      const item = document.createElement("li")
      item.textContent = text
      details.append(item)
    }
    details.hidden = details.childElementCount === 0
    back.hidden = state !== "malicious" && state !== "suspicious"

    if (state === "malicious") {
      const count = result.stats?.malicious ?? 0
      score.textContent = `${count} malicious`
      message.textContent = `${count} VirusTotal scanner${count === 1 ? "" : "s"} flagged this URL as malicious. Avoid entering information or downloading files.`
    } else if (state === "suspicious") {
      const count = result.stats?.suspicious ?? 0
      score.textContent = `${count} suspicious`
      message.textContent = `${count} VirusTotal scanner${count === 1 ? "" : "s"} flagged this URL as suspicious. Proceed with caution.`
    } else if (state === "clean") {
      score.textContent = "No detections"
      message.textContent = "No malicious or suspicious detections in the available report. This is not a guarantee the site is safe."
    } else {
      score.textContent = "No score"
      message.textContent = result.message || "No reputation result is available for this URL."
    }

    scheduleDismiss()
  }

  function checkUrl(url) {
    clearTimeout(dismissTimer)
    if (!host.isConnected) document.documentElement.append(host)
    status.textContent = "Checking"
    status.className = "status other"
    score.textContent = "Checking URL…"
    message.textContent = "Looking for an existing VirusTotal report."
    details.replaceChildren()
    details.hidden = true
    back.hidden = true

    chrome.runtime.sendMessage({ type: "AETHELGUARD_CHECK_URL", url }, (response) => {
      if (chrome.runtime.lastError) {
        message.textContent = chrome.runtime.lastError.message || "Unable to contact the extension service."
        status.textContent = "Unavailable"
        status.className = "status other"
        score.textContent = "No score"
        scheduleDismiss()
        return
      }
      if (response?.error) {
        message.textContent = response.error
        status.textContent = "Unavailable"
        status.className = "status other"
        score.textContent = "No score"
        scheduleDismiss()
        return
      }
      if (response?.result) display(response.result)
    })
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "AETHELGUARD_URL_CHANGED" && typeof message.url === "string") {
      checkUrl(message.url)
    }
  })
  checkUrl(location.href)
})()
