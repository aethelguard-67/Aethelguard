import { NextRequest, NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"
import { createSupabaseServiceClient } from "@/lib/supabase/server"
import { hashEmailMfaChallengeToken, hashEmailMfaCode } from "@/lib/auth/email-mfa"

type JwtClaims = { session_id?: unknown }

export async function POST(request: NextRequest) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const token = request.cookies.get("aethelguard_email_mfa")?.value
  if (!token) {
    return NextResponse.json({ error: "Verification expired. Request a new email code." }, { status: 400 })
  }

  let body: { code?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 })
  }

  const code = typeof body.code === "string" ? body.code : ""
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the six-digit email code." }, { status: 400 })
  }

  const { data: claimsData, error: claimsError } = await auth.supabase.auth.getClaims(auth.accessToken)
  if (claimsError || !claimsData?.claims) {
    return NextResponse.json({ error: "Unable to validate the signed-in session." }, { status: 401 })
  }

  const sessionId = (claimsData.claims as JwtClaims).session_id
  if (typeof sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return NextResponse.json({ error: "The signed-in session is missing a valid session ID." }, { status: 401 })
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
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Email verification codes are only required for administrator accounts." }, { status: 403 })
  }

  let codeHash: string
  try {
    codeHash = hashEmailMfaCode(token, code)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Email verification is not configured."
    return NextResponse.json({ error: message }, { status: 503 })
  }

  const { data: verified, error: verifyError } = await service.rpc(
    "consume_email_mfa_challenge",
    {
      p_session_id: sessionId,
      p_user_id: auth.user.id,
      p_challenge_hash: hashEmailMfaChallengeToken(token),
      p_code_hash: codeHash,
    },
  )
  if (verifyError) {
    return NextResponse.json({ error: `Unable to verify the email code: ${verifyError.message}` }, { status: 500 })
  }
  if (!verified) {
    return NextResponse.json({ error: "The code is invalid, expired, or has reached its attempt limit." }, { status: 400 })
  }

  const response = NextResponse.json({ verified: true })
  response.cookies.set("aethelguard_email_mfa", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/email-mfa",
    maxAge: 0,
  })
  return response
}
