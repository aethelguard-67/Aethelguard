const loginForm = document.getElementById("login")
const message = document.getElementById("message")
const signOut = document.getElementById("signOut")
const urlChecks = document.getElementById("urlChecks")
const connect = document.getElementById("connect")
const connectionStatus = document.getElementById("connectionStatus")
const APP_URL = "https://www.aethelguard.xyz"

function showMessage(text, type = "error") {
  message.textContent = text
  message.className = type
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error(`The service returned an invalid response (HTTP ${response.status}).`)
  }
}

async function loadState() {
  const saved = await chrome.storage.local.get(["apiBaseUrl", "supabaseUrl", "supabaseAnonKey", "session", "urlChecksEnabled"])
  const configured = Boolean(saved.apiBaseUrl && saved.supabaseUrl && saved.supabaseAnonKey)
  const signedIn = Boolean(saved.session?.refresh_token)
  const urlChecksEnabled = saved.urlChecksEnabled !== false
  connectionStatus.textContent = configured
    ? signedIn
      ? `Signed in. Download scanning is active; URL checks are ${urlChecksEnabled ? "on" : "off"}.`
      : "Connect and sign in to enable download scanning and URL checks."
    : "Connect to the Aethelguard service to configure protection."
  loginForm.hidden = !configured || signedIn
  connect.hidden = configured
  urlChecks.hidden = !signedIn || !configured
  urlChecks.textContent = `Turn ${urlChecksEnabled ? "off" : "on"} URL checks`
  signOut.hidden = !signedIn || !configured
  if (signedIn && configured) showMessage("Download protection uses your account setting. Keep this session to scan and quarantine files.", "success")
}

async function connectToApp() {
  connect.disabled = true
  showMessage("Connecting to Aethelguard…", "success")
  try {
    const response = await fetch(`${APP_URL}/api/extension/config`, { cache: "no-store" })
    const result = await readJson(response)
    if (!response.ok || !result.supabaseUrl || !result.supabaseAnonKey) {
      throw new Error(result.error ?? `Unable to load app configuration (HTTP ${response.status}).`)
    }
    await chrome.storage.local.set({
      apiBaseUrl: APP_URL,
      supabaseUrl: result.supabaseUrl,
      supabaseAnonKey: result.supabaseAnonKey,
    })
    showMessage("Connected. Sign in with your Aethelguard account to enable protection.", "success")
    await loadState()
  } catch (error) {
    await chrome.storage.local.remove(["apiBaseUrl", "supabaseUrl", "supabaseAnonKey"])
    await loadState()
    showMessage(
      error instanceof Error
        ? `Could not reach Aethelguard at ${APP_URL}. Check the site is online and try again. (${error.message})`
        : `Could not reach Aethelguard at ${APP_URL}. Check the site is online and try again.`,
    )
  } finally {
    connect.disabled = false
  }
}

connect.addEventListener("click", () => void connectToApp())

urlChecks.addEventListener("click", async () => {
  const { urlChecksEnabled } = await chrome.storage.local.get("urlChecksEnabled")
  const nextEnabled = urlChecksEnabled === false
  await chrome.storage.local.set({ urlChecksEnabled: nextEnabled })
  showMessage(
    nextEnabled
      ? "URL checks are on. Download scanning and quarantine remain active."
      : "URL checks are off. Download scanning and quarantine remain active while you stay signed in.",
    "success",
  )
  await loadState()
})

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  showMessage("Signing in…", "success")
  const config = await chrome.storage.local.get(["supabaseUrl", "supabaseAnonKey"])
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    showMessage("Save your Supabase connection settings first.")
    return
  }

  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
      }),
    })
    const result = await readJson(response)
    if (!response.ok || !result.access_token || !result.refresh_token) {
      throw new Error(result.error_description ?? result.msg ?? result.message ?? "Sign-in failed.")
    }
    await chrome.storage.local.set({
      session: {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        expires_at: result.expires_at ?? Math.floor(Date.now() / 1000) + result.expires_in,
      },
    })
    document.getElementById("password").value = ""
    await loadState()
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Unable to sign in.")
  }
})

signOut.addEventListener("click", async () => {
  await chrome.storage.local.remove("session")
  await chrome.storage.local.set({ urlChecksEnabled: false })
  showMessage("Signed out. Download scanning and URL checks are now off.", "success")
  await loadState()
})

void loadState().then(connectToApp)
