"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Search, UserRound } from "lucide-react"
import { AdminGate } from "@/components/admin-gate"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type Profile = {
  id: string
  email: string
  display_name: string
  role: "admin" | "user"
  extension_active: boolean
  last_seen_at: string | null
}

type Incident = {
  id: string
  user_id: string
  file_name: string
  sha256: string
  status: "blocked" | "released"
  blocked_at: string
}

function UsersContent() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  const loadUsers = useCallback(async () => {
    const supabase = createSupabaseBrowserClient()
    const [profileResult, incidentResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, display_name, role, extension_active, last_seen_at")
        .order("email"),
      supabase
        .from("block_incidents")
        .select("id, user_id, file_name, sha256, status, blocked_at")
        .order("blocked_at", { ascending: false }),
    ])
    const failed = [profileResult.error, incidentResult.error].find(Boolean)
    if (failed) {
      setError(failed.message)
      return
    }

    const loadedProfiles = profileResult.data ?? []
    setProfiles(loadedProfiles)
    setIncidents(incidentResult.data ?? [])
    setSelectedId((current) => current ?? loadedProfiles[0]?.id ?? null)
    setError(null)
  }, [])

  useEffect(() => {
    void loadUsers()
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel("admin-user-activity")
      .on("postgres_changes", { event: "*", schema: "public", table: "block_incidents" }, () => {
        void loadUsers()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void loadUsers()
      })
      .subscribe((status, subscriptionError) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(`Realtime activity updates are unavailable: ${subscriptionError?.message ?? status}.`)
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadUsers])

  const filteredProfiles = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return profiles
    return profiles.filter((profile) =>
      `${profile.display_name} ${profile.email}`.toLowerCase().includes(value),
    )
  }, [profiles, query])

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null
  const selectedIncidents = selected ? incidents.filter((incident) => incident.user_id === selected.id) : []
  const activeCutoff = Date.now() - 5 * 60 * 1000

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Users & Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse individual accounts and their quarantine history.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to load user activity: {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.6fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search users"
              aria-label="Search users"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {filteredProfiles.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No user accounts found.</p>
          ) : (
            <ul className="max-h-[36rem] divide-y divide-border overflow-y-auto">
              {filteredProfiles.map((profile) => {
                const active =
                  profile.extension_active &&
                  profile.last_seen_at !== null &&
                  new Date(profile.last_seen_at).getTime() >= activeCutoff
                return (
                  <li key={profile.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(profile.id)}
                      className={
                        "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40 " +
                        (profile.id === selectedId ? "bg-primary/10" : "")
                      }
                    >
                      <UserRound className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {profile.display_name || profile.email}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{profile.email}</span>
                      </span>
                      <span className={"size-2 rounded-full " + (active ? "bg-primary" : "bg-muted-foreground/40")} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-border bg-card">
          {!selected ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">Select a user to view their activity.</p>
          ) : (
            <>
              <div className="border-b border-border px-5 py-4">
                <h2 className="truncate text-base font-semibold text-foreground">
                  {selected.display_name || selected.email}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{selected.email}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {selected.role} ·{" "}
                  {selected.extension_active &&
                  selected.last_seen_at !== null &&
                  new Date(selected.last_seen_at).getTime() >= activeCutoff
                    ? "Extension active"
                    : "Extension inactive"}
                  {selected.last_seen_at && ` · Last active ${new Date(selected.last_seen_at).toLocaleString()}`}
                </p>
              </div>
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <h3 className="text-sm font-medium text-foreground">Quarantine history</h3>
                <span className="font-mono text-sm text-foreground">{selectedIncidents.length} incidents</span>
              </div>
              {selectedIncidents.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">No quarantine incidents recorded.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {selectedIncidents.map((incident) => (
                    <li key={incident.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm text-foreground">{incident.file_name}</p>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{incident.sha256}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(incident.blocked_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                        {incident.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default function UsersPage() {
  return (
    <AdminGate>
      <UsersContent />
    </AdminGate>
  )
}
