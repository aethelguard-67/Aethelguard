import { NextResponse } from "next/server"
import { authenticateExtension } from "@/lib/supabase/extension-auth"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const auth = await authenticateExtension(request)
  if ("response" in auth) return auth.response

  const { data: profile, error: profileError } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single()

  if (profileError) {
    return NextResponse.json({ error: `Unable to verify administrator access: ${profileError.message}` }, { status: 500 })
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 })
  }

  const endDate = new Date().toISOString().slice(0, 10)
  const start = new Date(`${endDate}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - 29)
  const startDate = start.toISOString().slice(0, 10)

  try {
    const supabase = createSupabaseServiceClient()
    const activities: { user_id: string; activity_date: string }[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("url_reputation_activity")
        .select("user_id, activity_date")
        .gte("activity_date", startDate)
        .lte("activity_date", endDate)
        .order("activity_date", { ascending: true })
        .range(offset, offset + 999)

      if (error) {
        return NextResponse.json(
          {
            error: `Unable to load URL reputation activity. Apply Supabase migration 202610270002_url_reputation_activity.sql if it has not been applied. ${error.message}`,
          },
          { status: 503 },
        )
      }

      activities.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }

    const countsByDate = new Map<string, number>()
    for (const activity of activities) {
      countsByDate.set(activity.activity_date, (countsByDate.get(activity.activity_date) ?? 0) + 1)
    }

    const days = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(start)
      date.setUTCDate(start.getUTCDate() + index)
      const activityDate = date.toISOString().slice(0, 10)
      return { date: activityDate, count: countsByDate.get(activityDate) ?? 0 }
    })

    return NextResponse.json(days, { headers: { "Cache-Control": "no-store" } })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "The Supabase service role is not configured."
    return NextResponse.json({ error: `Unable to load URL reputation activity: ${detail}` }, { status: 503 })
  }
}
