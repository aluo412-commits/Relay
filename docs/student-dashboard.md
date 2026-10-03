# Relay student dashboard — FUHSD pilot

The root of relay.aaronluo.com is now an English student dashboard, not the team chat product. `/app` and `/demo` redirect to `/`. The existing team components, APIs and database models remain in the repository; the prior entry points are under `/legacy`, `/legacy/demo`, and `/legacy/landing`. Git tag `archive/team-relay-e399568` preserves the pre-pivot version. No database migration or deletion is required.

## Live sources, not a seeded demo

- **FUHSD website:** the server reads public news records from `https://www.fuhsd.org` and events from `/about-us/general-information/calendar`. The district website itself links to **https://fuhsd.schoology.com/**. The `.org` Schoology address is not used: it redirected to an unrelated site during inspection.
- **Schoology:** a student supplies an authorized iCalendar subscription URL through Connections. Only HTTPS on `fuhsd.schoology.com`, `app.schoology.com`, and `api.schoology.com` is accepted. Redirects are refused, response size and time are bounded, and the response must be an iCalendar document before the connection is saved. Relay does not collect school passwords, session cookies, or scrape an SSO login. Calendar export may be disabled by the district; no export means this connector cannot access the student's work yet.
- **Gmail:** explicit, separate read-only OAuth consent. Uses the existing Google client and registered `/api/auth/google/callback`; the `study_` state prefix selects an independent PKCE/state-checked flow. Google must have the Gmail API enabled, the `gmail.readonly` scope configured, and appropriate test-user/verification/admin approval. Existing Google sign-in is not Gmail permission. No mail is fetched without consent.

The dashboard never substitutes sample assignments when a connection is missing or fails. Its short brief is a deterministic digest of source records, not a model-generated academic assessment. Email cards show original previews, not AI summaries. No private source data is sent to an LLM.

## Limits that must stay visible

- Calendar data is **not submission status**. No grades, attachment contents, or confirmed completion are imported. Calendar entries are classified as assignments only when their URL/category explicitly supports it; otherwise they remain course events.
- Checkmarks mean “done in Relay on this browser,” not submitted to Schoology. Only opaque item IDs are saved in localStorage, namespaced by the calendar connection fingerprint. Disconnect clears those checkmarks.
- Pacific time is the FUHSD display timezone. Date-only events keep their date. UTC and IANA TZID values are converted; unparseable dates remain unknown. Recurring entries currently show their base occurrence only, with a warning; recurrence expansion/exceptions need a mature calendar library before claiming full calendar coverage.
- Calendar coverage is the source's export, filtered to the last 30 / next 180 days. Schoology is capped at 400 records, prioritizing upcoming entries and displaying a truncation warning. The combined response is capped at 500 records. The public website currently supplies a limited upcoming-events list and its latest news records, not an entire school-year calendar.
- Gmail requests up to 12 inbox messages from the last 30 days, filtered to FUHSD and Schoology senders and verified against returned sender domains. It reads metadata and snippets, never attachments or full message bodies. This may return fewer than 12 entries. It cannot send, delete, or mark email as read.
- District announcements are not individual-campus announcements. Other schools/providers are not supported yet; source adapters are isolated under `src/lib/student/` so they can be added without rebuilding the board.

## Privacy and deployment

- Require existing `AUTH_SECRET` to be at least 32 characters. It derives a purpose-separated AES-256-GCM credential key. URL and OAuth credentials are encrypted in Secure (production), HttpOnly, SameSite=Lax cookies with a maximum 30-day lifetime. OAuth state and PKCE verifier expire after 10 minutes.
- Connections belong to a **browser profile**, not a cloud account. Anyone using that profile can see its connected data. Do not advertise this as a multi-user shared-device login system. Disconnect on shared devices. Use Google account settings to revoke the provider grant; disconnect removes this browser's credentials, not the Google-wide grant.
- Source responses use `Cache-Control: private, no-store` and `Vary: Cookie`. Schoology and Gmail upstream fetches also use no-store. No assignment/email records are written to Prisma. The server necessarily processes the data in memory; this is a web prototype, **not** the business plan's future offline/local-only device.
- Connection mutations require a same-origin request. Credential cookies are authenticated and purpose-bound; no credential is returned by the dashboard endpoint or printed in application logs.
- Public district fetches use a 15-minute cache. The client refreshes private sources about once per minute while visible/online and on returning after a minute. Refreshes are non-overlapping, aborted on unmount, and invalidated before connection changes. No background scheduler is claimed.
- Transient errors retain already displayed source items with a visible warning and their last checked time. Disconnect removes those items rather than keeping them as stale data.
- No new environment variables are required beyond `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. Google may require consent-screen verification/security review for restricted Gmail scopes before broader distribution. Do not work around district access restrictions.

## Verification

`npm test`, `npx tsc --noEmit`, `npm run build`, `git diff --check`.

Tests cover approved hosts / SSRF rejection, iCal unfolding, UID deduplication, canceled entries, DST and date-only handling, unknown dates, recurrence limitations, district HTML extraction, encryption/tampering/expiry, CSRF, and response bounds.

Browser checks use **real public district responses** for news and calendar rendering, desktop/mobile layout, search, original-source dialogs, connection consent and invalid-host errors. Private assignment completion/reload/disconnect UI tests use clearly labeled **mock responses**. An actual student calendar and completed Gmail authorization are still needed for end-to-end private-source validation.
