"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { UserQuarantine } from "@/components/user-dashboard"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

export default function QuarantinePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured. Set the public Supabase URL and anon key to continue.")
      return
    }
    const supabase = createSupabaseBrowserClient()

    async function verifyUser() {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) {
        if (active) setError(authError.message)
        return
      }
      if (!authData.user) {
        router.replace("/login")
        return
      }

      const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin")
      if (adminError) {
        if (active) setError(adminError.message)
        return
      }
      if (isAdmin) {
        router.replace("/dashboard")
        return
      }
      if (active) setUserId(authData.user.id)
    }

    void verifyUser()
    return () => {
      active = false
    }
  }, [router])

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Unable to verify dashboard access: {error}
      </p>
    )
  }
  if (!userId) return <p className="text-sm text-muted-foreground">Verifying account access…</p>
  return <UserQuarantine userId={userId} />
}
