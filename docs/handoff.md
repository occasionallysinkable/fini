### The build file

# Handoff to Claude Code

Everything a build agent needs and nothing it has to infer: the stack, the schema, the arithmetic, the invariants, and nineteen work packages in the order they get built. Design intent lives in the other six documents; this one is the contract.

## Build it one work package at a time

Not the whole app in one session. A single prompt for a hundred-hour app produces a codebase nobody has read, and when it is wrong there is no smaller thing to fix. Each work package below is two to eight hours, ends in something you can open in a browser, and carries acceptance criteria you can check without reading the code.

One exception: WP1 is the schema and the spine, and it must land whole before anything else starts. Every later package assumes those tables exist and assumes every write goes through the activity log.

### Prompt to open each package

```
Read these files in the repo before writing anything:
  docs/decisions.md, docs/resolutions.md, docs/handoff.md

Build WP-n only. Do not start WP-(n+1).
Use the stack named in the "The stack, decided" section and no other.
Hold every invariant in the "Invariants" section of handoff.md.
When you are done, list the acceptance criteria and say
how you verified each one.
```

Every design document is already in `docs/` beside this one. `docs/README.md` lists them. Read from those files rather than asking for the rules in chat.

## The stack, decided

| Piece | Choice | Why this one |
| --- | --- | --- |
| App | Next.js (App Router), TypeScript, React | One deployable that serves the interface, the API and the service worker. Server components keep the board fast at sixty rows without a client-side store. |
| Database | Postgres on Neon, Prisma | Free tier is genuinely enough for one user. Real date and interval types matter here more than usual — every screen is arithmetic on times. |
| Styling | Tailwind v4 with the design tokens declared as CSS custom properties | No hex values anywhere in components. The tokens file is the only place a colour is written down. |
| Auth | Auth.js, email magic link, allowlist of one address | Single user. Nothing about accounts is built, and the task schema already survives multi-user later. |
| Push | Web Push with VAPID, a service worker, notification actions | The only channel, by decision. **Targets are Windows and Android only; iOS is out of scope.** Push was proven end-to-end on Windows (Chrome/Edge) via `/push-check` on 2026-09-01, so the go/no-go gate is cleared. |
| Scheduler | A Cloudflare Worker cron trigger, every minute, posting to `/api/tick` with a shared secret | Reminders need minute accuracy and must fire when the app is closed. Vercel's free cron runs once a day, which is useless here. A Worker cron is free and does not sleep. |
| Hosting | Vercel | Nothing here needs more. |
| Tests | Vitest on the arithmetic, Playwright on the three answers | The arithmetic is where a silent bug costs a deadline: safe start, shift charging, recurrence, snooze rescheduling. Those get unit tests. The interface gets four end-to-end paths and no more. |

## Invariants

Fourteen rules that hold in every package. A pull request that breaks one is wrong even if the feature works.

| # | Rule | What it means in code |
| --- | --- | --- |
| 1 | Every write is logged | No mutation reaches the database except through a function that also writes an `activity` row with an actor, a summary sentence and an undo payload. The activity page is not a feature bolted on; it is the write path. |
| 2 | Every write is reversible | The undo payload is enough to restore the previous state. Deletes set `deleted_at` and nothing else. There are no confirmation dialogs in the codebase. |
| 3 | Scheduled total time is never stored | It is a query. Any column named anything like `total_minutes` on a shift or a day is a bug. |
| 4 | Availability is derived | One function, `isAvailable(task)`, reads defer date, project hold, project sequence and blockers. Views call it. No saved filter reimplements it. |
| 5 | An estimate is one integer of minutes, or null | Never a range, never two numbers. A block's length and the estimate are the same value. |
| 6 | Three dates, three owners | `due_date` moves only on an explicit user action. `do_date` is written by the calendar, the queue and the not-today branch. `expected_by` lives on the blocker row and disappears with it. |
| 7 | State is words | Every state a screen shows has a string. Colour may be added; no component may branch on colour alone to convey meaning. |
| 8 | Consequences print in the same frame | Any mutation triggered from a screen returns the sentence describing its cost, and the screen renders it where the action happened. No toast component exists. |
| 9 | The keyboard reaches everything | Every action has a key. Screens that ask a question number their options 1–n and accept those digits. |
| 10 | Timestamps are UTC, dates are dates | `due_date`, `do_date`, `defer_until`, `expected_by` are calendar dates with no time and no zone. Everything with an hour stores a UTC instant plus the IANA zone it was expressed in. |
| 11 | A commitment's clock is the other person's | When a task has an asked-by person with a timezone, the due time is interpreted in their zone and the safe start is computed there. Own tasks use the user's zone. This is one function; no screen does its own conversion. |
| 12 | Nothing about one person's life is hard-coded | No shift, category, capacity, working hour or planning hour appears as a literal outside a seed script. |
| 13 | Nothing parsed is discarded | Text the parser does not understand stays in the title. Every token it does understand writes to a column something reads. |
| 14 | Empty states are one sentence | No illustrations, no encouragement, and the useful input already focused. |

