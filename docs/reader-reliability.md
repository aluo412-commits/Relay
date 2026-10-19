# Reader 0.6 — dates, reversible actions, and homework-list coverage

## Bugs addressed

- Old AI cards could copy “tomorrow” into a title even when no grounded date was accepted. The brief then displayed the most recently generated cards without temporal triage. Relative title phrasing is now neutralized both on model output and local restore; capture time never anchors publication-relative wording. Posting dates are rejected as deadlines. PDF/document/update dates must overlap their task quote, not a different table row.
- Past dates and explicit closed/archived resource labels are separate from Upcoming. School/campus closure events are not confused with closed resources. Unknown dates stay in Date needs checking; they are not promoted to current deadlines. Month/day mentions without a verified year are shown as such. Source quotes remain unchanged.
- Discard used to delete cards. Hide now retains them, with immediate Undo, a Hidden view, and individual/bulk restore. Re-analysis preserves hidden/done state for stable or identical-source instructions. Conservative duplicate grouping does not merge separate courses based on a model-generated course name.
- Checking a task no longer filters it out of its current list. Done is independent of acceptance, hiding and school submission. A Done view and uncheck/reopen remain available. Source changes retain checkmarks but show a review warning; no automatic submission is implied.
- Reader acceptance/done preferences no longer depend on a calendar connection fingerprint. Existing account-scoped reader checkmarks are migrated. The new encrypted `relay-course-reader-owned-v2:<scope>` store copies the owned v1 store without deleting it; old tabs cannot overwrite the new action state. Unowned legacy stores are never claimed. Refresh all Relay tabs after updating.
- Setup completion is stored in the encrypted account/district library, not inferred from the current screen. Finished users see connection settings rather than another tutorial. Skipping AI is a valid finished state. Real login, pairing, provider or storage errors have specific recovery messages, not another generic Continue setup.

## Why homework lists could be missed

The former reader deliberately did not parse PDF interiors and cut text exports at the first 6,000 characters. Its metadata classifier also missed some plural “Assignments” / abbreviated “HW” labels, and always treated course indexes as discovery-only. These are confirmed implementation gaps, not proof of which layout a particular student's current math class uses.

0.6 adds:
- Important PDF homework/calendar/rubric text reading, **off by default and separately enabled in the extension**. Pause first to change the setting, then enable daily reading and Sync now. Existing school/Google permissions and recurring AI consent remain separate.
- PDF bytes fetched only from the selected Schoology origin or explicit `asset-cdn.schoology.com` / `files-cdn.schoology.com` links in an authorized course page. CDN fetches omit credentials and obey normal browser CORS; all PDF fetches reject redirects. Signed file URLs remain inside the source-page reader and are not returned to Relay or the AI provider.
- Maximum two important PDF fetch attempts per source page, 2 MB/file, first 20 pages, bounded streamed text items and a 20-second parsing timeout. PDF.js 6.4.299 is packaged locally with its license and worker in an offscreen document. No remote executable code, PDF scripts, OCR, form submission, password prompts or access-control bypass. An `offscreen` permission is added; no all-sites or cookies permission is added.
- Table cells are grouped by visual row and horizontal order. Every readable PDF page has separate provenance; extraction does not prove table semantics or dates. Scanned/encrypted/unsupported/inaccessible PDFs remain explicitly unread. Only extracted text enters the existing AI-consent pipeline.
- Bounded long HTML/Google text is split into up to eight excerpts rather than losing everything after 6k. Each excerpt remains <=6,000 characters; API total/request and daily quota limits do not expand. Truncation and cross-excerpt context remain visible. This is not support for every Google tab, spreadsheet, embedded tool, CDN or school website.
- Explicit homework sentences inside materials indexes can enter analysis; link titles alone are still not proof of assigned work.
- Per-course coverage separates course discovery, readable text, assignment drafts, likely list/calendar sources and unread notices. Direct materials links help diagnose the exact missing source. “No instructions extracted” never means “no homework.”

**Real-account limitation:** local fixtures verify actual PDF extraction and homework beyond the first 6k, not the student's specific math homework list. Its normal source-page URL or course coverage report is still required to verify the exact layout. Do not claim that all live math homework has been detected.

## Validation / deployment

No SQL migration. Package the extension with `python3 scripts/package-course-reader.py`; it now includes 21 allow-listed files (including bundled PDF.js). Update the existing unpacked extension to 0.6.0 and Reload, not a second installation. Website state changes work on refresh; new PDF collection needs the extension update and explicit PDF toggle.

- Unit tests cover relative/past/posted dates, closed-resource distinctions, action persistence and restoration, PDF provenance, and prior boundaries.
- The real unpacked-extension test uses synthetic Schoology/Docs/AI/account fixtures. It parses an actual synthetic PDF in Chrome, retains instructions after the first 6k, rejects ungrounded future dates, exercises hide/undo/restore, keeps checked rows visible, verifies finished setup and account isolation, and checks mobile overflow. This does not validate native optional-host consent UI or a live student account.
- A patched Next.js 15.5.28 is used. PDF.js 6.4.299 avoids the advisory affecting the initially evaluated 5.x release. Remaining audit findings in existing dependencies are not claimed resolved; no force/breaking audit upgrade was performed.
