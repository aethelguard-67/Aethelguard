"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

export function DashboardTopbar() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"Administrator" | "User" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createSupabaseBrowserClient()
    let active = true
    async function loadAccount() {
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError) {
        if (active) setError(userError.message)
        return
      }
      if (!data.user) {
        router.replace("/login")
        return
      }
      const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin")
      if (roleError) {
        if (active) setError(roleError.message)
        return
      }
      if (active) {
        setEmail(data.user.email ?? "")
        setRole(isAdmin ? "Administrator" : "User")
      }
    }
    void loadAccount()
    return () => {
      active = false
    }
  }, [router])

  async function logout() {
    if (isSupabaseConfigured()) {
      const supabase = createSupabaseBrowserClient()
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) {
        setError(sessionError.message)
        return
      }
      const accessToken = data.session?.access_token
      if (accessToken) {
        try {
          const response = await fetch("/api/auth/email-mfa/logout", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          const result = (await response.json()) as { error?: string }
          if (!response.ok) throw new Error(result.error ?? "Unable to revoke verified session.")
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to revoke verified session.")
          return
        }
      }
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        setError(signOutError.message)
        return
      }
    }
    router.replace("/login")
  }

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          <UserCheck className="size-3.5" />
          {role ?? "Account"}
        </span>
        {email && <span className="text-muted-foreground">{email}</span>}
      </div>

      <div className="flex items-center gap-3">
        {error && <p role="alert" className="text-xs text-destructive">Account action failed: {error}</p>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void logout()}
          className="gap-2 border-border bg-transparent text-foreground hover:bg-secondary"
        >
          <LogOut className="size-4" />
          Logout
        </Button>
      </div>
    </header>
  )
}
