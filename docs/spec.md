### Two of seven · what gets built

# The spec

Everything in version 1, everything left out, the order it gets built in, and what it costs. How each feature behaves is in decisions and resolutions; why any of it exists is in the brief. The stage boundaries here were corrected by R21 and R22 — a plain today ships in stage 1, and the start reminder waits for stage 2. Building order is in the handoff.

## The build order, and why it is this way round

The first plan was to build the deadline calculator first, because it is the cleverest part. That was advice for a tool you visit occasionally. This is a tool you live in, and the calculator is worthless until capture, recurring tasks and durability already work.

### So it is reversed

Build the boring, reliable half first and switch over the moment it can hold the board. Then add the clever half while already living inside it. Real usage data arrives sooner if one's living and breathing in the app, instead of using it for only decisions-layer and the interesting features get designed against actual behavior rather than memory of it.

## Five stages

The switch from the old tool happens at the end of stage 2.

| Stage | Goal | Hours | What is in it |
| --- | --- | --- | --- |
| 1 | It holds your tasks and their details, reliably. | 32–44 | Capture by typing, with heavy quick‑add syntax. Projects and sub‑projects. Search across everything. Notes. Recurring tasks, with the rule stored separately from each occurrence. Kind on every task. Habits and their progress. Reminders. Server storage, recoverable deletes, undo everywhere, weekly export, and measurement of how often the app is opened, how long it is worked on and the gaps between opening it. |
| 2 | It protects the deadlines | 20–30 | The deadline chain: working backwards from each promised time, through the top of every estimate, in personal or other person's real timezones depending on the task kind, to a latest safe start. Working hours stored as data with history. Shifts and their capacities. Scheduled total time. Dependencies, including who you are waiting on and when they said they would deliver. Alarms fired by a scheduler independent of the app. Capture tasks and read‑only views on mobile. |
| 3 | It makes you decide | 24–34 | The planning queue, running on real data. Closing today. Costs computed rather than invented. Question count derived from how bad the day is. The not‑happening list. An exit to the board on every question. |
| 4 | It tells you what you actually do | 10–18 | Estimated against actual. What gets pushed most often, and for how long. Habit quotas are introduced. Which queue answers you later reverse, and the reasons you gave. Gaps in use. |
| 5 | It listens | 14–21 | Capture by voice. Editing by description, with the changes shown before they apply. The open dump, labelled useful or not useful, useful parts tagged and retrievable. Questions for light days drawn from it. A local‑only option and a delete‑everything control. |

100–147 hours in total. At eight hours a week that is thirteen to eighteen weeks, with the switchover at roughly week seven.

## In version 1

