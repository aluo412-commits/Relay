# Guided school setup — reader 0.8

The [optional Lynbrook public-page reader](lynbrook-website-reader.md) is separate from this course wizard. It needs pairing and explicit preview/import, not daily reading or AI permission.

PDF homework lists now use [one explicit source per course](schoology-access-and-discovery.md), selected in the extension after the first course discovery. No AI/keyword hunt for the list; official API authorization is a separate, not-yet-connected integration.

See [0.6 reliability changes](reader-reliability.md): persistent setup completion, reversible hide/restore, stable checkmarks, temporal safeguards, optional PDF text, and per-course reading gaps.

## Student journey

The website now renders **one wizard step at a time**, not a five-section instruction page. Continue/Back control progression; only the current step exists in the rendered wizard. Extension installation is further split into download, Chrome settings, and folder-loading screens. Actual extension detection/pairing gates progress; clicking through instructions does not establish installation. The current step survives reload within the same account/session, and Back does not reset permissions. AI can be explicitly skipped with Keep text local. Coverage, optional connectors and privacy explanations are collapsed outside the wizard.

1. Sign into Relay. Choose a specific school, not only a district. Seven quick picks have curated school websites and the supported FUHSD/PAUSD Schoology portal.
2. **Setup & connections → Automatically import daily snapshots.** This explicitly enables account-local import, not AI. The extension's initial Enable daily reading operation now checks that a paired, open Relay tab is ready to receive results. A direct runtime request cannot bypass this check.
3. Download/unzip reader 0.8; open `chrome://extensions`; Developer mode → Load unpacked → extracted `relay-course-reader` folder. Existing users replace the original files and Reload, rather than installing a duplicate. Reload Relay after installing/updating. Open the puzzle-piece menu, pin the reader, and pair the displayed Relay account.
4. Open the exact course portal linked in Relay and the extension. Complete school SSO/MFA there. Enable read-only collection and use Sync now. Linked Google documents retain separate optional host access. Once enabled, collection can still run while Chrome runs and the website is closed; delivery waits for the website.
5. Separately enable **Automatically analyze new or changed excerpts** if permitted by the course's AI rules. The provider/model, recurring upload scope, limits and retention caveat are visible. Keep Relay visible/online. No routine document selection is needed. Unchecked means no automatic AI assignments, not a broken sync.
6. See unreviewed assignment/event drafts directly in **Assignments** and the Overview brief. Drafts remain separate from the accepted board and do not imply submission or verified deadlines. Policy and feedback cards remain information rather than homework tasks.

The compact dashboard status and current wizard step distinguish website not ready, extension not detected, pairing needed, school login required, reading in progress, text received with AI off, provider unavailable, analysis running, quota/deferred work, unread-only sources, and available drafts. Zero results never means zero homework. Calendar/Gmail/district connectors are optional extras rather than competing setup buttons.

## School directory versus reader support

`GET /api/student/schools` searches the actual NCES federal **2024–25 Public School Locations** service:

https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2425/MapServer/0

The service and seven campus identifiers were checked with real public queries. Name/city search with optional state returns at most 20 records; broad queries explicitly show truncation. This is US public-school directory data, not live enrollment, a global directory, or private course access. School/city query text is sent to NCES through Relay; no student course data or Relay cookies are forwarded. Lookup requires Relay login, has a 9-second timeout, a 256 KB body bound, fixed upstream origin, no redirects, and public-response caching up to 15 minutes. A bounded per-instance request guard is best effort, not distributed abuse protection. Failures stay visible; no invented directory entries.

That NCES dataset does **not** provide campus website or LMS URLs. Only curated quick picks have supplied website/portal links. Other results link to the official NCES record and offer manual website/portal entry. Private/international schools and other LMS platforms can also be entered as HTTPS links. Those addresses are not fetched by Relay and do not expand the extension allow-list. Query tokens, credentials, ports, non-HTTPS and local/IP addresses are rejected. User-supplied links are not verified school identities.

Choosing an unsupported school clears the account's active district routing with a same-origin, session-bound revision check. This invalidates the previous paired reader and connector context rather than silently continuing it under a new school label. Old encrypted libraries remain separate and can be reopened after returning to the original supported district. School/link preferences are account-namespaced on this browser, not a new cloud library. No schema migration is needed for 0.5.

## Extension status bridge

A small isolated content script runs only on `https://relay.aaronluo.com/*`, top frame. It accepts nonce/binding-checked same-window status requests. The background validates the actual signed-in account and returns version, pairing, enabled state, readiness and bounded sweep status—not source text, credentials, encryption keys or another account's data. Website-origin messages cannot pair, enable, read, delete or request permissions. The bridge is bounded transport, not cryptographic source authentication. A timeout says "not detected," never "installed" based on a checkbox. Existing school URL and path allow-lists are unchanged.

Manual capture is still available as **Advanced · local preview of one page**. It explicitly does not imply import or AI analysis. Turning off imports does not revoke already enabled extension collection; pause/revoke controls remain in the extension.

## Validation

- `npm test`, `npx tsc --noEmit`, `npm run build`, extension JS syntax checks and ZIP packaging.
- `scripts/verify-setup-ui.mjs --run`: synthetic account/directory fixtures for school choice, exact links, installation instructions, next-action focus, separate consent, unsupported school transitions and mobile layout.
- `scripts/verify-reader-extension.mjs --run` and `--pausd`: actual unpacked extension with synthetic school/account/AI fixtures. Checks preflight rejection before any school reads, real status bridge, automatic import, explicit AI consent, draft visibility in Assignments, account isolation and prior reader regressions. Native optional-host prompts and actual school accounts remain unverified.
- `scripts/verify-student-accounts.ts --run --browser --directory`: temporary real Relay accounts, authenticated API isolation, unsupported-school reset, native extension-cookie behavior, and real public NCES lookup. `--production` explicitly runs against the deployment. Test identities are deleted afterward. No school or Gmail credentials are used.

Full live PAUSD/FUHSD course compatibility, PDF interiors, direct Turnitin, generic Canvas/Moodle readers, public PAUSD news/calendar and cross-device course libraries are still not claimed.
