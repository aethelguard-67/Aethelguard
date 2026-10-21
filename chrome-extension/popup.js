const loginForm = document.getElementById("login")
const message = document.getElementById("message")
const signOut = document.getElementById("signOut")
const connect = document.getElementById("connect")
const connectionStatus = document.getElementById("connectionStatus")
const LOCAL_APP_URL = "http://localhost:3000"

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
  const saved = await chrome.storage.local.get(["apiBaseUrl", "supabaseUrl", "supabaseAnonKey", "session"])
  const configured = Boolean(saved.apiBaseUrl && saved.supabaseUrl && saved.supabaseAnonKey)
  connectionStatus.textContent = configured
    ? "Connected to the Aethelguard app on this device."
    : "Start the Aethelguard app on this device to configure protection."
  loginForm.hidden = !configured || Boolean(saved.session?.refresh_token)
  connect.hidden = configured
  if (saved.session?.refresh_token && configured) {
    showMessage("Account saved. Protection will resume when Chrome starts and refresh your session when needed.", "success")
    signOut.hidden = false
  } else {
    signOut.hidden = true
  }
}

async function connectToApp() {
  connect.disabled = true
  showMessage("Connecting to the local Aethelguard app…", "success")
  try {
    const response = await fetch(`${LOCAL_APP_URL}/api/extension/config`, { cache: "no-store" })
    const result = await readJson(response)
    if (!response.ok || !result.supabaseUrl || !result.supabaseAnonKey) {
      throw new Error(result.error ?? `Unable to load app configuration (HTTP ${response.status}).`)
    }
    await chrome.storage.local.set({
      apiBaseUrl: LOCAL_APP_URL,
      supabaseUrl: result.supabaseUrl,
      supabaseAnonKey: result.supabaseAnonKey,
    })
    showMessage("Connected. Sign in with your Aethelguard account to enable protection.", "success")
    await loadState()
  } catch (error) {
    showMessage(
      error instanceof Error
        ? `Could not reach Aethelguard at ${LOCAL_APP_URL}. Start the app and try again. (${error.message})`
        : `Could not reach Aethelguard at ${LOCAL_APP_URL}. Start the app and try again.`,
    )
  } finally {
    connect.disabled = false
  }
}

connect.addEventListener("click", () => void connectToApp())

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
  showMessage("Signed out. Sign in again to enable protection.", "success")
  await loadState()
})

void loadState().then(async () => {
  const saved = await chrome.storage.local.get(["apiBaseUrl", "supabaseUrl", "supabaseAnonKey"])
  if (!saved.apiBaseUrl || !saved.supabaseUrl || !saved.supabaseAnonKey) {
    await connectToApp()
  }
})