| Feature | What it does | Why it is in |
| --- | --- | --- |
| Capture, typed or spoken | Say or type a task. Speech is transcribed and split into candidate tasks with an estimate and whatever reason you gave. Confirmed in a fast queue. Typing is an equal, not a fallback, and understands quick‑add syntax. | Capture has to be faster than the thought. Voice for volume, typing for precision and for when speaking is not possible. |
| A reason on the task | One line, optionally given at capture, kept for the task's life. Repeats inherit it. Editable. | Written once, it makes the board readable without re‑annotating anything. |
| Facts the app works out for itself | Latest safe start, the other person's timezone, days since it was touched, how many times it has been pushed, whether an unbroken block exists, estimated against actual. | Most of what makes a decision obvious costs the user nothing to maintain. |
| Projects and sub‑projects | Two levels in the interface; the data model handles any depth. Every task belongs to one. The board filters by a project or by a whole tree. | At large amount of live tasks, seeing only work or only one client is a precondition for planning at all. |
| Search | Across titles, reasons, notes, completed work, half‑formed fragments, and the app's own settings and saved views. | Finding things is a real problem at this volume. Filing and retrieval are not conveniences here — Awais mostly has a large list to get through before he can close a day, and without search the backlog becomes write‑only. |
| Notes | Free text attached to a task, or standing on its own. Examples of notes are credentials, a message from a boss, a reference. | These have nowhere else to go because these are work related notes, albeit without deadlines or due dates. Without a place for them the board stops being complete. |
| Recurring tasks | Daily, weekdays, weekly on chosen days, monthly on a date, every N weeks. Two kinds: repeat on fixed dates, and repeat N days after you last finished it. Rule stored separately from each occurrence. | Recurrence touches the whole board. Separating rule from occurrence is what makes clean history and clean misses possible. |
| Shifts | Named stretches of a day, each with a time window, the days of the week it applies to, the task categories it accepts, and an optional capacity. | Everyone's day is shaped differently. Shifts are how the app learns the shape without assuming one. |
| Capacity and scheduled total time | Capacity is the hours of real work a shift can hold, by default it is the full time window of the shift. Scheduled total time is the sum of estimates on the tasks currently in it. The queue shows what is left and refuses what will not fit. | Refusing over‑commitment is the thing this app exists to do, and it needs both numbers. |
| Deadlines and the chain | Any task can be fixed in the day and deadline‑bearing. The chain is the ordered set of them, with latest safe starts computed backwards through estimates and timezones. A day may have many, one, or none. | A deadline might be a client deliverable, a school run or an exercise slot. The arithmetic is identical; only the content differs. |
| The calendar | A day, a week, or any number of days you ask for. Every day has a sticky all‑day strip and an hour grid beneath it. Dragging a task into the all‑day strip sets its do date. Dragging a task into the hour grid sets its do date and a block, and the block is resized by dragging its top or bottom edge, or by typing the start and end times. Anything you place yourself is marked as yours and is not moved without asking. A block is charged to every shift it overlaps, for the part of the block inside each one, and any part of the block that no shift covers is charged to nobody. A block's length is the task's estimate — one number, never two. Drawing a block sets the start time, the end time and the estimate in one action. Dragging in a task that was typed opens its block at the length of its estimate, and resizing the block afterwards rewrites that estimate. A drop is never refused; when a block runs outside the shift it started in, a small tablet at the bottom of the screen names what it runs into, and when a block puts a shift over its capacity a popup comes up instead, with a link into the queue for that shift. A blocked task drags like any other task and the drop sets its do date — the user owns the task, not the person blocking it. When the do date you set lands after the due date, a tablet names the overshoot and offers two buttons: move the due date to match, or leave the due date alone. | Moving work between days is the thing people do most often, and opening a task to edit a date field is too slow to do twenty times. The two regions exist because the day you intend to do something and the hour you intend to do it are different commitments, and most work only ever deserves the first one. |
| Answering on today | Three keys, and one of them branches. Done. Not today — which opens in place and asks which day: tomorrow, a named weekday, a day you pick, no date, or waiting on someone. Something else — which asks what you are doing instead: the next few ranked tasks, a search field, and the reasons. Naming the task that wins is required; giving a reason is not. Every answer writes a line naming what happened, with an undo beside it. | The screen's value is that it holds one thing at a time, so answers have to be complete without a fourth key or a second screen. And a push that does not say where the task went is how a Thursday quietly fills up. |
| Dependencies | A task can be blocked on a person or an event. The blocker records who or what is needed and the expected‑by date — the day that person said the thing will arrive. Expected by exists only while a blocker exists; a task with no blocker has no expected‑by date. Setting an expected‑by date sets the task's do date to the same day by default, because you cannot start before the thing lands, and you can move the do date afterwards. The due date is never touched by the blocker. Removing the blocker removes the expected‑by date and leaves the do date and the due date as they are. A blocker is reached from today through the waiting‑on branch of not today, and it suppresses the safe‑start alarm while the commitment itself stands unchanged. The app surfaces the blocker when the moment to chase arrives. | A dependency parked in a list expires silently. Recorded properly, it becomes something you can resolve. |
| The planning queue | Questions generated from the gap between capacity and committed time. Each option shows its cost. Every question has an option that exits to the board. How many questions there are follows from how bad the day is. | Knowing your priorities and applying them at the end of a shift are different abilities, and the second one degrades. |
| Estimates | A single number, never a range. An estimate is optional: a task without one sits as an all‑day task and takes nothing out of any shift. A setting gives unestimated tasks a default length, per category if you want, and it can be left off. | Every piece of arithmetic in the app needs one number, and a block on the calendar has one length. Making the estimate compulsory would make you invent figures, and an invented figure is worse than a missing one because the arithmetic believes it. |
| Reasons for overriding | When you reject the ranking or exit to the board, one tap records why: the one I picked matters more than you think, the offered one's estimate is wrong, wrong time of day for the offered one, fresh information — or a fifth choice that takes a line of free text when none of the four is honest. The wording carries the side, so nothing has to ask which task the reason describes; fresh information is filed against both. The reason is optional. What is stored on every override is the task rejected, the task chosen instead, the reason if given, and which task the reason points at. | Overriding once is cheap. Overriding the same misjudgement every night is a daily tax, and without a recorded reason there is nothing to diagnose. |
| The not‑happening list | The written, dated output of planning: what is not happening, and who has been told. | The thing no other tool produces, and the reason tasks sit for six months without a decision. |
| Reminders | Push notifications, fired by a scheduled job on the server rather than by the app being open, to every device you are signed in on. Two kinds. The ones you set: any number per task, from presets at one day, thirty minutes and fifteen minutes before or at the due time, relative to the due time so moving the deadline moves them. And the start reminder, which is a reminder whose offset the app computes: on every commitment that carries a due date, at the due time minus the estimate — or at 00:00 on the due date where there is no due time — recomputed whenever the estimate, the due time or the other person's timezone changes. A do date gets no reminder of its own — if you want warning before a day you set for yourself, you add a reminder like any other. A default‑reminder toggle in Settings, off out of the box, arms one reminder on every task you add from then on. The notification carries two actions, Done and Later; Later expands into three reasons and each reason is the snooze. There is no warning‑period field — the day a task starts appearing as work is computed. Full wording, capture syntax and rescheduling rules are in Reminders v1. Yours are off unless you add them; the safe-start one is on unless you remove it, and removing it says what you are giving up. Completing on one device withdraws the notification from the rest. | Some things need a hard time on a specific day, and a list you have not opened cannot deliver that. The same machinery covers the deadline you promised someone: no missed commitments is the day-sixty test, and it depends on being told at the last moment you can still start. Push is the only channel — no calendar events, no texts — so the work that would have gone into a second channel goes into making the one channel reliable: server-side scheduling, permission checked at setup rather than assumed, and a visible warning on any device where notifications are off. |
| Mobile capture and reading | Full read of today and the board, plus capture. Editing and planning stay on desktop. | Thoughts and calls happen away from the desk. Full parity is wanted later; it is a second build, not a v1 cut. |
| Counts of how often things get pushed | Incremented on every re‑date, shown on the row. | Four pushes is information. It turns deleting something into bookkeeping rather than failure. |
| Measuring engagement | Opens per day, planning sessions finished, length of time between each time the app is opened (take into account the mobile and desktop versions both) and the length of any gap in use. | Going a month or two without opening a task manager is the failure this app most needs to detect, and it can only be detected by measuring. |
| Undo everywhere, recoverable deletes | Every action reversible; deletes recoverable for thirty days. | Reversibility is what buys the right to skip confirmation dialogs. / |
| A calendar view | Wanted — day, week, an arbitrary number of days — not finalized the design/build yet. | Calendar allows the user to quickly move tasks from one day to the next, without having to use the date-field after opening each task. It also allows one to see the tasks that are on their plate for any give time. |

