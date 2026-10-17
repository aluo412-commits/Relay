# Student accounts and districts — ownership introduced in reader 0.4

Current release: [reader 0.5 guided setup and school-directory search](student-setup.md). The ownership boundaries below still apply.

## Onboarding

The website now requires a Relay account before opening private student data. Existing Google sign-in and email/password accounts are reused; no team workspace is required. New accounts explicitly choose **FUHSD** or **Palo Alto Unified (PAUSD)**, then pair the extension with that signed-in account and enable their desired reading permissions.

- FUHSD: https://fuhsd.schoology.com
- PAUSD: https://pausd.schoology.com
- Official PAUSD Schoology information: https://www.pausd.org/school-life/education-technology/schoology

The PAUSD Schoology host was checked publicly and redirects to PAUSD's ClassLink login. This is not verification of a student's login, course layout, enrollment or district approval. The student completes school login/SSO/MFA personally. Never use `schoology.org` or export school credentials.

Changing district is an account preference, not proof of enrollment. The account menu has **Change district** and **Sign out**. A change preserves separate encrypted local libraries, but invalidates extension pairing, OAuth-in-progress state and the previous district connection revision. Returning to a district can reopen that account's local library, but requires fresh connection/pairing consent where invalidated.

## Isolation boundaries

- `StudentProfile` stores user ID, selected district, revision and timestamp only. All ownership comes from the signed Relay session, never a user ID supplied in a request.
- The stable storage scope is a purpose-separated HMAC of user ID + district. Local AES-256-GCM keys are derived separately on the server and returned only to the authenticated current account. Keys are kept in memory, not localStorage or extension storage. AES authenticates the scope as additional data.
- Reader excerpts, reports and cards are encrypted in account/district-specific IndexedDB databases. There is no cloud course-text database or cross-device library sync. Preferences, content fingerprints, automatic limits and completion IDs are namespaced by account/district.
- Extension cache is encrypted, with a single explicitly paired account at a time. Pairing names the current account and district and replaces only the extension's previous cache; it does not erase the website's separate libraries. Manual captures are in the same encrypted account cache, not an unowned shared buffer.
- Pairing is bound to the signed Relay login session, selected district and profile revision. The extension checks the authenticated account endpoint before reading/using its vault, and rejects changed accounts. No cookies API is used: browser credentials accompany normal allow-listed HTTPS requests. Sign-out/new login or district changes require pairing again.
- Website messages carry scope + session binding. Late messages for another account/district are rejected. Stale account metadata requests are aborted/version-checked. The account gate clears/unmounts private state on sign-out/account changes; tabs signal changes and periodically revalidate.
- Private dashboard, calendar, Gmail mutations and AI requests require the current binding in addition to the authenticated session. A district mismatch cannot send Schoology text to AI. The shared 12-request AI quota remains per user, not per district.
- Calendar and Gmail credential cookies have account/district-specific names and authenticated purposes including the profile revision. Another account cannot use them. Gmail OAuth state is bound to the initiating account/session/district and checked before exchanging the code.
- When the Schoology layout exposes a unique current-profile link, its opaque fingerprint is pinned and checked on subsequent school HTML reads. A change or loss of a previously known identity pauses reading. Some layouts expose no reliable identity: the report explicitly warns, and users must confirm the school login and use a personal browser profile. Relay cannot prove that a school account belongs to a Relay email merely from selecting a district.

This is application-level isolation, not protection against someone controlling an already signed-in device, browser administrator tools, malware or same-origin script compromise. Sign out of Relay **and** school services on shared machines; separate browser profiles are recommended. JWT sign-out clears the browser cookie; it is not a global revocation of previously stolen session tokens. Rotating AUTH_SECRET invalidates sessions and derived local encryption keys; back up/re-import source data as appropriate before planned rotation. Wider rate limiting, verified-email signup, account recovery, retention/export tooling and security review remain necessary before broad distribution.

## Existing data and auth changes

Old plaintext reader databases and old global connector cookies have no trustworthy account owner. They are **not automatically attached to the next person who signs in**. The website leaves legacy local stores unassigned; they can remain plaintext on disk and should be cleared before sharing the browser. Pairing the new extension explicitly clears its old unowned captures/cache. Original Schoology files, user images, imported Pi histories, and legacy team records are untouched.

Google sign-in no longer silently links an existing password account solely by matching an unverified email string. Linking requires an already authenticated matching Relay account; an existing different Google identity is not overwritten. Login/signup/logout mutations check same origin, and session JWTs now include unique IDs. Existing password sign-in still works; password recovery/email-verification infrastructure has not been added in this release.

## PAUSD coverage

The allow-list, crawler, manual reader, source validator, calendar parser, school links and email-domain filter support PAUSD. Only the selected district's Schoology host is used; generic Schoology calendar service hosts remain allowed for authorized feeds. Google document sources retain separate permission requirements.

The **public PAUSD news/calendar adapter is not implemented**. It shows an explicit unconnected state and links to the official website; FUHSD announcements are never substituted for PAUSD. PDF/image/LTI restrictions and unknown Turnitin statuses remain unchanged.

## Deployment and tests

Apply the additive metadata table once, using the configured database:

```sh
node scripts/apply-student-profile.mjs --apply
npx prisma generate
python3 scripts/package-course-reader.py
npm test
npx tsc --noEmit
npm run build
```

No destructive schema push or reset is needed. The current extension download is version 0.5.0. Replace the original unpacked-extension files and Reload; do not install a second copy. Sign into Relay, choose a district, sign into its Schoology, enable local imports in website setup, then **Pair current Relay account** and enable reading. AI remains separate consent.

Validation:
- Unit tests cover PAUSD routing, cross-district rejection, per-account/district encryption, wrong-key/scope/plaintext rejection and session binding changes.
- `npx tsx scripts/verify-student-accounts.ts --run` creates/deletes two synthetic accounts and tests real HTTP/database signup, district selection, stale/foreign bindings, foreign connector cookies, cross-district AI rejection before quota use and stable storage keys. `--production` explicitly targets the deployed site.
- Add `--browser` with `PLAYWRIGHT_MODULE=/path/to/playwright` to verify that an actual temporary Chrome extension's fetch uses the active HttpOnly/SameSite Relay cookie and detects switching/sign-out. This uses real account HTTP, no cookies API and no mocked account endpoint.
- `node scripts/verify-reader-extension.mjs --run --pausd` (also run without `--pausd` for FUHSD) tests an actual unpacked reader with synthetic school/Docs/AI/account-endpoint fixtures: encrypted cache, automatic import, two-account local isolation, late-capture rejection, owned-library restore and logout. Test-only host grants and account responses are simulated; native permission UI and real school data are not validated by that test.

A real authorized PAUSD student must still complete the first live course sweep. Do not describe fixture checks or a public ClassLink redirect as a completed private-account integration.
