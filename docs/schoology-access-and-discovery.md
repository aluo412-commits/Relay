# Schoology access research and reader 0.7

## Authorization: feasible implementation, not an established connection

Relay has **not** completed an official Schoology OAuth authorization in this work. No new OAuth connector/button is presented as connected, no third-party credentials were reused, and no school cookies or passwords were requested/exported. Local `.env*` files contained no `SCHOOLOGY_*` configuration; production environment presence was not checked. No private school endpoint was probed during research.

Official sources checked:
- https://developers.schoology.com/api-documentation/authentication/
- https://developers.schoology.com/api-documentation/important-api-authentication-update/
- https://developers.schoology.com/api-documentation/rest-api-v1/

The documented flow is OAuth 1.0: consumer key/secret → request token → selected school's `/oauth/authorize` → user approval → access token → signed API GETs. This is not Google login, nor browser-cookie export. Schoology currently documents a maximum **90-day access-token lifetime**, followed by reauthorization.

Crucially, the official security update effective **June 25, 2025** says personal API keys cannot access other users' data; unapproved apps attempting cross-school access receive 401. App Center approval requirements remain. An unpublished/school-only app's same-school access is not evidence that a FUHSD+PAUSD public Relay integration is approved. A user's willingness to authorize cannot create missing application credentials or override school policy.

An eventual connector requires Relay's own approved credentials and a permitted test account. Requirements before shipping: session/account/district-bound expiring state, token comparison before exchange, server-only encrypted secrets, current binding recheck after exchange, observed user/school verification (not merely trusting the selected hostname), GET-only self/enrolled-course allowlist, bounded pagination/timeouts, no arbitrary UID access, token expiration/revocation handling, separate API-data consent and truthful disclosure of server processing. The existing local-reader permission does not silently authorize that new data flow. Academic analysis remains separate permission. No write/submission endpoint should be exposed.

## Public repositories inspected (not installed or executed)

