# After-school planner — research and design

## Public product research

Inspected official public pages, not paid signed-in product accounts. Claims below describe documented interactions, not measured product effectiveness. No proprietary code, illustrations, assets or text copied into Relay.

- [Shovel schedule builder](https://shovelapp.io/schedule-builder/): per-day awake windows; classes and personal activities; meals, exercise and protected Me Time; default durations; repeat days; drag/drop and resizing; minimum usable study block; warns that a class-only timetable understates commitments. Its public guide is explicit about these controls. Do dates are separate from due dates.
- [Sunsama timeboxing](https://help.sunsama.com/docs/timeboxing) and [customization](https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-customizing-settings): planned/default duration, gaps, per-day scheduling hours, channel overrides, internal vs external calendar, conflict rescheduling, early completion behavior. Relay adopts explicit planning and internal-only scheduling, not automatic external writes.
- [Motion task manager](https://www.usemotion.com/features/ai-task-manager): deadline/priority ordering, custom time windows, recurring tasks, at-risk warnings and replanning. Relay rejects overtime as a default and does not promise every task can fit.
- [Reclaim Tasks](https://reclaim.ai/features/tasks): availability/deadline-aware placement, flexible priorities, splitting work into focused sessions, changes around commitments. Marketing productivity numbers are not imported as evidence.
- [MyStudyLife](https://mystudylife.com/): student-specific classes, homework, exams and activities; rotating/block/custom schedules and focus tools. Relay does not infer a bell schedule from the selected school.

Python requests to several sites returned 403; normal Chrome navigation reached their public pages without spoofing or verification bypass. Research text snapshots: `/tmp/relay-planner-*.txt` (local artifacts, not project assets).

## Student customization

A dedicated **After school** view. Progressive setup shows only one editing step at a time: (1) afternoon boundaries, commute/unwind, focus/rest and daily study limit; (2) fixed commitments with repeat weekdays; (3) chosen reviewed assignments or personally entered tasks, with editable time estimates, priority and difficulty. Saved preferences can be reused; they are suggestions set by the student, never verified school hours.

The output is a reviewable timeline, not an automatic calendar mutation. Keep selected study slots fixed, mark a **planning session** done separately from homework completion, and explicitly replan remaining work. Capacity overflow stays visible; never silently truncate the task list or extend the finish time. User-entered durations are estimates, not model-derived facts. Unknown due dates are not urgency evidence. No academic answers or step-by-step coursework help.

## Visual direction

Retain Student desk tokens: ink #172331, ground #F4F6F8, paper #FFFFFF, action #4054CF, caution #87521B / #FFF3DF, completion #226449 / #EAF5EE. Space Grotesk headings, Manrope body, monospaced time gutter. No new fonts, gradients or fake productivity scores.

Signature: a **time rail** where protected commitments, flexible study and deliberately free time are distinct. Capacity figures derive from the proposed blocks and estimates. A single current-step form leads to a timeline + honest unscheduled-work list. On mobile, time/content rows stack without a draggable-only interaction. All editing has ordinary keyboard controls; existing one-step course onboarding remains untouched.

## Boundaries

- Local deterministic constraint scheduling, explicitly labeled as such; no LLM call and no new AI permission. 'Smart' means deadline/priority ordering, bounded splitting, conflicts, capacity and explicit replanning—not unverified model intuition.
- Only reviewed, active, nonhidden, nondone assignments are candidates. Unreviewed drafts, stale/closed records, campus announcements, grades, mailbox text and calendar deadlines are not commitments. Unknown/optional assignments require explicit selection. Past-due work is not silently promoted into today's recommendations.
- A planned work time never edits a source due date. Date-only deadlines lack a time of day; no promise that scheduling work that evening beats the actual submission time.
- Pacific date/time throughout. Today starts no earlier than the current time. Same-day windows only, no midnight/DST offset arithmetic. Historical plans are not current recommendations.
- Fixed activities/commute/unwind/free-time reserve and stop time constrain scheduling. Missing commitments are acknowledged, not assumed absent. Imported calendars are not silently used as availability because item durations are unavailable.
- Plans/preferences live in a separate encrypted, account/district/campus-scoped local database. No cloud copy or cross-device sync. Generate produces an unsaved draft; explicit Save confirms it. Replanning never changes Schoology or the source-task checkmarks.
- Source changes must be flagged before a saved plan is treated as current. Keep existing plans until the student confirms a replacement. Cross-tab writes use locks and revision checks, not silent last-writer overwrite.

## Implementation and verification

- Route state: `?view=planner`, sidebar **After school**, Overview shortcut. The planner stays mounted while switching workspace views so unsaved inputs survive navigation. Account/campus changes remount it; unsaved inputs are not stored in plaintext session storage.
- Engine: `src/lib/student/afterSchool.ts`; independent from the provider and AI quota. No new endpoint, database migration, extension update or external calendar integration.
- Storage: IndexedDB `relay-after-school-v1:<scope>:<campus-id>`, store `planner`, encrypted record `current`, AAD `planner:<scope>:<campus-id>`. Routine plus up to 30 saved dates; reaching the limit asks the student to delete an older plan. It never silently deletes history. Routine changes seed new days; other saved plans keep their own reviewed snapshots.
- Complete sessions count against the chosen daily study budget, remain visible, and do not mark source assignments done. Removed/changed-source completed sessions become explicit history when rebuilding. Unchecked past sessions return to remaining work; past time is not completion evidence. A stale future pin must be unpinned before rebuilding.
- Session start-time edits are keyboard-accessible, pin the moved session, and validate overlaps, breaks, boundaries and past-time constraints. No drag-only interaction. Changes remain drafts until saved; rejected edits leave the previous valid timeline unchanged.
- `afterSchool.test.ts`: deterministic boundary, capacity, date/DST, source eligibility, completion/pins, invalid-state and conservation tests, including 180 generated layouts and pin/replan passes.
- `scripts/verify-after-school.mjs --run`: synthetic-account/source Chrome UI flow; one current editing step, input preservation across navigation, no AI/external writes, preview-before-save, encrypted persistence, session markers without source mutations, overflow, conflict rejection, stale-source warnings, cross-tab compare-and-swap, account/campus separation, keyboard focus and 375/768/1024/1440px overflow/screenshots. Not a live student's schedule or mobile Safari verification.
- Existing course setup and unpacked-extension regressions are rerun separately. Production school due times, actual availability and estimate accuracy remain unverified. The student must review these inputs.
