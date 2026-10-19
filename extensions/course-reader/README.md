# Relay Course Reader — 0.6 homework coverage / reliability pilot

Current changes and limits: https://github.com/aluo412-commits/Relay/blob/main/docs/reader-reliability.md

For PDF homework lists: update this extension, Reload, then Pause daily reading, enable **Read important linked PDF homework lists/calendars**, and enable reading again. Use Sync now. This is optional local text parsing, not OCR; AI still requires its separate website permission.

## Install or update

1. Download https://relay.aaronluo.com/downloads/relay-course-reader.zip and unzip it.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
3. Updating? Replace the files in the original extension folder, then click **Reload**. Do not install a second copy.

This is an inspectable unpacked prototype, not a Chrome Web Store release. Follow school/device extension policies.

## One-time setup

1. Sign into https://relay.aaronluo.com and choose your **school**. Quick picks have supported FUHSD/PAUSD portals; NCES US public-school search and custom school links are also available, but other portals are explicitly unsupported. This is your Relay account, not a school-password form. In **Setup & connections**, first enable **Automatically import daily snapshots** and keep Relay open.
2. Sign into your selected school's official site yourself:
   - FUHSD: https://fuhsd.schoology.com
   - PAUSD: https://pausd.schoology.com (ClassLink login)
3. Open the extension and click **Pair current Relay account**. Confirm the displayed account/district and that the school login belongs to you. Pairing replaces the extension cache, not saved account libraries on the website.
4. Review the daily-reading permission and click **Enable daily reading**. Chrome asks only for the selected school's host. Linked Google Docs/Slides need separate optional access.
5. Use **Sync now** for the first sweep. Back in Relay, optionally grant separate **automatic AI** permission. Reading only saves text; it does not analyze assignments. With AI permitted, keep the dashboard visible and online; new drafts appear directly in **Assignments**. No document-by-document selection is needed. The colored setup card explains the next required action.

Reload Relay after installing/updating so it can detect the extension. The initial Enable daily reading operation is blocked until the website is ready for local import in the paired account. A website-only status bridge reports pairing and progress; it cannot start reads or grant permissions.

After 8 AM Pacific, or next time Chrome runs, the extension checks courses. Chrome and the Relay/school sessions must remain valid; Relay's webpage need not stay open for collection. Open it to receive snapshots. AI runs only while the dashboard is visible and online. Signing out, signing in again or changing accounts/districts invalidates pairing. A school-login fingerprint change pauses reading when the layout exposes that identity. If it cannot be verified, a warning is shown: use a personal browser profile and confirm the school login before pairing.

## Selective, read-only collection

The extension discovers enrolled courses and follows allow-listed material folders, assignments, pages and updates. It reads the student's grade overview as text, not as verified submission states or grade projections. No roster, submission, assessment-launch or arbitrary external-tool actions are followed.

Local title/description signals prioritize instructions, syllabi, calendars, rubrics, labs and feedback. The LLM organizes readable important excerpts into an automatic dashboard brief. Ordinary/ambiguous linked resources remain descriptions from their linking pages, without fetching document bodies just to classify them. Priority routing is a heuristic and can miss important material; uncertainty stays visible. Old/manual captures can remain locally but are filtered before automatic AI.

- Up to 40 courses / 240 URLs per sweep, fair shares per course; 300 retained excerpts, 6,000 characters each. Long text can be split into up to eight excerpts. Limits are reported.
- Optional PDF text: selected-school / approved Schoology CDN links only, up to two files/source page, 2 MB/file and first 20 pages. Parsed locally with bundled PDF.js; no scripts, forms, OCR or password bypass. Scans, inaccessible links, images and external tools remain unread. A wrapper is still not its file's contents.
- No login/MFA/export-policy bypass. Real school layouts still need validation on the permitted student's account.
- Requirements, planning and source-grounded learning notes only: no coursework answers, solutions or generated submission text. AI drafts are not verified tasks and never submit work.
- Only explicit personal status labels in individual assignment snapshots become observations. Turnitin and Schoology are separate; a Turnitin link alone means unknown. A direct live Turnitin connector is not implemented.

## Dates and task controls

Source-relative dates never become today/tomorrow based on read time. Old/closed and undated instructions have separate views. Hide is reversible: use Undo or Hidden → Restore. Checkmarks stay visible and mean done in Relay only; source changes keep them with a review warning. Finished setup does not repeat automatically. Refresh all Relay tabs to use the new encrypted workspace format; owned older data is copied, not deleted.

## Account privacy

New extension snapshots, manual captures and queue state are encrypted in Chrome local storage. New website libraries are encrypted in separate account/district IndexedDB stores. Decryption keys come from the authenticated account endpoint and are not saved in browser storage. No course text is stored in Relay's database or synchronized across devices. Account/district preference and AI usage metadata are stored server-side.

Old unassigned plaintext browser captures and global connector cookies are not silently claimed by a new account. Pairing clears old extension captures; old website stores remain unassigned and may still be plaintext on disk. Clear legacy data before sharing a device. Application isolation does not protect against someone using an already signed-in session, malware or browser administrator access; sign out of both Relay and school services and use separate browser profiles.

Pause collection in the extension. Turn off imports/automatic AI separately on the website. **Delete synced data & revoke access** removes the paired extension cache and site grants; clear manual captures separately. **Clear reader data** removes that account/district's website copy and disables its automation. Requests already started may finish.

## Permissions / AI

Required: `activeTab`, `scripting`, `storage`, `alarms`, `offscreen` (local PDF parsing), and Relay host access for authenticated account checks and local handoff. Optional: only FUHSD Schoology, PAUSD Schoology, and Google Docs. No cookies API, history, webRequest, all-sites access or remote executable code. Browser credentials accompany normal allowed requests; passwords/session cookies are never exported.

Collection uses extension-owned inactive tabs and leaves activated/adopted tabs open. Manual reading remains an optional advanced tool, bound to the paired account/district.

AI is separate consent: selected important text, titles and source URLs go to Relay's server and the named provider; provider retention terms apply. Up to five excerpts per automatic request and eight automatic attempts/day inside the shared server-enforced 12-request user quota. Queues can span days. Successful unchanged versions are not repeatedly analyzed. Consent is bound to the account/session/district and provider/model.

Step-by-step setup and directory limitations: https://github.com/aluo412-commits/Relay/blob/main/docs/student-setup.md

Source and security details: https://github.com/aluo412-commits/Relay/blob/main/docs/student-accounts.md
