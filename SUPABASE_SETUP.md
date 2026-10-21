# Aethelguard backend setup

See the [system architecture diagram](./docs/system-architecture.md) for the
application components and their data flows.

The admin console uses Supabase for sign-in, user profiles, blocked-file history,
unquarantine requests, and realtime request alerts. VirusTotal is used for
server-side file-hash and URL reputation lookups. No sample records are inserted.

## Configure Supabase

1. Create a Supabase project and run the SQL files in `supabase/migrations/` in
   chronological order. For an existing project, apply any newly added
   migration files as well; in particular,
   [`202610150001_quarantine_threat_columns.sql`](./supabase/migrations/202610150001_quarantine_threat_columns.sql)
   adds the threat-score columns used by the quarantine dashboard and scan API.
2. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the project API settings. Set
   `SUPABASE_SERVICE_ROLE_KEY` from the project API settings and
   `VIRUSTOTAL_API_KEY` to a VirusTotal API key. Keep both keys server-only;
   never add them to a `NEXT_PUBLIC_` variable or the browser extension.
3. Enable email/password sign-in in Supabase Auth. Users can create accounts
   from the login page; the profile trigger creates a `user` profile for each
   new Supabase Auth account. If email confirmation is enabled, add your app's
   `/auth/callback` URL to Supabase **Authentication → URL Configuration →
   Redirect URLs** and require users to confirm before signing in. Never expose
   a service-role key in the browser.
4. In Supabase **Authentication → Bot and Abuse Protection**, make sure CAPTCHA
   is disabled; the admin password sign-in does not use a CAPTCHA provider.
5. For administrator email verification, create a Resend API key, verify the
   sender domain/address in Resend, and set `RESEND_API_KEY` and
   `AUTH_EMAIL_FROM` in `.env.local`. For local sandbox testing, Resend accepts
   `onboarding@resend.dev` as the default sender when no `AUTH_EMAIL_FROM` is
   configured; production should use a verified custom domain or sender
   address. Regular users do not receive an email code. Generate a private code
   pepper with `node -e
   "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set
   it as `MFA_CODE_PEPPER`. Do not share or commit these secrets.
6. Promote the intended administrator in the SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'admin@example.com';
   ```

7. Restart the Next.js app after setting environment variables. Admin access
   requires the password and email code; regular user accounts sign in with
   their password only. Verified admin sessions expire after eight hours. The
   email code is single-use, expires after ten minutes, and allows at most five
   attempts. After applying this migration, existing administrator sessions
   must sign in again to complete verification.

## Browser extension API

Requests require `Authorization: Bearer <Supabase access token>` from a signed-in
Supabase user.

- `POST /api/extension/heartbeat` records extension activity. The dashboard
  counts a user as active when activity was recorded within five minutes.
- `POST /api/extension/scan` accepts `{"sha256":"<64 hex chars>","fileName":"..."}`.
  It looks up the existing hash report in VirusTotal and records a block incident
  if VirusTotal reports one or more malicious engines. Its response includes the
  incident ID needed for an unquarantine request, engine verdict counts, and a
  `threatScore` from 0 to 100. This heuristic is
  `round(100 * (malicious + 0.5 * suspicious) / total engines)`; it is an engine
  consensus indicator, not a probability. The score is `null` when no engines
  returned a verdict. It does not upload files. The optional
  `recordIncident: false` flag suppresses incident creation during the initial
  local-file check; the Chrome extension uses it and records the incident only
  after the native host confirms quarantine.
- `GET /api/extension/source-reputation?domain=<domain>` checks the VirusTotal
  domain report for a public download source. It only reads an existing report;
  it does not submit the domain for scanning. A missing report is returned as
  `unknown`. This reputation is informational and does not alter file
  quarantine decisions.
- `POST /api/extension/scan-url` accepts `{"url":"https://example.com/path"}`.
  It returns an existing VirusTotal URL report, or submits an unknown URL and
  responds with HTTP `202` and an analysis ID while the scan is pending. Poll
  `GET /api/extension/scan-url?analysisId=<analysis-id>` for status and engine
  counts and `threatScore`; after it completes, call
  `GET /api/extension/scan-url?url=<URL-encoded-URL>` to retrieve the URL report.
  Only HTTP and HTTPS URLs are accepted. The score uses the same formula as file
  scans and is not a probability.
  Submitting a URL shares it with VirusTotal; do not submit private URLs or
  URLs containing sensitive tokens.
- `POST /api/extension/unquarantine-requests` accepts
  `{"incidentId":"<UUID>","reason":"..."}` for a file owned by that user.
- `GET /api/extension/unquarantine-requests` returns that user's request status.
  The extension should poll this endpoint or subscribe to Supabase Realtime and
  perform the actual endpoint-side release only after an `approved` decision.

The app records an approval and marks the incident released atomically. The
Windows Chrome download-scanning helper and its installation steps are
documented in `chrome-extension/README.md`.

The helper calculates download hashes locally and looks up existing VirusTotal
reports; it does not upload file contents or submit unknown files. Files with
at least one malicious engine verdict are moved to
`%LOCALAPPDATA%\Aethelguard\Quarantine` and generate a Chrome notification.
Suspicious-only files are warned about but left in Downloads, and unknown hashes
are reported as unrated and left unchanged.
