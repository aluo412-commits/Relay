# Browser course reader — 0.3 selective-reading pilot

See [installation and user-facing boundaries](../extensions/course-reader/README.md). Version 0.2 added opt-in daily collection; 0.3 makes the normal experience automatic and selective, with a dashboard brief rather than a document-selection queue. Manual overrides remain in a collapsed advanced section.

## Selective reading and academic boundaries

`priority.js` is a shared local metadata heuristic, not an LLM classification or proof of importance. Assignments and clearly labeled planning/rule/feedback documents qualify; background/reference resources and ambiguous titles remain description-only. The extension scans course/folder indexes for links but avoids downloading ordinary linked document bodies. Title/description signals can miss important documents; uncertainty and unread coverage remain visible. Older/manual full captures are still local but filtered before automatic AI. Metadata carries its linking-page provenance and cannot be used as a quote from the unread document.

The API rejects description-only and known answer/example materials before a model call. Automatic AI processes only important readable excerpts. Its structured output adds `insight` learning notes for explicit teacher feedback or recommended review topics, not invented student assessments, homework solutions or essay text. Insights have no deadline, remain non-assignment information, and never enter the verified task list. The Overview displays the latest six unreviewed cards as an automatic brief, clearly labeled as drafts; this does not accept them or mutate Schoology.

Submission observations are deterministic and independent of model judgments. Only exact personal status labels on individual Schoology assignment snapshots qualify; conflicting labels remain unknown, and grades/deadlines/buttons never establish status. A linked Turnitin integration is recorded without opening its LTI action or copying its signed URL. Schoology and Turnitin states are independent; a Turnitin link alone is unknown. A directly connected/live Turnitin adapter has **not** been implemented or verified.

## Architecture

- `sync-core.js`: pure Pacific scheduling, safe URL normalization, bounded/deduplicated queues and incremental snapshot rules.
- `sync-read.js`: self-contained isolated-world reader. Same-origin bounded Schoology GETs, inert HTML parsing, no executed source scripts or form actions. Scripts, credential/form controls, navigation and common comments are excluded. Google text export uses normal browser credentials and may follow Google's export redirect; login/export failures remain unread.
- `sync.js`: Chrome alarm checks each minute, after 8 AM Pacific or catch-up on launch. Optional host permission and persisted enabled setting gate all reading. Each short worker invocation saves progress page by page; queue/state survive worker suspension. Browser-session identity prevents closing reused tab IDs after a restart. Extension-owned inactive tabs do not replace user tabs; activated owned tabs are retained. A login failure pauses until manual retry; repeated source failures end a partial sweep instead of hammering the site.
- Source discovery: enrolled course directory → material folders, assignments, course pages, updates; one global own-grade overview. Linked Docs/Slides need extra permission. No roster, submission, assessment launch, arbitrary hosts or external tools. Maximum 40 courses / 240 URLs per sweep, fair course shares, 300 retained 6k excerpts. Unsupported files and capped coverage are explicit. This is not full historical-course coverage, PDF/OCR support or verified grade analytics.
- Local delivery: the exact Relay origin must be open with its separate auto-import flag enabled. Readiness is checked before delivering text. Same-window/same-origin messages receive bounded schema validation and a persistence ACK. No tab is opened/focused for unattended delivery. Manual imports still require a preview dialog. The bridge is **not cryptographic source authentication**: same-origin code already has access to the local workspace, and source facts remain untrusted.
- `readerSync.ts`: validates coverage reports and captures; preserves manual imports and stable source IDs, removes evicted managed sources, rejects stale report/page rollbacks, and invalidates cards when text changes or a source fails. An unread attachment does not invalidate otherwise readable parent instructions.
- `useReaderAutomation.ts`: separate local-import and recurring-AI preferences. AI only runs when Relay is visible/online, not during a running sweep. Cross-tab Web Locks coordinate automatic calls. Batches contain at most five excerpts; successful content fingerprints avoid repeat processing. Up to eight automatic attempts/day inside the existing 12-request server quota; remaining work can span days. Failed versions are not hot-loop retried. Unread sources are excluded, while readable parent instructions with unread attachments can still be analyzed.

