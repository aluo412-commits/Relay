# Relay Course Reader — 0.3 selective-reading pilot

## Install / update

1. Unzip https://relay.aaronluo.com/downloads/relay-course-reader.zip.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `relay-course-reader` folder containing `manifest.json`.
3. Already installed? Replace the files in your original extension folder and click **Reload** in Chrome. Do not install a second copy.
4. Pin **Relay Course Reader — Pilot** from Chrome's extensions menu.

This is an inspectable prototype, not a Chrome Web Store release. Respect school/device extension policies.

## Enable daily reading

1. Sign into https://fuhsd.schoology.com yourself. Never provide passwords, MFA codes or session cookies to Relay.
2. Open the extension. Review the permission checkbox and click **Enable daily reading**. Approve Chrome's optional Schoology site permission. Reading linked Google Docs/Slides is a separate optional site permission.
3. Open https://relay.aaronluo.com/?reader=import. Turn on **Automatically import daily snapshots**. Allow about a minute for the report to arrive.
4. Optionally sign into Relay and enable **Automatically analyze new or changed excerpts**. This separate permission sends saved course text, titles and source URLs to Relay's server and the displayed AI provider. Provider retention terms apply. Draft cards still need review before joining the board.

Checks run after 8 AM Pacific or catch up when Chrome next runs. The browser must be running and the school session valid. Relay itself need not stay open for collection. Open Relay to receive results; automatic AI runs only while the dashboard is visible and online. **Sync now** starts an immediate sweep. **Pause** stops further reads; re-enable to resume an unfinished sweep. After an expired login, sign in and choose Sync now.

## Automatic, not a document-selection queue

After the one-time collection/import/AI permissions, no document selection is required. Relay uses local title/description signals to prioritize assignment instructions, syllabi, calendars, rubrics, lab instructions and feedback. The LLM then extracts source-backed requirements and learning notes from the readable important excerpts. This first priority router is a heuristic, not an AI verdict about unseen contents; ambiguous titles stay explicitly unverified.

Other linked resources are retained as descriptions from their linking page, without downloading their document bodies just to classify them. Course/folder indexes still have to be read to discover links. Previously captured or manually opened documents can still exist locally; automatic AI now filters them by importance. Manual tools remain optional and collapsed in Relay.

The Overview automatically shows a concise course brief without making the student select sources or accept every card first. These are labeled AI drafts, not verified assignments or Schoology mutations. Requirements, dates, rules and source-grounded learning notes only—no answers, worked solutions, generated essay wording or answer-revealing hints. Known answer/example materials and description-only records are excluded from model extraction.

Submission checks only recognize explicit personal status labels in individual Schoology assignment snapshots. A linked Turnitin tool alone yields **unknown**; Schoology submission does not prove Turnitin submission, and grades/dates do not prove missing work. No direct authenticated Turnitin connector or automatic LTI launch is implemented. Observations include their source, evidence and read time and never mark work done automatically.

## What is read

The reader discovers enrolled courses from Schoology's course directory, then follows allow-listed material folders, assignment pages, course pages and updates. It also reads the student's global grade overview as text—not verified submission states or grade projections. With additional permission it reads linked Google Docs/Slides text exports. It never follows roster, submission, quiz-launch or external-tool actions.

This is a bounded **text sweep**, not a guarantee of every item in Schoology:
- Up to 40 discovered courses, 240 URLs per sweep with a per-course fair share, 300 retained excerpts, and 6,000 characters per excerpt. New/oldest cached links get priority; limits are reported.
- PDF interiors, images, external tools, unsupported links and dynamic-only content are not read. Unread notices and truncation warnings remain visible. A file wrapper is not its attachment's content.
- No access-control, export restriction, SSO or MFA bypass. Course discovery and live school layouts still require validation on the user's permitted account.
- Only GET reads. No homework submissions, messages, grade changes or generated graded answers. Normal source access may be recorded by Schoology. Follow course AI-use policies.

## Data and permissions

Daily settings, queue, coverage and excerpts persist in **Chrome local storage**, not Chrome sync or Relay's database. Manual single-page capture remains under **Read one page manually**, staging up to 8 pages in Chrome session storage and requiring import confirmation.

Relay stores imported excerpts and cards in browser IndexedDB. Neither local store is encrypted by this prototype. They belong to a browser profile, not a school-user identity: use a personal profile and clear both stores before sharing or switching school accounts.

- `activeTab`, `scripting`: manual capture and explicitly authorized isolated-world reading/delivery.
- `storage`, `alarms`: local storage and resumable daily scheduling.
- Required host: only `https://relay.aaronluo.com/*` for local delivery.
- Optional hosts: Schoology and Google Docs for daily reading; localhost:3002 for manual development tests.
- No cookies API, history, webRequest, all-sites, Drive-wide or remote executable-code permission. Browser credentials are used normally by the source tab and are never exported.
- Collection uses extension-owned inactive tabs, without navigating user tabs. Unused owned tabs are closed; a tab the user activates is retained.

Turn off automatic imports in Relay to stop automatic imports and future automatic AI there. Pause reading in the extension separately. **Delete synced data & revoke access** removes the extension's daily data and site grants; clear manual captures separately. **Clear reader data** removes Relay's local copy and disables its automation. Copies in the other location are not automatically erased. Requests already sent may finish.

AI: at most 5 excerpts per automatic request and 8 automatic requests per Pacific day, within the server-enforced shared 12-request account quota. Queued excerpts can span multiple days. Successful unchanged versions are not re-analyzed; failures do not trigger rapid retries. Recurring permission is bound to the Relay account and displayed provider/model. No automatic card publication.

Source and implementation details: https://github.com/aluo412-commits/Relay/tree/main/extensions/course-reader
