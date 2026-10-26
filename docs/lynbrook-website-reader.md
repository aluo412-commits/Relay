# Reader 0.8: Lynbrook public website snapshots

## Why this is separate

The existing district adapter reads `fuhsd.org`, not `lhs.fuhsd.org`. Choosing Lynbrook previously saved its URL but did not connect a campus reader. Schoology OAuth and PDF fixes do not provide campus website coverage.

A plain server request to the Lynbrook homepage returned HTTP 403, `server: cloudflare`, `error code: 1010`. This did **not** establish that normal browsers cannot read it. A fresh ordinary Chrome session subsequently returned HTTP 200 and the new reader extracted public homepage text. No user-agent spoofing, stealth plugin, cookie export, verification bypass or private school login was used.

## What ships

A manual, user-invoked **Read Lynbrook page** action in extension **0.8.0**. Uses the existing `activeTab` and isolated-world scripting permission. No extra hosts, cookie API, content script, recurring schedule or server fetch is added. It does not run because a page merely opens.

In Relay, choose **Lynbrook High School**, then pair the extension with that FUHSD account. Open a public Lynbrook page in normal desktop Chrome and use the action. Review selected Lynbrook captures separately from course captures, send them to Relay, and confirm the school import. Daily course reading, automatic import and AI may all remain off. Refresh the website after updating the extension; a website refresh alone cannot update an old unpacked extension.

- Only HTTPS `lhs.fuhsd.org`, without credentials, explicit nonstandard ports, query strings, private/login/admin routes or file downloads. Other campuses are not silently enabled.
- Read rendered main content or a **public Finalsite news dialog the user already opened**. No automatic clicks, scrolling to unlock content, expanded folders or traversal. News dialogs must match exactly one ordinary public source link by the publisher's article title; ambiguous/missing matches fail rather than guessing provenance.
- Finalsite's direct `/news/~board/…/post/…` URL may display only a listing. To capture an article, open **Read More** normally and wait for its text. Listing captures are labeled as headlines/summaries, not article bodies. An empty/loading dialog fails instead of substituting the background listing.
- Exclude forms/inputs, scripts, hidden content, navigation, embedded documents and known login/challenge UI. Browser verification is left to the user. The reader is not a mechanism for accessing protected content.
- At most 6,000 characters, a bounded 15,000-node DOM scan, 30 same-school links; truncation and unread material are reported. Manual extension buffer remains eight pages. Reading does not fetch linked pages, attachments, external references or embedded calendars.
- Import into a separate **School updates** panel, ahead of district updates, with capture timestamp and a >24-hour-old warning. No claim of complete or live coverage. The general website Refresh button does not re-read campus pages.
- No campus text is included in the course library, AI requests, tasks, deadlines or personal calendar. Dates remain literal source text. This release does not extract structured calendar events or implement automatic campus refresh/RSS subscriptions.

## Account, storage and permissions

The existing encrypted extension preview cache holds manual captures. Pairing/clearing it does not delete website copies. The new website database is **`relay-school-reader-v1:<scope>`**, store `snapshots`, encrypted record `current`, AAD `school:<scope>`, using the existing account/district key. Limit: 20 pages; a newer capture replaces the same URL, and older captures cannot roll it back. No SQL migration or cloud text storage.

A separate database prevents an older course-reader tab from dropping new campus state. Only the verified FUHSD account with the curated `lynbrook-high` campus selected accepts/displays these messages. School/account changes dismiss pending imports; scope/binding mismatch messages are ignored. Current-account rechecks in the extension and generation checks in the website discard late results. Web Locks serialize same-account campus changes across tabs. Account changes hide other libraries; choosing another FUHSD campus hides Lynbrook snapshots without deleting them.

Manual import uses same-window/same-origin `relay.school.capture` / `relay.school.received` messages and `data-relay-school-reader-ready`. This is bounded transport, not cryptographic publisher authentication. Source wording remains untrusted plain text. Course/API URL validation still rejects Lynbrook URLs. A normal website content script cannot invoke the extension's capture/mutation commands through its status-only bridge.

Remove a snapshot with confirmation in School updates. Course-library clearing is separate. Removing an extension preview, a website copy or a permission is not retroactive deletion of other copies. Existing signed-in-device and same-origin-script risks still apply.

## Verification

- Unit tests for allowlisted URLs, separate capture types, campus gating, bounded import and rollback rejection.
- `scripts/verify-school-reader.mjs --run`: actual unpacked Chrome extension, synthetic school/account fixtures; capture/preview/confirmation, no AI or hidden crawl, challenge/login rejection, hidden/form/script/token exclusion, Finalsite dialog provenance, encryption, persistence/removal, campus/account switches, late message rejection and 375/768/1440px overflow checks. The temporary test manifest pre-grants LHS; native toolbar `activeTab` grant UX is **not** exercised.
- Live **anonymous public DOM** checks (not a student session): homepage returned 200 and yielded 1,659 characters / three school links; `/news` yielded 307 characters of listings; opening the real “Lynbrook Ranked Top 10 High School in California” Read More dialog yielded 630 characters of article text with its matched source URL. These observations are not a permanent site-format or completeness guarantee.
- Live student-profile import, every campus page, dynamic/embedded calendars and native permission interaction remain unverified. No private student data or school credential was used for these tests.
