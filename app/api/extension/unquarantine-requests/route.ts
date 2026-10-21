import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"

export async function GET(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const { data, error } = await auth.supabase
    .from("unquarantine_requests")
    .select("id, incident_id, reason, status, requested_at, reviewed_at")
    .eq("user_id", auth.user.id)
    .order("requested_at", { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data })
}

export async function POST(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  let body: { incidentId?: unknown; reason?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 })
  }

  const incidentId = typeof body.incidentId === "string" ? body.incidentId : ""
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incidentId)) {
    return NextResponse.json({ error: "Provide a valid incident ID." }, { status: 400 })
  }
  if (!reason || reason.length > 2000) {
    return NextResponse.json({ error: "A reason of up to 2,000 characters is required." }, { status: 400 })
  }

  const { data, error } = await auth.supabase
    .from("unquarantine_requests")
    .insert({ user_id: auth.user.id, incident_id: incidentId, reason })
    .select("id, incident_id, reason, status, requested_at")
    .single()

  if (error) {
    const status = error.code === "23505" ? 409 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ request: data }, { status: 201 })
}
