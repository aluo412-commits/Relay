# Browser course reader pilot

## Why this exists

The Schoology review session showed that homework lives in assignment pages, course folders, syllabi, PDFs and external Google Slides—not just calendar entries. The new reader adds a deliberately narrow, user-driven capture path without exporting school passwords/cookies or giving a hosted browser unattended account access.

This is a **first text-reading prototype**, not parity with that long agent session. PDF interiors, scanned worksheets, grade projections, recursive course traversal and continuous sync remain out of scope.

## Try it

Download https://relay.aaronluo.com/downloads/relay-course-reader.zip, unzip, and load the `relay-course-reader` folder using Chrome desktop's `chrome://extensions` → Developer mode → Load unpacked. This is not a Web Store release. Respect school/device extension policies.

Open a signed-in `fuhsd.schoology.com` assignment/course page or a Google Doc/Slides you are allowed to access. Open the extension → **Read this page** → preview → **Review selected pages in Relay**. Confirm the import in Relay's dialog. In **Connections**, choose imported excerpts and, optionally, consent to AI analysis. Add each resulting draft to the board only after checking its evidence and date.

Both capture and AI operate on excerpts, not a complete course. Explicit warnings identify truncation and unread PDF/file wrappers. A linked URL is never treated as content that has been read.

## Data and permission boundaries

1. **Read:** `activeTab` + `scripting`, following a user gesture. Self-contained `capture.js` runs in Chrome's isolated world. Login/SSO, submission and external-tool URLs are refused. Scripts, credential/form controls, navigation and common comment elements are excluded. Plain text inside a form is retained, because some Schoology layouts wrap ordinary course content in forms. No cookies API, history, webRequest, broad host access, or remote executable code.
2. **Stage:** up to 8 pages, 6,000 text characters each, in `chrome.storage.session`. Clearing Relay does not clear this staging buffer; the extension has its own Clear all control. Restarting the browser ends session storage.
3. **Handoff:** a script on the exact Relay origin delivers a bounded `window.postMessage` capture to the top-level app. The receiver checks same-window/same-origin, validates a strict allow-listed schema, and opens a review dialog. It never automatically saves, posts to an API, calls AI, or publishes cards. The handoff is an import transport, **not cryptographic proof of source authenticity**. Other code with access to the Relay origin could present an import; human approval and normal source validation still apply.
4. **Local save:** approved excerpts and cards live in `relay-course-reader-v1` IndexedDB in this browser profile. Not encrypted on-device; anyone with this profile can read them. No claim of a shared-device login boundary. Sources and content are not stored in Relay's database. Clear local reader data on shared machines.
5. **Optional AI:** only after explicit consent, selected text is sent to `/api/student/analyze` and the configured OpenAI-compatible provider. The UI names the provider host and model. Provider retention terms apply. A Relay login is required, separately from Schoology/Gmail authorization. Calendar/email connector data is not silently included. Body limit 200 KB; 1–8 pages, max 6,000 chars per page, max 32,000 total; one provider call, no tools, retries disabled, 45-second provider timeout, 4,500 output tokens.
6. **Evidence / review:** provider output is treated as untrusted structured data. Every draft needs a matching source ID and a verbatim supporting quote in captured text. Dates require their own quote and an explicit ISO or English named-month date including year; ambiguous/relative dates remain null. This verifies a quote match, not the correctness of the interpretation. Every card remains a draft until the student confirms source, requirement and date. Optional work remains explicitly optional. Policy cards stay in the reader, not the homework list. No automatic submissions, grade changes, academic answer writing or messages.
7. **Change handling:** new text at the same source URL invalidates existing cards. Stale cards disappear from the active board until re-analyzed/reviewed. Changing capture time alone does not invalidate unchanged text. In-flight responses are ignored after cancellation or source removal. Cancel means stop waiting; already-started provider work may still consume quota.

Google Docs/Slides capture uses the active document's text export with the browser's existing credentials. Those credentials never enter the payload. Export restrictions/login failures fail visibly. Comments, images, document tabs and layout may be absent; no bypass is attempted.

## AI usage table and deployment

The new `ReaderAiBudget` table holds only user ID, Pacific calendar day, request count, a short in-flight lease, and an update timestamp. It has a cascading foreign key to the existing User. No excerpts, quotes, generated cards or provider responses are persisted server-side, and application logging does not print them.

Before deploying, apply the **additive, non-destructive** SQL once:

```sh
node scripts/apply-reader-budget.mjs --apply
npx prisma generate
```

This uses the project's configured DATABASE_URL (loaded via Next's env loader). It creates only the new usage table; do not run db reset or a force-reset schema push. If unavailable, AI fails closed; local capture and public sources still work.

Atomic PostgreSQL `INSERT … ON CONFLICT … WHERE … RETURNING` enforces at most one concurrent request and 12 requests per user per Pacific day across serverless instances. Failed/canceled attempts may count. Requests are authenticated through the existing signed Relay session, checked for same origin and explicit consent before reserving budget. Refreshing the page/new tabs cannot reset quota. This is per-user usage control, not a substitute for wider signup/abuse controls before public-scale release.

Uses the existing `LLM_API_KEY`/provider fallback variables, `LLM_BASE_URL`, `LLM_MODEL`, `AUTH_SECRET` and Google login configuration. No school credentials are required on Vercel.

## Build / test

```sh
python3 scripts/package-course-reader.py  # rebuild the committed download after extension edits
npm test
npx tsc --noEmit
npm run build
npx tsx scripts/verify-reader-integration.ts --run       # explicit temporary test identity + real quota DB checks
npx tsx scripts/verify-reader-integration.ts --run --ai  # also one REAL provider call using ONLY synthetic course text
```

The packager allow-lists the seven extension files and produces a deterministic ZIP. No dependencies or credentials are bundled. Chrome developer options support optional localhost:3002 permission for testing; the default target is production.

Validation performed during development:
- Unit tests: URL/path and payload boundaries, quote validation, explicit-date grounding, optional-work preservation, draft-only behavior, recapture invalidation, minimal manifest permissions.
- Browser tests: the actual capture function against a **mock Schoology DOM**; credential controls/scripts excluded, safe links only. Local handoff, import consent, IndexedDB reload, separate AI consent, draft-before-board, and stale-card removal with **mock AI responses**. These are not real account integration tests.
- Database integration: atomic concurrency, daily cap, next-day reset with a temporary test user, deleted afterward along with its usage metadata.
- Real model integration: actual configured provider returned evidence-linked drafts for a **synthetic fixture**, without publishing cards.
- Actual unpacked-extension installation and authenticated Schoology/Google Docs capture must still be tried by the user on their permitted browser/account. No claim that an entire live course, PDF or gradebook has been imported.