## The data model

All of it goes in at WP1, including the columns nothing reads until stage 3. Adding the do-date split, the placed-by flags and the task-to-task links later is a migration across live data; adding them now is free.

| Table | Columns |
| --- | --- |
| `user` | One row. `id`, `email`, `timezone`, `planning_hour`, `waking_start`, `waking_end`, `settings` (json: default reminder on/off and its offset, snooze interval minutes, default estimate on/off and per-category lengths, board wrap, row click behaviour, stale mechanism on/off) |
| `person` | `id`, `name`, `timezone`, `day_start`, `day_end`, `contact`, `created_at` |
| `project` | `id`, `name`, `parent_id`, `is_sequence`, `on_hold`, `review_interval_days`, `last_reviewed_at`, `hill_state` |
| `category` | `id`, `name`. User-defined. Shifts admit by category. |
| `task` | `id`, `title`, `project_id`, `category_id`, `kind` (commitment · own · habit · unassigned), `kind_is_explicit`, `reason`, `status` (active · done · cancelled · someday), `due_date`, `due_time`, `due_at_utc`, `due_zone`, `do_date`, `do_date_set_by` (user · app), `defer_until`, `estimate_minutes`, `actual_minutes`, `splittable`, `min_chunk_minutes`, `hill_state` (figuring · doing · null), `block_start`, `block_end`, `block_placed_by` (user · app · null), `recurrence_rule_id`, `occurrence_date`, `source` (typed · voice · email · meeting · message), `push_count`, `keep_count`, `created_at`, `modified_at`, `completed_at`, `deleted_at` |
| `task_person` | `task_id`, `person_id`, `role` (asked_by · waiting_on · delegated_to · assignee). Many per task. The same person may appear twice with different roles. |
| `blocker` | `id`, `task_id`, `person_id` (nullable), `event_text` (nullable), `expected_by`, `state` (waiting · late · cleared), `created_at`, `cleared_at`. Expected-by lives here and nowhere else. |
| `task_dependency` | `task_id`, `blocked_by_task_id`. Stored from day one, acted on by nothing in v1. |
| `reminder` | `id`, `task_id`, `offset_minutes` (nullable), `absolute_at` (nullable), `is_start_reminder`, `enabled`, `next_fire_at_utc`, `snooze_count`, `created_at` |
| `reminder_event` | `id`, `reminder_id`, `fired_at`, `devices_delivered`, `outcome` (fired · done · snoozed · withdrawn), `snooze_reason` (middle_of_something · wrong_time_of_day · waiting_on_someone), `snooze_minutes` |
| `shift` | `id`, `name`, `start_time`, `end_time`, `weekdays` (7 booleans), `capacity_minutes`, `capacity_from_window`, `created_at` |
| `shift_category` | `shift_id`, `category_id`. Empty means the shift takes everything. |
| `recurrence_rule` | `id`, `pattern` (daily · weekdays · weekly · monthly_date · every_n_weeks), `weekdays`, `day_of_month`, `n`, `mode` (fixed · after_completion), `template` (json of the task fields each occurrence inherits, including the reason) |
| `note` | `id`, `task_id` (nullable — a note can stand alone), `body`, `created_at` |
| `override` | `id`, `at`, `rejected_task_id`, `chosen_task_id`, `reason_code` (matters_more · estimate_wrong · wrong_time · fresh_info · free_text · null), `reason_text`, `points_at` (rejected · chosen · both) |
| `planning_session` | `id`, `for_date`, `started_at`, `finished_at`, `question_count`, `dropped_task_ids`, `ran_mid_day` |
| `activity` | `id`, `at`, `actor` (user · app · person), `actor_person_id`, `verb`, `task_id`, `summary`, `filter_kind` (reminders · overrides · dates · people · deletions), `undo_payload`, `undo_expires_at` |
| `device` | `id`, `endpoint`, `keys`, `label`, `notifications_enabled`, `last_seen_at` |
| `saved_view` | `id`, `name`, `filter`, `columns`, `grouping`, `sort`, `position` |
| `engagement_event` | `id`, `at`, `kind` (open · planning_finished · capture), `platform` (desktop · mobile) |