## Not in version 1

| Feature | Why not now | When |
| --- | --- | --- |
| The app placing tasks into your day | Needs actual‑time data and a settled capacity model first, or it produces fiction — one call runs long and the whole grid is a lie you now have to maintain. The chain has real times because deadlines are real; everything else is ordered, not scheduled. | v2, once estimated‑against‑actual has accumulated. |
| Habits defending and re‑placing themselves | Needs the app to own placement, so it arrives with scheduling. Its three inputs are already stored from day one. | v2, with scheduling. |
| Tags, priority levels, subtasks | Three more places to put a thing instead of deciding it. Priority in particular duplicates what the queue works out from live facts. | Only if a real need appears that projects cannot serve. |
| Learning your estimates | Needs weeks of data. Actual time is recorded from stage 1 so the data exists when the feature arrives. | Stage 4. |
| Outlook Calendar, Gmail TickTick, Todoist and Slack integrations | Convenience rather than correctness, and a permanent source of stale data to reason about. | Unavoidable if this becomes a product. Not before. |
| Full mobile parity | Editing and planning on a phone is its own interface problem, not a smaller version of the desktop one. | After stage 3. |
| Awkward recurrence rules | Third Tuesday, last weekday of the month, end‑of‑quarter. Where recurrence engines accumulate subtle bugs, for cases you can hand‑date twice a year. | Hand‑date the exceptions. |
| Anything multi‑user | Accounts, sharing, permissions, billing. Turns a three‑month project into a nine‑month one before the model is proven. | Day sixty, if the success test passes. |

