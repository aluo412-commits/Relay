# Relay Course Reader — 0.1 pilot

## Install in Chrome on your computer

1. Unzip the download.
2. Open `chrome://extensions`.
3. Enable **Developer mode**. Choose **Load unpacked**, and select this folder (the one containing `manifest.json`).
4. Pin **Relay Course Reader — Pilot** from Chrome's extensions menu.

This is an unpacked, inspectable prototype, not a Chrome Web Store release. Do not install it if your school/device policy prohibits extensions.

## Try it

1. Sign into https://fuhsd.schoology.com yourself. Never send Relay your password, MFA code, or browser cookies.
2. Open a course materials page, assignment, update page, or your own grades page. Alternatively, open a course Google Doc or Slides file you can access.
3. Click the extension, then **Read this page**.
4. Expand the text preview and choose which captured pages to send. Up to eight pages are held in Chrome session storage, until cleared or the browser session ends. No background crawling occurs.
5. Click **Review selected pages in Relay**. The extension opens https://relay.aaronluo.com and hands off the selected excerpts inside your browser. Confirm the import there. They are then stored in that browser profile's IndexedDB, not on Relay's server.
6. In **Connections → Course reader**, optionally sign into Relay and consent to AI analysis of selected excerpts. This separate action sends them to Relay's server and configured AI provider. Provider retention policies apply. Review every quote, requirement and proposed date before adding a draft card to your board.

Clearing the extension and clearing Relay's local reader are separate controls. Anyone using the same browser profile can see captured/imported data. Do not use a shared profile for private schoolwork. Disconnecting a calendar or Gmail does not erase reader excerpts.

## Permissions and boundaries

- `activeTab` and `scripting`: read a page only after you open the extension and choose Read. Only the reader's code runs; captured text is never executed.
- `storage`: session-local staging; no Chrome sync storage.
- Host access to `https://relay.aaronluo.com/*`: deliver the preview to the dashboard. It is not used to read inboxes or other Relay content.
- Optional `http://localhost:3002/*`: explicitly granted under Developer options for local testing only.
- No cookies, history, downloads, webRequest, all-sites, persistent Schoology, or Drive-wide permissions. No remote executable code.

## What this version does NOT do

- It does not read PDF interiors, images, screenshots, or linked files automatically. A Schoology file wrapper is not the file's content.
- It does not crawl every course. Open linked pages yourself and capture only the ones you want.
- It cannot bypass Google/Schoology login, export restrictions, district access controls, or MFA. Docs/Slides text export may fail or omit tabs/images/comments/layout.
- Each capture includes at most the first 6,000 characters, with a visible warning when truncated. AI analysis accepts at most 32,000 characters in total per request.
- It does not submit assignments, mark Schoology work complete, change grades, send emails, or generate graded homework submissions. Follow course AI-use rules.
- Data is a timestamped snapshot, not live sync. Refresh pages and recapture when they change. Changed text invalidates previous extracted cards pending another review.

Source: https://github.com/aluo412-commits/Relay/tree/main/extensions/course-reader