## Computed, never stored

| Value | How |
| --- | --- |
| Scheduled total time | For a shift on a date: the sum of estimates of untimed tasks routed to it, plus, for every block overlapping its window, the minutes of overlap. Minutes of overlap, never a proportion. |
| Remaining time | `capacity_minutes − scheduled`. May be negative, and a negative number is displayed as *over by* rather than hidden. |
| Unestimated count | Shown beside remaining, always. A clean number that quietly excludes half the queue is worse than no number. |
| Latest safe start | `due_at_utc − estimate_minutes`, where `due_at_utc` was built in the clock from invariant 11. Null when there is no estimate or no due date. Where there is a due date and no due time, the due instant is 00:00 on that date. |
| The chain | Today's deadline-bearing tasks ordered by safe start. Read-only on every screen. |
| `isAvailable(task)` | False when the defer date is in the future, the project is on hold, the project is a sequence and this is not its first unfinished task, or an unresolved blocker exists. Unavailable means absent from every day view, not greyed. |
| Stale | No *touching* row in `activity` for this task in fourteen days, and `status = active`. Keeping writes an activity row, so the clock resets by the same rule everything else uses. An undo row (verb `undo`) is **not** a touch — it records that a write was reversed, not work on the task — and neither is the action it reversed (its `undo_expires_at` is nulled when undone). Both are excluded from the clock, so pressing undo on a keep or a push returns the task to the block rather than leaving it muted by its own reversal. |
| Day total | The sum of that day's shifts. Displayed. Never used to refuse anything. |
| Blocker lateness | `expected_by < today` flips the state to late. A nightly job does this; nothing moves any date. |

## The ranking function

One pure function: a task and the current instant in, a score and a list of contributing components out. The score never reaches a screen. The components are what the reason sentence is built from, using the order in R5.

| Component | Weight | Condition |
| --- | --- | --- |
| Their day is closing | 600 → 0 | An asked-by person with a timezone whose working day ends within eight hours. Scales linearly with minutes remaining in their day. |
| Someone is blocked on you | 250 | An asked-by or delegated-to person exists and the task is a commitment. |
| Due time today | 400 → 0 | Scales with minutes until the latest safe start. Goes to 500 once the safe start has passed. |
| Recently unblocked | 200, decaying over 24h | A blocker was cleared within the last day. |
| Due date | 150 → −50 | Today is 150, tomorrow 100, each further day less, past the due date 200. |
| Habit behind pace | 0 – 90 | Stage 4. Scales with how far behind the quota is with how many days left. |
| Pushes and keeps | 15 each, capped at 90 | Raises standing over weeks so buried work resurfaces. |
| Blocked | −400 | An unresolved blocker. Stays visible, cannot take a slot. |