## Privacy and consent

Three independent choices: (1) permit extension collection; (2) permit automatic local import into Relay; (3) permit recurring AI uploads. All are off initially. Calendar/Gmail connector data is never silently included in reader AI.

Daily captures persist in `chrome.storage.local`; manual captures use `chrome.storage.session`. Imported excerpts, reports and cards use `relay-course-reader-v1` IndexedDB. Preferences, opaque content fingerprints and automatic usage counters use localStorage. These are unencrypted browser-profile stores, **not school-account isolation or the future offline hardware architecture**. Anyone with this profile can read them; clear both extension and dashboard copies before sharing or switching school accounts. Revoking permissions does not retroactively erase local copies. Pausing collection does not revoke separately enabled AI for already imported content.

AI requests send selected text, titles and source URLs to Relay's server and the configured OpenAI-compatible provider. No school credentials are exported. Provider retention terms apply. The UI names the provider/model, and continuing AI consent uses an opaque server identity bound to Relay user ID + provider host + model. Automatic work rechecks status before a batch; POST rejects a supplied mismatched identity before a provider call or quota reservation. Older manual clients without this field remain compatible.

Server boundaries remain: same origin, Relay authentication, explicit consent, 200 KB request body, 1–8 excerpts, 6,000 chars/page, 32,000 total chars, one provider call, no tools, no retry, 45-second timeout, 4,500 output tokens. Every draft requires a real matching source quote. Dates need explicit year/date evidence, optional work stays optional, and all publication requires human review. Quote matching is not proof of correct interpretation. No homework answers, automatic submissions or messages.

## Database / deployment

Versions 0.2 and 0.3 need **no additional migration**. The 0.1 `ReaderAiBudget` table stores only user ID, Pacific day, request count, short in-flight lease and timestamp. It contains no excerpts, model responses or cards; application logging does not print them.

For an installation that has not applied the additive 0.1 table:

```sh
node scripts/apply-reader-budget.mjs --apply
npx prisma generate
```

Never reset existing tables. PostgreSQL atomically enforces one concurrent request and 12 requests per user/day across serverless instances. Failed/canceled attempts can count. Per-user quotas do not replace signup/abuse controls needed before broad release.

Uses existing provider environment configuration, `AUTH_SECRET`, DATABASE_URL and Google sign-in. No school credentials on Vercel. Rebuild the ZIP after extension edits; the allow-listed, deterministic archive contains eleven source/documentation files and no credentials.

## Verification

```sh
python3 scripts/package-course-reader.py
npm test
npx tsc --noEmit
npm run build
git diff --check
# Local website must be running on port 3002; supply an installed Playwright module if needed.
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/verify-reader-extension.mjs --run
# Optional: real quota DB / one real model call, using a temporary identity + synthetic text.
npx tsx scripts/verify-reader-integration.ts --run --ai
```

The extension integration test loads the actual unpacked extension in a temporary Chrome profile. Schoology/Docs content and AI responses are fixtures; test-only host permissions are pre-granted and initial source-tab navigation is delayed so Playwright can attach fixture routing. It verifies multi-course discovery, nested folders, linked exports, unread-file notices, local automatic imports, separate AI consent, incremental changes, stale cards, pause, expired login, persisted preferences and mobile overflow. It does **not** establish native host-consent UI behavior, district policy approval or successful reading of the student's live courses. Temporary test profiles are deleted. The 0.3 test additionally verifies that a reference Google document is never fetched, its description never enters an AI request, the automatic brief appears without selecting documents, and an explicit Schoology Submitted label does not become a Turnitin Submitted claim.

Unit coverage includes Pacific/DST catch-up, path restrictions, queue deduplication/limits, library-vs-AI payload bounds, stable IDs, changed/failed-source invalidation and version-aware AI batching, alongside the original evidence/date/security tests. Real provider tests use synthetic text only. The student's permitted account is still needed to verify actual Schoology layouts and Google export behavior.
