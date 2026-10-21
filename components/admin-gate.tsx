"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

export function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = useState<"checking" | "allowed">("checking")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured. Set the public Supabase URL and anon key to continue.")
      return
    }

    const supabase = createSupabaseBrowserClient()
    let active = true

    async function verifyAdmin() {
      try {
        if (active) {
          setStatus("checking")
          setError(null)
        }

        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (!authData.user) {
          router.replace("/login")
          return
        }
        if (authError) throw authError

        const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin")
        if (adminError) throw adminError
        if (!isAdmin) {
          router.replace("/dashboard")
          return
        }

        if (active) setStatus("allowed")
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to verify administrator access.")
      }
    }

    void verifyAdmin()
    const interval = window.setInterval(() => void verifyAdmin(), 60_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [router])

  if (status === "allowed") return children
  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
        {error}
      </div>
    )
  }
  return <p className="text-sm text-muted-foreground">Verifying administrator access…</p>
}
