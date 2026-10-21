import { NextResponse } from "next/server"
import { createUserSupabaseClient } from "@/lib/supabase/server"

export async function authenticateExtension(request: Request) {
  const authorization = request.headers.get("authorization")
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) {
    return { response: NextResponse.json({ error: "A Supabase access token is required." }, { status: 401 }) }
  }

  try {
    const supabase = createUserSupabaseClient(accessToken)
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (error || !data.user) {
      return { response: NextResponse.json({ error: "The access token is invalid or expired." }, { status: 401 }) }
    }
    return { supabase, user: data.user, accessToken }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Supabase is not configured."
    return { response: NextResponse.json({ error: message }, { status: 503 }) }
  }
}
