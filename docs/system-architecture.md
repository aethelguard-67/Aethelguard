# Aethelguard System Architecture

This is the maintained high-level architecture diagram for the project. Update
it when a client, server boundary, external service, or data flow changes.

```mermaid
flowchart LR
  subgraph device["User's Windows device"]
    chrome["Chrome"]
    subgraph extension["Aethelguard Chrome extension"]
      popup["Popup<br/>Sign-in"]
      content["Content script<br/>Current page URL"]
      worker["Background worker<br/>URL and download checks"]
    end
    host["Windows native host<br/>Hash files and quarantine locally"]
    files[("Downloads and local quarantine")]
    dashboard["Web dashboard<br/>User and admin views"]
  end

  subgraph app["Aethelguard Next.js application"]
    web["Dashboard pages"]
    api["Extension API<br/>config · heartbeat · scan · source reputation<br/>scan-url · unquarantine requests"]
    mfa["Admin email-MFA API"]
  end

  subgraph supabase["Supabase"]
    auth["Supabase Auth"]
    db[("Postgres<br/>profiles · block incidents<br/>unquarantine requests · MFA sessions")]
    realtime["Realtime"]
  end

  vt["VirusTotal API"]
  resend["Resend email service"]

  chrome --> popup
  chrome --> content
  popup -->|"Get public config"| api
  popup -->|"Sign in / refresh token"| auth
  content -->|"Page URL message"| worker
  worker <-->|"Native messaging<br/>path, hash, quarantine result"| host
  host -->|"Hash, verify, move file"| files
  worker -->|"Authenticated API requests"| api
  api -->|"Validate extension session / read and write data"| auth
  api -->|"Heartbeat, incidents, requests"| db
  api <-->|"Hash or URL reputation lookup"| vt

  chrome --> dashboard
  dashboard --> web
  web -->|"Browser Supabase client"| auth
  web -->|"Read dashboard data; create requests"| db
  web -->|"Admin review RPC"| db
  db -->|"Change notifications"| realtime
  realtime -->|"Live dashboard updates"| web
  web -->|"Request / verify admin code"| mfa
  mfa -->|"Store and verify challenge"| db
  mfa -->|"Deliver one-time code"| resend

  classDef local fill:#10233b,stroke:#36c9a0,color:#e9f2ff
  classDef service fill:#17223b,stroke:#7c91bd,color:#e9f2ff
  classDef external fill:#312440,stroke:#c29aff,color:#fff
  class chrome,popup,content,worker,host,files,dashboard local
  class web,api,mfa,auth,db,realtime service
  class vt,resend external
```

## Important data boundaries

- The native host calculates file hashes and moves quarantined files on the
  Windows device. File contents are not uploaded to Aethelguard or VirusTotal.
- The extension sends a file hash to the Aethelguard API for a VirusTotal
  report. A block incident is recorded only after the native host confirms
  quarantine.
- URL reputation checks use the Aethelguard API and VirusTotal; submitting an
  unknown URL for analysis shares that URL with VirusTotal.
- Supabase Auth handles account and extension sessions. The dashboard reads
  user-scoped data; administrator actions are enforced by database functions
  and policies. Realtime publishes updates to connected dashboards.
- The service-role key, VirusTotal API key, and Resend API key stay on the
  server.
