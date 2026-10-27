import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import {
  createEmailMfaChallengeToken,
  createEmailMfaCode,
  hashEmailMfaChallengeToken,
  hashEmailMfaCode,
} from "@/lib/auth/email-mfa"

type JwtClaims = { session_id?: unknown }

export async function POST(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response
  const purpose = new URL(request.url).searchParams.get("purpose")

  const { data: claimsData, error: claimsError } = await auth.supabase.auth.getClaims(auth.accessToken)
  if (claimsError || !claimsData?.claims) {
    return NextResponse.json({ error: "Unable to validate the signed-in session." }, { status: 401 })
  }

  const sessionId = (claimsData.claims as JwtClaims).session_id
  if (typeof sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return NextResponse.json({ error: "The signed-in session is missing a valid session ID." }, { status: 401 })
  }
  if (!auth.user.email) {
    return NextResponse.json({ error: "This account does not have an email address." }, { status: 400 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Email verification is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server." }, { status: 503 })
  }

  const service = createSupabaseServiceClient()
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single()
  if (profileError) {
    return NextResponse.json({ error: `Unable to load the account profile: ${profileError.message}` }, { status: 500 })
  }
  if (profile.role !== "admin" && profile.role !== "user") {
    return NextResponse.json({ error: "This account does not have access to verification codes." }, { status: 403 })
  }

  if (profile.role === "user") {
    if (purpose !== "auto-quarantine") return NextResponse.json({ required: false })
  } else if (purpose !== null) {
    return NextResponse.json({ error: "This verification request has an invalid purpose." }, { status: 400 })
  }

  const resendApiKey = process.env.RESEND_API_KEY
  const from = process.env.AUTH_EMAIL_FROM ?? (process.env.NODE_ENV === "production" ? undefined : "onboarding@resend.dev")
  if (!resendApiKey || !from) {
    return NextResponse.json(
      {
        error:
          "Admin email verification is not configured. Set RESEND_API_KEY on the server, and set AUTH_EMAIL_FROM to a verified Resend sender address.",
      },
      { status: 503 },
    )
  }

  let token: string
  let code: string
  let codeHash: string
  try {
    token = createEmailMfaChallengeToken()
    code = createEmailMfaCode()
    codeHash = hashEmailMfaCode(token, code)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Email verification is not configured."
    return NextResponse.json({ error: message }, { status: 503 })
  }

  const { data: issued, error: issueError } = await service.rpc("issue_email_mfa_challenge", {
    p_session_id: sessionId,
    p_user_id: auth.user.id,
    p_challenge_hash: hashEmailMfaChallengeToken(token),
    p_code_hash: codeHash,
  })
  if (issueError) {
    return NextResponse.json({ error: `Unable to create the email challenge: ${issueError.message}` }, { status: 500 })
  }
  if (!issued) {
    return NextResponse.json({ error: "A code was sent recently. Wait one minute before requesting another." }, { status: 429 })
  }

  let emailResponse: Response
  try {
    emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [auth.user.email],
        subject: "Your Aethelguard verification code",
        text: `Your Aethelguard verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return NextResponse.json({ error: "Unable to reach the email delivery service. Try again shortly." }, { status: 502 })
  }

  if (!emailResponse.ok) {
    let errorDetails = "Check the Resend sender configuration."
    try {
      const payload = (await emailResponse.json()) as { message?: string; error?: string }
      const message = payload.message ?? payload.error
      if (typeof message === "string" && message.trim()) {
        errorDetails = message.trim()
      }
    } catch {
      // Ignore parsing errors and fall back to the generic message above.
    }

    const guidance =
      emailResponse.status === 403
        ? " Resend rejected the sender address. Set AUTH_EMAIL_FROM to a verified sender/domain, or use onboarding@resend.dev for local Resend sandbox testing."
        : ""

    return NextResponse.json(
      { error: `Email delivery failed with status ${emailResponse.status}: ${errorDetails}${guidance}` },
      { status: 502 },
    )
  }

  const response = NextResponse.json({ required: true, sent: true, email: auth.user.email })
  response.cookies.set("aethelguard_email_mfa", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/email-mfa",
    maxAge: 10 * 60,
  })
  return response
}