| Source | Observed approach | Useful finding / limit |
| --- | --- | --- |
| [33tm/Gradar](https://github.com/33tm/Gradar), `e323133` | OAuth1; `/app-user-info`, own sections/grades, grade items/scales | Confirms the older Gunn One-related API architecture; does not establish current One internals or Relay approval. |
| [ErikBoesen/schoolopy](https://github.com/ErikBoesen/schoolopy), `a168f97` | Two-/three-legged API client | README distinguishes personal API keys from multi-user authorization and warns some endpoints no longer work. |
| [aopell/SchoologyPlus](https://github.com/aopell/SchoologyPlus), `85e2e86` | Browser extension over Schoology UI | Structural attachment selectors, rather than an LLM guessing content. Its broad features/permissions are not adopted. |
| [dawoodhq/schoology-export](https://github.com/dawoodhq/schoology-export), `1b438a7` | Materials rows, folders, embedded pages and PDF viewer metadata | `type-document`, `attachments-file-name`, `docviewer-iframe`, JSON `custom.downloadLink` explain a wrapper→viewer→file chain. Its remote-eval bookmarklet, bulk download and click-all-folders approach are **not** used. No source files were copied into Relay. |
| [riripatate/schoology-mcp](https://github.com/riripatate/schoology-mcp), `316d4fd` | Headless login/session-cookie capture; HTTP client | “No admin API keys” does not mean official OAuth authorization. Not adopted: Relay does not ask for school passwords or export sessions to a server/MCP process. SSO support claims were not verified against PAUSD/FUHSD. Its actual HTTP client constructs `https://<domain>/api/v1` with an exported Cookie header; its SAML detection falls through to native login handling and 401 reauthentication has no visible retry bound. Do not mistake its README claims for a working supported connector. |
| [33tm/schoology-socket-auth](https://github.com/33tm/schoology-socket-auth) | Old localhost Socket.IO OAuth handoff prototype | Not a drop-in hosted connector or proof of present-day authorization. |

[Current One repository](https://github.com/33tm/One) publishes an introduction and theme palettes, not the complete current application implementation. Public repo availability is not permission to reuse another application's keys.

## Confirmed Relay implementation gaps

1. Reader 0.6 only considered literal file links/embeds. A `docviewer-iframe` containing JSON metadata for the actual PDF was not resolved. Parsing a PDF cannot help if the file was never reached.
2. Discovery enumerated anchors but not embedded Google document frames.
3. Index metadata could replace previously read text; a newly read wrapper could also be overwritten by a later index description, causing false “changed” counts.
4. Collapsed folders with no navigable link were not explicitly reported as a discovery gap.
5. Enabling reading can still be handing off an old snapshot when the student immediately clicks Sync now; the old implementation rejected that request instead of waiting briefly.

These are code-level findings and synthetic reproductions, **not proof of the student's actual math source layout**.

## 0.7 behavior

- **No automatic keyword-based PDF homework-list hunting.** In the extension, after the first course check: Pause → choose the discovered course → save its ordinary Schoology materials/individual resource-page URL. Enable selected-source PDF reading and resume/Sync now. One explicit source per course; PDF bytes are never fetched on unselected jobs.
- Pins must match that course's path in the selected district. Reject other courses, foreign hosts, credentials, token-bearing URLs, invalid/duplicate folder parameters, submission/assessment routes and direct signed download links. The extension stores choices inside the existing account-encrypted vault. Pairing/cache deletion clears this cache and its choices; website libraries stay separate. Website status messages still cannot mutate collection or pin sources.
- For the chosen page, resolve at most two **same-origin `/docviewer/…`** iframe metadata pages, <=512 KB each, using normal session access and no redirects. Read bounded `custom` JSON string data only; do not execute scripts, remove comment restrictions, launch tools or automatically expand folders.
- A single resolved PDF is read (2 MB, first 20 pages, local existing PDF.js parser). Several files are an ambiguity, **not a ranking contest**. Only selected-school / previously approved Schoology CDN file URLs qualify; normal CORS and access rules apply. No new host, cookies, debugger, or all-sites permission. Signed file URLs stay transient inside the source reader and do not enter stored snapshots, website payloads, or model input.
- Derived text is marked `selectedSource`. Recurring AI no longer picks old keyword-discovered PDF excerpts without that marker. Existing cards are retained; manually requesting analysis of previously saved readable text still uses its separate consent. Selection itself is not proof that the document is current, required, complete, or date-correct.
- Ordinary HTML assignments/course discovery retain bounded deterministic metadata triage. Embedded Docs/Slides are now discoverable, but their separate Google grant and importance/answer-material policies still apply. No Google Sheets, OCR, external tools, new school adapters or API access is implied.
- Preserve prior body/wrapper text and its original timestamp when only index metadata is seen. Report unlinked collapsed folders rather than inferring complete discovery. Sync now briefly waits for an in-flight handoff, then rechecks account and reading permission.

## Verification and rollout

No SQL migration or OAuth credentials needed for these reader fixes. Extension version **0.7.0**, 21-file reproducible ZIP. Update the original unpacked folder and Reload; website refresh alone cannot change an installed 0.6 reader.

- Unit tests: source URL binding, metadata-vs-body precedence, existing date/action/account guards, old unselected PDF excluded from automatic analysis.
- `scripts/verify-reader-discovery.mjs --run`: isolated synthetic page/iframe/JSON/file structures; no script execution, no signed-token leakage, no foreign/redirect fetch, ambiguous files not guessed, known identity checked before deeper reads, Docs discovery and folder gaps.
- `scripts/verify-reader-extension.mjs --run [--pausd]`: actual unpacked extension; initial sweep fetches **no** PDFs despite PDF option being on; explicit source selection resolves a synthetic Schoology viewer and parses a real synthetic PDF locally. Existing account isolation, setup, consent, reversible task actions and incremental changes remain covered.
- These fixtures do not validate native optional-host permission UI, real student SSO, official OAuth, or the real math document. A normal source-page URL or consented course reading report is still needed for that verification. Never request private export tokens, passwords or cookies in chat.
