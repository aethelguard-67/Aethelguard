import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"

export async function POST(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const { error } = await auth.supabase.rpc("record_extension_heartbeat")
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ active: true, lastSeenAt: new Date().toISOString() })
}
