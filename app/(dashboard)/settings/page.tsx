"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, Mail, ShieldOff, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

export default function SettingsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState("")
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
        setEmail(profile.email ?? authData.user.email ?? "")
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
        headers: { Authorization: `Bearer ${accessToken}` },
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

  if (loading) {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading account security settings…
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Security Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control whether malicious files are quarantined automatically.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">{notice}</p>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
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
              Turning auto quarantine back on does not require an OTP.
            </p>
          </div>
        )}

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
    </div>
  )
}