These numbers are a starting point, not a finding. They are tuned once against stage-4 data and never nudged automatically — that is a decision, not an oversight.

**Which components get named:** a component is eligible only if its value exceeds a tenth of the gap between this task's score and the next task's. Take the eligible ones in R5's order and name at most two. If none are eligible, print *no strong reason — next by due date*.

## Nineteen work packages

### Stage 1 · it holds your tasks reliably · 32–44h

| WP | Goal | Done when |
| --- | --- | --- |
| 1 | Schema and the write spine | Every table above exists. Auth works for one address. A `mutate()` helper is the only path to a write, and it takes an actor, a summary and an undo payload. Undo restores. Deploy is live and the database survives a redeploy. *Nothing else starts until this is true.* |
| 2 | Capture and the parser | Every token in R16 parses. The echo is prose naming the field and the value. Unparsed text stays in the title. Kind is inferred per R17 and the inference is printed with its cause. R15's one caption line appears when a due time falls outside every shift on that date. |
| 3 | Projects, sub-projects, notes | Two levels in the interface, any depth in the data. Sequence projects expose only the first unfinished task. Notes attach to a task or stand alone. Review intervals are set per project and the review screen shows only what is due. |
| 4 | The board | Grouped by project, soonest due first, four default columns. Columns slide under a frozen title with the hidden-count control. Search takes over the screen; Tab turns it into a filter; saved views are created only from a filtered state. Bulk actions appear only while rows are selected. States read as words. |
| 5 | The stale block | Fourteen days by the activity-row rule. Three rows at a time, keep/push/kill, the kept count printed, fixed interval. Sweeps appear past a handful. The whole mechanism has an off switch. |
| 6 | The task page | R6 exactly: five sections, no empty fields, one plain-word control per section, sidebar with a remembered width, edit in place with no save button. People per R7 — pairs grouped by role, human first, role second, roles the app already knows are not asked. |
| 7 | Reminders you set | Presets and custom offsets. Service worker, VAPID, device records. The tick endpoint fires from the Cloudflare cron. Done and Later on the notification; Later expands into the three reasons; each reason is the snooze; the second snooze offers longer intervals. Completion on one device withdraws the rest. **Go/no-go push test passed on Windows 2026-09-01; targets are Windows + Android only, iOS out of scope.** |
| 8 | Recurrence and habits | Five patterns, both modes, `every` and `every!`. Rule stored apart from occurrences. Missed occurrences do not accumulate; the series records the skip. Habits show completion history only, per R18. |
| 9 | A plain today, and activity | Per R21: due or do-dated today, ordered by due date then due time, with all three answers and every branch from R1, R2 and R3. The ledger line and undo from R4. The activity page per R9 and R10, with its six filters, reading the rows WP1 has been writing all along. |
| 10 | Durability | Weekly export. Thirty-day recoverable deletes with restore from the activity page. Engagement events recorded. A restore-from-export path that has actually been run once. |

### Stage 2 · it protects the deadlines · 20–30h · switchover at the end

| WP | Goal | Done when |
| --- | --- | --- |
| 11 | Shifts, capacity, scheduled total | The onboarding question from R13 creates the Day shift. The Settings table adds more. Capacity pre-fills from the window and says so. Remaining time and the unestimated count are queries. A day total is displayed and refuses nothing. |
| 12 | Timezones and the chain | People carry zones and working hours with history. Invariant 11 is one function with unit tests. Safe start computed. The chain rendered read-only. |
| 13 | The start reminder | Per R22. Armed on every commitment with a due date, offset by the estimate, recomputed on any change to estimate, due time or the person's zone. Existing commitments armed in one pass. Removing it names what is being given up. |
| 14 | The calendar | R8 and the whole calendar section of decisions. Seven days from today. Shift bands. All-day strip sets a do date; the hour grid sets a do date and a block. Overlap charging per shift with unit tests, including a block covering two shifts and a block in no shift. The tablet for the aware cases, the popup with a queue link for over-capacity. Chain blocks carry the word *deadline* per R26. |
| 15 | Blockers | Set from the not-today branch and from the task page. Expected-by seeds the do date and never touches the due date. Reminders suspend while blocked and the task page says so. The nightly job flips waiting to late and writes the activity row. |
| 16 | Mobile | Capture, today in full, and the board read-only per R23 — one scrolling column of titles and state words, filterable by project. The task page opens read-only. |

