# Relay

A student dashboard for assignments, school updates, calendar events, and school email. The account-based pilot supports FUHSD and Palo Alto Unified (PAUSD) Schoology. [Guided setup](docs/student-setup.md) adds specific school links, a real NCES US public-school directory search, explicit unsupported-portal states, extension readiness checks and visible assignment drafts. Directory coverage is not the same as reader support. [Reader 0.8](docs/lynbrook-website-reader.md) adds manual Lynbrook public-page snapshots, separately stored/displayed with no AI or assignment creation. Its [0.7 course behavior](docs/schoology-access-and-discovery.md) uses explicitly selected PDF source pages and bounded Schoology viewer resolution rather than guessing HW lists. Temporal safeguards, reversible task controls and persistent setup completion remain. Official Schoology OAuth is researched, not yet connected; it requires Relay’s own approved application access.

- Production: https://relay.aaronluo.com
- New dashboard: `/`
- Previous team workspace source and demo: `/legacy`, `/legacy/demo`
- Pre-pivot Git snapshot: `archive/team-relay-e399568`

## Develop

```sh
npm install
npm run dev
npm test
npx tsc --noEmit
npm run build
```

The dev server runs on port 3002. See [student dashboard architecture, connection setup, privacy and limits](docs/student-dashboard.md). Student onboarding requires the additive StudentProfile table; optional reader AI also needs ReaderAiBudget. See [account isolation, district setup and migration](docs/student-accounts.md); see [Chrome reader setup and privacy](docs/course-reader.md). The previous team product still uses the existing Postgres schema.

**Live data requires real authorization.** Sign into Relay, select a district, and explicitly pair the extension. Libraries and connectors are separated by account/district; course text remains encrypted locally, not cloud-synced. PAUSD public news/calendar is not yet connected; it never receives FUHSD records as a fallback. Public FUHSD announcements and events load directly from official pages. Private Schoology calendar entries require a permitted iCalendar feed; course text can instead use the separately authorized browser reader; Gmail requires explicit OAuth permission and Google API configuration. Empty states are intentional, never fabricated assignments. The [browser reader](extensions/course-reader/README.md) supports manual capture and opt-in daily course reading while Chrome runs. Automatic local imports and recurring AI each need separate permission; AI always produces reviewable drafts.

See [deployment setup](DEPLOYMENT.md) for the existing Vercel/Google environment configuration. The website prototype processes connected data on its server; it is not yet the offline hardware product described in the business plan.
