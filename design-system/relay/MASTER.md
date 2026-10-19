# Relay — Student desk

## Brief
English student workspace, not a chat app or a marketing page. The main job is to see course instructions, distinguish trustworthy dates from unknowns, and keep personal actions reversible. Preserve the single-step setup and all account/privacy boundaries.

## Skill research and critique
UI UX Pro Max searches: `student homework dashboard focus` and `education task management dashboard`. Both suggested landing-page structures, and the second suggested children's typography. Those are poor fits for a high-school work dashboard, so do not persist them as verified product recommendations. Adopt the useful constraints (clear hierarchy, accessible contrast, no hidden assignments, responsive navigation) and use the bespoke direction below. Next.js stack search cited 16.2; this project is 15.5.28, so no framework migration or router changes follow from it.

Rejected: another pale-blue collection of equally prominent cards; a decorative grade/productivity score; a huge week calendar before the work. No invented progress, deadlines, sample school records or gamified streaks.

## Tokens
- Ink / sidebar: #172331
- Ground: #F4F6F8
- Paper: #FFFFFF
- Signal / action: #4054CF
- Caution ink: #87521B on #FFF3DF
- Complete ink: #226449 on #EAF5EE
- Secondary text: #536170; boundaries: #D8DFE6
- Display: self-hosted Space Grotesk, 500–650; headings only.
- Body: self-hosted Manrope, 400–700; no external font requests.
- Utility: system monospace for dates and provenance labels.
- 4/8 px spacing; primary buttons >=44 px tall; 12–16 px supporting type, 15–16 px task copy.

## Structure
```
nav          | title + date / reading status
             | one setup action only when needed
             | instructions (primary)       | course reading coverage
             | upcoming / unknown / history | week strip + calendar entries
             | source evidence on demand    | school bulletin (secondary)
```
On mobile: brand + visible wrapping navigation; instructions first, context below. No floating toolbar hiding focused controls.

Signature: a course reading ledger with explicit Text / Drafts / Gaps indicators. It describes what was read, not a misleading completion percentage. The weekly date strip is compact context rather than the headline.

## Invariants
- One copy of each task list; reviewed and draft instructions remain visible together, with clear labels.
- Done never disappears on checking. Hidden/Undo/Restore and all temporal categories stay available.
- No dates inferred from capture time. Coverage unknown != no homework.
- No source/profile/AI permissions granted by visual interactions.
- Setup renders exactly one step. Technical help and optional connectors default collapsed.
- Error, empty, loading, offline and unsupported states remain explicit.
- No changes to /legacy, auth, database, extension permissions or AI requests.

## Validation
Validated 61 unit tests, TypeScript, actual unpacked extension synthetic workflow (FUHSD and PAUSD), and sequential setup fixture. Added auth-shell checks at 375/768/844/1440, dashboard overflow checks at 375/768/1024/1440, reduced-motion checks, course filtering, search including unreviewed cards, and URL reload/back/focus behavior. Browser fixtures are not live student account verification.

Screenshot critique led to three revisions: collapse learning notes and source boilerplate; place evidence/source links on one row; remove the large empty calendar panel on Overview and switch the tablet navigation earlier. Main semantic color pairs exceed 4.5:1 (body 15.89, secondary 5.85, action 6.20, caution 5.88, done 6.29, sidebar 9.78). This is not a claim of a complete accessibility conformance audit.

Variable fonts are self-hosted Latin WOFF2 subsets (~47 KB combined), with SIL OFL licenses, system fallbacks and swap. No Google font requests are made by the app. This release changes only the website; extension 0.6.0 and permissions remain unchanged.
