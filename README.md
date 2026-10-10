# Relay

A student dashboard for assignments, school updates, calendar events, and school email. The current pilot starts with Fremont Union High School District (FUHSD).

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

The dev server runs on port 3002. See [student dashboard architecture, connection setup, privacy and limits](docs/student-dashboard.md). Public sources and local reader imports do not require new database tables. Optional reader AI needs the additive usage table; see [Chrome reader setup and privacy](docs/course-reader.md). The previous team product still uses the existing Postgres schema.

**Live data requires real authorization.** Public FUHSD announcements and events load directly from official pages. Private Schoology calendar entries require a permitted iCalendar feed; course text can instead use the separately authorized browser reader; Gmail requires explicit OAuth permission and Google API configuration. Empty states are intentional, never fabricated assignments. The [browser reader](extensions/course-reader/README.md) supports manual capture and opt-in daily course reading while Chrome runs. Automatic local imports and recurring AI each need separate permission; AI always produces reviewable drafts.

See [deployment setup](DEPLOYMENT.md) for the existing Vercel/Google environment configuration. The website prototype processes connected data on its server; it is not yet the offline hardware product described in the business plan.