### Stages 3 to 5 · 48–73h

| WP | Goal | Done when |
| --- | --- | --- |
| 17 | Ranking, and the reason sentence | The pure function above, with the naming rule from R5. Today's ordering switches from due date to the score and the flat line becomes the sentence. Overrides record the rejected task, the chosen task, the reason and which task it points at. |
| 18 | The planning queue | Closing today first, then planning. Questions only where the choice costs something. Options carry costs. Remaining time described by shape. The fourth door on every question. The chunking line per R11. The three closing lists, the empty-drop-list warning, and the stale line per R12. |
| 19 | Stages 4 and 5 | Estimated against actual, push and keep analytics, quotas and habit progress, the override review. Then voice capture, editing by description with changes shown before they apply, the labelled open dump, and the local-only option with a delete-everything control. |

## Scenarios to run by hand before the switchover

Nine paths. Each one crosses several packages, which is exactly why they are the ones that break.

| Scenario | What must be true at the end |
| --- | --- |
| Capture a commitment for a person in another zone, with two reminders | Kind reads commitment with its cause printed. The due instant is in their zone. Three reminders exist, one of them the computed start reminder. |
| Move the deadline forward by a day | All three reminders move with it. The safe start moves. Nothing else changes. |
| Let the start reminder fire on a phone with the screen off | It arrives. Later expands into three reasons. Choosing one reschedules that reminder by fifteen minutes and touches no date. A second Later offers longer intervals. |
| Complete the task on the laptop while the phone notification is still showing | The phone's notification is withdrawn, not left sitting. |
| Drag a two-hour task across noon | The morning shift is charged its overlap in minutes, the afternoon shift the rest, both remaining figures update in the same frame, and the estimate equals the block length. |
| Drag the same task so it covers a whole shift | That shift is charged its entire length, goes over capacity, and a popup with a link into the queue appears — not a tablet. |
| Press L, choose waiting on someone, type an unknown name | The person is created in that keystroke. The date is asked second. The do date moves to match. The due date does not. Every reminder on the task suspends and the task page says so. |
| Let the expected-by date pass | The blocker's state becomes late overnight. No date moves. The next planning session asks once, with three answers. |
| Press N, pick from the four, then give no reason | The override row records both tasks with a null reason. The rejected task is still on today with its hours intact. |

## Do not build these

A build agent asked to make a task manager will reach for all of these. None of them are in this one, and each was rejected with an argument in decisions.

A priority field

Tags

Subtasks

Custom fields or per-type schemas

Confirmation dialogs

Toast notifications

Colour-coded statuses

Percentage progress

Streaks

Energy or difficulty fields

Story points or pomodoros

Icons, colours or covers on tasks

A sidebar project tree

Calendar or email integrations

Location-based reminders

Auto-closing stale tasks

Silent weight learning

A cap on visible columns

Illustrated empty states

Anything multi-user

## The seven documents

| Document | What it is for |
| --- | --- |
| The brief | Why the app exists and what counts as success. Read it once. |
| The spec | What is in, what is out, the stages and the costs. |
| Decisions | Every settled behavioural rule. The largest document and the one to search when something is ambiguous. |
| Reminders | Notification wording, actions, snooze mechanics, capture syntax for reminders. |
| Blocks across shifts | The overlap-charging arithmetic, worked through. |
| Resolutions | Twenty-six numbered answers that unblocked the build, including six corrections to decisions. Where the two disagree, this wins. |
| Wireframes and the prototype | What the screens look like and how the three answers behave. The prototype is clickable and keyboard-driven. |