## Stored from day one, not shown yet

Scheduling is wanted eventually and deliberately not now. A single date field gives a scheduler nothing to move. Adding the split now makes scheduling a feature later; skipping it makes scheduling a migration. Fields only — no speculative code.

| Field | Why now |
| --- | --- |
| Do date and due date, separate | Due date is the hard limit and it moves only when the user moves it. Do date is the day the user intends to work on it, and it is what the calendar writes and what the ranking reads. Both shown in v1, both set by the user. This split makes everything below possible. |
| Expected by, on the blocker | The day the other person said the thing will arrive. It lives on the blocker rather than on the task, so it exists only while the task is blocked. It seeds the do date when it is set and it never moves the due date. |
| Who set the do date | A scheduler cannot know what it is allowed to move without this. In v1 it is always the user, which is exactly why it is free now and ambiguous later. |
| A scheduled block, possibly empty | Start and end. In v1 the user sets it by hand; later a scheduler writes to the same field. Same shape either way. |
| Who placed that block | A block you placed is never moved without asking; one the app placed can be reshuffled freely. One flag now; every existing block is ambiguous if it is added afterwards. |
| Task‑to‑task blocked‑by links | Stored, not acted on. With the links present, shifting dates down a chain later is arithmetic. Without them it is a data‑entry campaign across the whole list. |

## Running cost

### Hosting and database

$0–25 / mo

Free tiers are genuinely enough for one user. You pay when you want scheduled jobs that never sleep.

### AI coding assistance

$20–60 / mo

The largest recurring line, and the one that decides whether the hour estimates hold.

### Voice and model calls

$3–8 / mo

Transcription is about a cent a minute. Two minutes a night is under a dollar a month.

### Alarms, domain, sundries

$0–15 / mo

A domain is optional for something only you open.

The dominant cost is hours, not dollars.

## The switchover

You cannot run two task managers, so this replaces the old one. But a hard cut with no bridge is how people lose a deliverable and abandon a project in one evening.

So: **fourteen days, one direction only.** The old tool goes read‑only the day you switch — something you copy out of and never write into. Nothing is entered twice. After two weeks, if the commitments have shipped on time every day, export the old data and close it for good. If one was missed because of this app, you know precisely what to fix before betting again.

The third attempt has an advantage the first two did not: you will not drift away from a tool that owns your payroll deadline. That is also the risk, which is what the reliable reminders are for.
