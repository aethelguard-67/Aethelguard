"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { KeyRound, Loader2, LockKeyhole, Mail, ShieldCheck, UserRoundPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

async function readApiResponse(response: Response) {
  const body = await response.text()
  try {
    return JSON.parse(body) as { error?: string; email?: string; required?: boolean }
  } catch {
    throw new Error(
      body.trim()
        ? `The server returned an invalid response (HTTP ${response.status}).`
        : `The server returned an empty response (HTTP ${response.status}). Check the Vercel function logs.`,
    )
  }
}

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in")
  const [step, setStep] = useState<"password" | "email-code">("password")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmationPending, setConfirmationPending] = useState(false)

  function getLoginDestination() {
    return new URLSearchParams(window.location.search).get("next") === "/settings" ? "/settings" : "/dashboard"
  }

  async function sendEmailCode(accessToken: string) {
    const response = await fetch("/api/auth/email-mfa/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const result = await readApiResponse(response)
    if (!response.ok) throw new Error(result.error ?? "Unable to send the email verification code.")
    if (!result.required) return false
    setEmail(result.email ?? email)
    setStep("email-code")
    return true
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    setBusy(true)
    const supabase = createSupabaseBrowserClient()
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) throw signInError

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session) throw new Error("Password was accepted but no authenticated session was returned.")

      setPassword("")
      const requiresEmailCode = await sendEmailCode(data.session.access_token)
      if (!requiresEmailCode) router.replace(getLoginDestination())
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to sign in."
      const { error: signOutError } = await supabase.auth.signOut()
      setError(signOutError ? `${message} Also, the partial sign-in could not be cleared: ${signOutError.message}` : message)
    } finally {
      setBusy(false)
    }
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)

    try {
      const { data, error: signUpError } = await createSupabaseBrowserClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: displayName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (signUpError) throw signUpError

      setPassword("")
      if (data.session) {
        router.replace(getLoginDestination())
      } else {
        setConfirmationPending(true)
        setNotice("If this email can be registered, Supabase will send a confirmation link. Confirm your email before signing in.")
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the account.")
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const { error: resendError } = await createSupabaseBrowserClient().auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (resendError) throw resendError
      setNotice("If this email has a pending confirmation, Supabase will send another link. Check your inbox and spam folder.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resend the confirmation email.")
    } finally {
      setBusy(false)
    }
  }

  function switchMode(nextMode: "sign-in" | "register") {
    setMode(nextMode)
    setError(null)
    setNotice(null)
    setConfirmationPending(false)
    setPassword("")
  }

  async function verifyEmailCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    try {
      const sessionResult = await createSupabaseBrowserClient().auth.getSession()
      if (sessionResult.error) throw sessionResult.error
      const accessToken = sessionResult.data.session?.access_token
      if (!accessToken) throw new Error("Your password session expired. Sign in again.")

      const response = await fetch("/api/auth/email-mfa/verify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.error ?? "Unable to verify the email code.")
      router.replace("/dashboard")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to verify the email code.")
    } finally {
      setBusy(false)
    }
  }

  async function resendEmailCode() {
    setError(null)
    setBusy(true)
    try {
      const sessionResult = await createSupabaseBrowserClient().auth.getSession()
      if (sessionResult.error) throw sessionResult.error
      const accessToken = sessionResult.data.session?.access_token
      if (!accessToken) throw new Error("Your password session expired. Sign in again.")
      const requiresEmailCode = await sendEmailCode(accessToken)
      if (!requiresEmailCode) router.replace(getLoginDestination())
      setCode("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resend the email code.")
    } finally {
      setBusy(false)
    }
  }

  async function returnToPasswordStep() {
    const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut()
    if (signOutError) {
      setError(signOutError.message)
      return
    }
    setCode("")
    setStep("password")
    setError(null)
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <h1 className="text-xl font-semibold text-foreground">Supabase setup required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your local environment, then apply the
          database migrations.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-8 shadow-2xl backdrop-blur">
      <div className="mb-8 flex flex-col items-center text-center">
        <Image
          src="/aethelguard-logo.png"
          alt="Aethelguard logo"
          width={56}
          height={56}
          className="mb-4 size-14 rounded-xl"
        />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Aethelguard</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {step === "password"
            ? mode === "register"
              ? "Create an account to use the Aethelguard user dashboard."
              : "Sign in to your account."
            : "Verify your email to finish signing in."}
        </p>
      </div>

      {step === "password" ? (
        <form onSubmit={mode === "register" ? register : signIn} className="flex flex-col gap-4">
          {mode === "register" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Name</span>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={100}
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none"
                />
              </div>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Email</span>
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="email"
                autoComplete={mode === "register" ? "email" : "username"}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none"
              />
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Password</span>
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <LockKeyhole className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                minLength={mode === "register" ? 8 : undefined}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none"
              />
            </div>
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
          {mode === "register" && confirmationPending && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void resendConfirmation()}>
              {busy ? "Sending..." : "Resend confirmation email"}
            </Button>
          )}
          <Button type="submit" disabled={busy} className="mt-2 gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : mode === "register" ? <UserRoundPlus className="size-4" /> : <KeyRound className="size-4" />}
            {busy
              ? mode === "register" ? "Creating account..." : "Verifying credentials..."
              : mode === "register" ? "Create account" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "register" ? "Already have an account? " : "New to Aethelguard? "}
            <button
              type="button"
              disabled={busy}
              onClick={() => switchMode(mode === "register" ? "sign-in" : "register")}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {mode === "register" ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
      ) : (
        <form onSubmit={verifyEmailCode} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Enter the six-digit code sent to <span className="font-medium text-foreground">{email}</span>.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Email verification code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-lg tracking-[0.4em] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || code.length !== 6} className="mt-2 gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {busy ? "Verifying..." : "Verify & sign in"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void resendEmailCode()}>
            Resend code
          </Button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void returnToPasswordStep()}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Use a different account
          </button>
        </form>
      )}
    </div>
  )
}
