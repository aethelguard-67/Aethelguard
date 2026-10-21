import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

type JwtClaims = { session_id?: unknown }

export async function POST(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const { data, error: claimsError } = await auth.supabase.auth.getClaims(auth.accessToken)
  if (claimsError || !data?.claims) {
    return NextResponse.json({ error: "Unable to validate the signed-in session." }, { status: 401 })
  }

  const sessionId = (data.claims as JwtClaims).session_id
  if (typeof sessionId !== "string") {
    return NextResponse.json({ error: "The signed-in session is missing its session ID." }, { status: 401 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Session revocation is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server." }, { status: 503 })
  }

  const { error } = await createSupabaseServiceClient()
    .from("email_mfa_verified_sessions")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", auth.user.id)

  if (error) {
    return NextResponse.json({ error: `Unable to revoke the verified session: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ revoked: true })
}
