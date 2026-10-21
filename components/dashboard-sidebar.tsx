"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { LayoutDashboard, BellRing, Users, ShieldAlert, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"

const adminNav = [
  { href: "/dashboard", label: "Main Dashboard", icon: LayoutDashboard },
  { href: "/requests", label: "Unquarantine Requests", icon: BellRing },
  { href: "/users", label: "Users & Activity", icon: Users },
]

const userNav = [
  { href: "/dashboard", label: "My Dashboard", icon: LayoutDashboard },
  { href: "/quarantine", label: "Quarantine", icon: ShieldAlert },
  { href: "/settings", label: "Settings", icon: Settings },
]

function useDashboardNav() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured.")
      return
    }
    const supabase = createSupabaseBrowserClient()
    async function loadRole() {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) {
        if (active) setError(authError.message)
        return
      }
      if (!authData.user) {
        router.replace("/login")
        return
      }
      const { data, error: roleError } = await supabase.rpc("is_admin")
      if (roleError) {
        if (active) setError(roleError.message)
        return
      }
      if (active) setIsAdmin(Boolean(data))
    }
    void loadRole()
    return () => {
      active = false
    }
  }, [router])

  const nav = isAdmin === null ? [] : isAdmin ? adminNav : userNav
  return { nav, isAdmin, error }
}

export function DashboardSidebar() {
  const pathname = usePathname()
  const { nav, isAdmin, error } = useDashboardNav()

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-5">
        <Image
          src="/aethelguard-logo.png"
          alt="Aethelguard logo"
          width={36}
          height={36}
          className="size-9 rounded-lg"
        />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-sidebar-foreground">Aethelguard</span>
          <span className="text-xs text-muted-foreground">{isAdmin ? "Security Console" : "User Center"}</span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">Navigation unavailable: {error}</p>}
        {isAdmin === null && !error && <p className="px-3 py-2 text-xs text-muted-foreground">Loading navigation…</p>}
        {nav.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>

    </aside>
  )
}

export function MobileNav() {
  const pathname = usePathname()
  const { nav } = useDashboardNav()
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-border bg-sidebar px-2 py-2 md:hidden">
      {nav.map((item) => {
        const active = pathname === item.href
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
