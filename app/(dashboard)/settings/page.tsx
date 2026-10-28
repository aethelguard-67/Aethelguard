"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Shield,
  ShieldOff,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

const extensionRepoUrl = "https://github.com/aethelguard-67/Aethelguard"
const extensionGuideUrl = `${extensionRepoUrl}/blob/main/chrome-extension/README.md`
const extensionZipUrl = "/api/extension/download"

export default function SettingsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [autoQuarantineEnabled, setAutoQuarantineEnabled] = useState(true)
  const [otpSent, setOtpSent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured. Set the public Supabase URL and anon key to continue.")
      setLoading(false)
      return
    }

    async function loadProfile() {
      const supabase = createSupabaseBrowserClient()
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) {
        if (active) setError(authError.message)
        setLoading(false)
        return
      }
      if (!authData.user) {
        router.replace("/login?next=%2Fsettings")
        return
      }

      const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin")
      if (adminError) {
        if (active) setError(adminError.message)
        setLoading(false)
        return
      }
      if (isAdmin) {
        router.replace("/dashboard")
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, auto_quarantine_enabled")
        .eq("id", authData.user.id)
        .single()

      if (profileError) {
        if (active) setError(profileError.message)
        setLoading(false)
        return
      }

      if (active) {
        setUserId(profile.id)
        setEmail(authData.user.email ?? profile.email ?? "")
        setAutoQuarantineEnabled(profile.auto_quarantine_enabled ?? true)
        setLoading(false)
      }
    }

    void loadProfile()
    return () => {
      active = false
    }
  }, [router])

  async function updateSetting(nextEnabled: boolean) {
    if (!userId) return
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("profiles").update({ auto_quarantine_enabled: nextEnabled }).eq("id", userId)
    if (error) throw new Error(error.message)
    setAutoQuarantineEnabled(nextEnabled)
    setNotice(nextEnabled ? "Auto-quarantine is enabled again." : "Auto-quarantine is disabled for your account.")
    setError(null)
  }

  async function sendCode() {
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const supabase = createSupabaseBrowserClient()
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        router.replace("/login?next=%2Fsettings")
        return
      }

      const response = await fetch("/api/auth/email-mfa/send?purpose=auto-quarantine", {
        method: "POST",
        headers: { Authorization: ["Bearer", accessToken].join(" ") },
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Unable to send your verification code.")
      setOtpSent(true)
      setNotice("We sent a one-time code to your email address. Enter it below to confirm the change.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send the verification code.")
    } finally {
      setBusy(false)
    }
  }

  async function confirmDisable() {
    if (!userId || !otp.trim()) {
      setError("Enter the six-digit code from your email to continue.")
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const supabase = createSupabaseBrowserClient()
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        router.replace("/login?next=%2Fsettings")
        return
      }

      const response = await fetch("/api/auth/email-mfa/verify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: otp.trim(), purpose: "auto-quarantine" }),
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "Unable to verify the email code.")

      setAutoQuarantineEnabled(false)
      setNotice("Auto-quarantine is disabled for your account.")
      setError(null)
      setOtp("")
      setOtpSent(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to confirm the change.")
    } finally {
      setBusy(false)
    }
  }

  async function enableAutoQuarantine() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await updateSetting(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to enable auto-quarantine.")
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (newPassword.length < 8) {
      setError("Your new password must be at least 8 characters.")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.")
      return
    }

    setBusy(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!sessionData.session) {
        router.replace("/login?next=%2Fsettings")
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError
      setNewPassword("")
      setConfirmPassword("")
      setNotice("Your password has been updated.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update your password.")
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const accessToken = sessionData.session?.access_token
      if (accessToken) {
        const headers = new Headers()
        headers.set("Authorization", ["Bearer", accessToken].join(" "))
        const response = await fetch("/api/auth/email-mfa/logout", {
          method: "POST",
          headers,
        })
        let result: { error?: string }
        try {
          result = (await response.json()) as { error?: string }
        } catch {
          throw new Error(`The sign-out service returned an invalid response (HTTP ${response.status}).`)
        }
        if (!response.ok) throw new Error(result.error ?? "Unable to revoke the verified session.")
      }

      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
      router.replace("/login")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign out.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading account security settings…
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage protection, your account, and the browser extension.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">{notice}</p>
      )}

      <section aria-labelledby="protection-heading" className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5">
          <h2 id="protection-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Shield className="size-4 text-primary" />
            Protection
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose whether confirmed malicious downloads are automatically moved to quarantine.
          </p>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Auto quarantine</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {autoQuarantineEnabled
                ? "Malicious files are automatically isolated in quarantine."
                : "Auto quarantine is paused for your account."}
            </p>
          </div>

          {autoQuarantineEnabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sendCode()}
              disabled={busy || !userId}
              className="gap-2 border-amber-500/40 text-amber-600 dark:text-amber-400"
            >
              <ShieldOff className="size-4" />
              Turn off
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => void enableAutoQuarantine()}
              disabled={busy || !userId}
              className="gap-2"
            >
              <ShieldCheck className="size-4" />
              Turn on
            </Button>
          )}
        </div>

        {!autoQuarantineEnabled && (
          <div className="mt-5 rounded-lg border border-border bg-secondary/40 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <AlertTriangle className="size-4 text-amber-500" />
              When disabled, malicious files are reported but are not automatically quarantined. Turning this back on does not require an OTP.
            </p>
          </div>
        )}

        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          This setting affects completed download scans when you are signed in to the Aethelguard extension. URL reputation checks are controlled separately in the extension popup.
        </p>

        {autoQuarantineEnabled && otpSent && (
          <div className="mt-5 space-y-4 rounded-lg border border-border bg-secondary/30 p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-4 text-primary" />
              Enter the six-digit code sent to {email}.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="size-4 text-primary" />
                OTP code
              </label>
              <input
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0 placeholder:text-muted-foreground"
                placeholder="123456"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void sendCode()} disabled={busy} variant="outline" size="sm">
                Resend code
              </Button>
              <Button onClick={() => void confirmDisable()} disabled={busy} size="sm">
                Confirm turn off
              </Button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="account-heading" className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5">
          <h2 id="account-heading" className="text-base font-semibold text-foreground">Account</h2>
          <p className="mt-1 text-sm text-muted-foreground">View your sign-in email, update your password, or sign out.</p>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3">
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Sign-in email</p>
            <p className="break-all text-sm font-medium text-foreground">{email}</p>
          </div>
        </div>

        <form onSubmit={(event) => void changePassword(event)} className="mt-5 space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <KeyRound className="size-4 text-primary" />
            Change password
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-foreground">
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                placeholder="At least 8 characters"
              />
            </label>
            <label className="space-y-2 text-sm text-foreground">
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Enter the new password again"
              />
            </label>
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </Button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div>
            <p className="text-sm font-medium text-foreground">Sign out</p>
            <p className="mt-1 text-xs text-muted-foreground">End this dashboard session on this browser.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void signOut()} disabled={busy} className="gap-2">
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </section>

      <section aria-labelledby="extension-heading" className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4">
          <h2 id="extension-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Download className="size-4 text-primary" />
            Browser extension
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Install the Chrome extension to check URLs and scan completed downloads.
          </p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Download and extract the extension ZIP, then load the extracted folder containing <code className="font-mono text-foreground">manifest.json</code> at <code className="font-mono text-foreground">chrome://extensions</code> with Developer mode enabled.</li>
          <li>On Windows, run the included native helper installer to enable local file hashing and quarantine.</li>
          <li>Open the extension popup and sign in. URL checks can be toggled separately; download scanning requires the extension session.</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={extensionZipUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            <Download className="size-4" />
            Download extension files
          </a>
          <a
            href={extensionGuideUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            Full setup guide
            <ExternalLink className="size-4" />
          </a>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">The extension is installed manually and is not currently listed in the Chrome Web Store.</p>
      </section>

      <section aria-labelledby="notifications-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="notifications-heading" className="text-base font-semibold text-foreground">Email notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Email alerts for quarantine events and request updates are not available yet. You can review current incidents and request status from your dashboard.
        </p>
      </section>
    </div>
  )
}
