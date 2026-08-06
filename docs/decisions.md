### Three of seven · every settled rule

# Decisions

How every part of the app behaves. Screens first, then the mechanics behind them. Everything here is decided. Six rules were later corrected where two documents disagreed — those corrections are in resolutions, and where the two disagree, resolutions wins. Anything still unanswered is in open.

## Words used throughout

| Word | Meaning |
| --- | --- |
| Task | The only kind of thing in the app. Everything else is a property of one. |
| Kind | Commitment, own, habit, or unassigned. Decides what happens when the task is missed, and nothing else. |
| Category | What area of life a task belongs to — work, personal, and whatever else the user names. Shifts admit tasks by category. |
| Timed task | A task where you named an hour. "Call the bank at 10am." The time is the answer, so the app saves it and does no filtering. |
| Untimed task | A task with no hour. It flows into whichever shifts accept its category, and the queue decides when it gets offered. |
| Shift | A named stretch of a day: a time window, the weekdays it applies to, the categories it accepts, and an optional capacity. Users define their own. |
| Capacity | The hours of real work a shift can actually hold, equal to the total window time by default. / |
| Scheduled total time | The sum of the estimates on the tasks currently sitting in a shift. Always worked out from the tasks, never stored or typed. |
| The chain | The day's fixed, deadline‑bearing tasks in order, each with the latest time you could start it and still deliver. Computed, never dragged. |
| The planning | Close today, then plan tomorrow, one question at a time. It happens at whatever hour the user has chosen to plan. |
| Latest safe start | Working backwards from the due date and time, through the task's estimate, to the last moment you can start and still make it. The reminder that fires at that moment is the start reminder. Which clock it uses depends on the kind: a commitment is computed in the other person's timezone, your own tasks in yours. |

## Shifts

Shifts replaced the earlier idea of budgets. A budget was a named slice of the day with its own hours. A shift is that plus two things that make it earn its setup cost: it knows which weekdays it runs on, and it accepts only certain categories of task.

| Rule | Detail |
| --- | --- |
| A shift has four parts | A time window, the days of the week it applies to, the task categories it accepts, and a capacity. Only the first two are required. |
| Admission is by category, not by task | You never assign a task to a shift. A shift says "I take work tasks", and every work task is eligible for it. Tagging tasks one by one would be a cost paid per task per day, which fails the fourth test in the brief. |
| Timed tasks ignore shifts entirely | If you named an hour, that hour is the answer. The app saves it and does no filtering. Naming an hour does not arm a notification — it makes the reminder presets available, because there is now a time to be fifteen minutes before. Shifts only ever route untimed work. |
| Capacity is per shift, never per day | There is no single daily number any more. A day's total is only ever the sum of its shifts, and it is shown as information rather than as something the app refuses against. |
| Capacity defaults to the length of the window | The app fills it in from the window and says so plainly, so a new shift works immediately. Almost everyone will correct it downward, which is the point — correcting a number is easier than inventing one. |
| Setting shifts up is never a prerequisite | Skip the whole thing and you get one shift called Day, covering your waking hours, accepting every category. An app that does nothing until it has been configured is one most people never see working. |
| The day is never twenty‑four hours | A capacity of twenty‑four never refuses anything, so it is a number that is always green and therefore useless. Onboarding asks for waking or working hours once, with a worked example: *"Mine is about five. I am up at 10, but two of those hours go to email and the school run."* A stranger's concrete day explains what an abstract prompt cannot. |
| The app suggests a corrected capacity after two weeks | Once the completion log shows how many hours actually get finished in a shift — that six was optimistic, that Tuesdays run to three — the app offers a corrected number where you are already editing capacity. Plain words, dismissible, never applied on its own. |
| Shifts are editable at any time | Windows, days, categories and capacities all change without disturbing anything already planned. |

## Scheduled total time

Capacity says what a shift can hold. Scheduled total time says what is in it. The difference is what is left, and that is the number the queue acts on.

| Rule | Detail |
| --- | --- |
| It is arithmetic, not a field | Nothing stores it. It is the sum of the estimates on the tasks currently in a shift, recalculated every time one is added, moved or completed. Nothing to set, nothing to drift, nothing to migrate. |
| Remaining time is what gets shown | A three‑hour morning shift holding one twenty‑minute task reads *2h 40m left of 3h*. Remaining is the number you act on; the committed total sits underneath it. |
| Tasks without an estimate are counted separately | *2h 40m left · 6 tasks unestimated.* A single clean number that quietly excludes half the queue is worse than no number at all. |
| Timed tasks still consume the shift | They skip the routing, not the arithmetic. A meeting at 10am inside your morning shift takes its hour off that shift, so a day full of calls correctly shows an empty one. |
| Carried work counts the moment it is carried | Yesterday's unfinished tasks enter tomorrow's total when you answer "carry" in the queue, not when you next open that shift. |
| The day total is information only | Summing every shift gives a day figure. It is displayed and never used to refuse anything — refusal always comes from a specific shift. |

## The board

A spreadsheet‑like sheet with a search bar over it. One configuration panel, and search that takes over the screen rather than filtering in place.

| Rule | Detail |
| --- | --- |
| Default arrangement | All active tasks, grouped by project, soonest due first. Columns: title, project, due, estimate. |
| The title column cannot be switched off | Every other column can. |
| All configuration in one panel | Columns, grouping, second grouping, sort and the stale treatment. Nothing about the board lives in Settings. |
| No limit on columns | Turn on as many as you like, with no warning. The tally already tells the truth. |
| Columns slide under the title | The title column is frozen with a shadow and the rest pass beneath it. The header carries a count of what is hidden each way — ◂ 2 · 4 ▸. Clicking it lists them and lets you drag one next to the title. Reordering is the control; scrolling is the fallback. |
| Searching flattens the board | One keystroke drops grouping and columns and ranks the results. Escape returns you exactly where you were. |
| Search covers everything | Active tasks, completed work, notes, half‑formed fragments, and the app's own content — settings, saved views, project names. Results are grouped by what kind of thing they are, and each kind carries only the actions that make sense for it. |
| Tab turns a search into a filter | The typed word becomes a chip, grouping comes back narrowed, and group counts read "2 of 18". This is the only route from searching to a saved view. |
| Saved views | Five or so plain words above the sheet, the current one underlined. Created only from a filtered state, never from a blank form. |
| Adding a task while grouped | Each group ends in a blank row already carrying that group's project. Type and press return. |
| Adding a task while ungrouped | One row pinned at the bottom. It asks for the project after the title. |
| The board is not the main way in | Deliberately kept plain so the user knows the board is there for organizing or retrieval of stuff, not adding new tasks. |
| Turning grouping off costs a column | Project column then becomes optionally visible. User can choose not to display project column at all. |
| State is written, never coloured | Missed, blocked, recurring, kind‑not‑set and not‑happening all read as words in the title line. No colour code to learn. |
| Blocked rows | Keep their checkbox but cannot be ticked. The thing blocking them is named in the title line. |
| Long titles | Cut off on one line by default. Wrapping is a setting applied to the whole board, not per row. |
| Completed work | Same board, filtered out by default, always searchable. |
| Clicking a row | Does nothing by default — fields edit in place. Three alternatives in Settings: expand in place, open in a new in‑app tab, open in a draggable sidebar. |
| Acting on many at once | Select several, then push, re‑project, change kind, add estimate, move to projects/subprojects or kill. The action bar exists only while something is selected. Items that could be displayed on action bar may change later. / |
| Empty board | One line: "All tasks completed and hidden - Nothing on the board." No illustration, no encouragement, add row already focused. |
| No board on mobile in v1 | The phone is for capture and for today. |

## Work that has gone stale

The one thing the board can tell you that the day screens cannot.

| Rule | Detail |
| --- | --- |
| Stale at fourteen days | Untouched, not unfinished. Fourteen days without being edited, pushed or worked on. |
| A block at the top of the board | Ruled in magenta, demanding a decision. The quieter alternative — marked in place, no interruption — is a setting rather than the default. |
| Three at a time | However many are stale, three get rows. The rest are counted, with the oldest age named. |
| Three actions each | Keep, push, kill. Nothing else. |
| Keeping mutes it for fourteen more days | Not a reset. The count is kept and shown: the second appearance reads "kept once", the third "kept twice", with the total age beside it. So an untouched task returns at fourteen days, twenty‑eight, forty‑two, and onward. |
| The interval never lengthens | Doubling to twenty‑eight and fifty‑six days was rejected: it hides a task for longer exactly as the evidence it is dead gets stronger. Fixed interval, rising visibility. |
| Keeping is a decision, and is recorded | Keeps feed the same data as pushes. Three keeps on one task is either a ranking problem or a reality problem, and the app should be able to say which. |
| Sweeps appear when it gets bad | Past a handful, going row by row is the wrong offer. "Go through all eleven" and "kill all eight" appear alongside. |
| Nothing stale, nothing shown | The block is absent and nothing replaces it. No all‑clear banner. |
| It survives every column configuration | Including title‑only. The block is not a column. |
| A manual off switch | The whole stale mechanism can be turned off. Someone who finds it punishing rather than useful should be able to stop it without arguing with the app. |

## Today

The screen you live on during a shift. Not a filtered board — a different model, in which a task is a promise someone is waiting on rather than a line you wrote.

| Rule | Detail |
| --- | --- |
| One thing, large | The screen commits to a single next action and prints why it chose it. Everything else drops to a list you can read but not fiddle with. |
| Ranked by whose day closes first | Timezones and who is blocked decide the order, because that is what actually makes a task urgent. It only applies where the app knows those facts. |
| Due date and time is the fallback | Where nobody is waiting, the order is due date then due time — never the order you typed them in. A custom sort is available, and once chosen it is honoured as given. |
| Three answers, three keys | Done, not today, something else — D, L, N. Keys work anywhere on the page; the pointer is optional. Three stays three: a fourth key was considered for work you cannot do and rejected, because the screen's whole claim is that it is uncluttered. |
| Something else asks what beat the ranking | N is not a dismissal. Pressing it opens the next few ranked tasks and a search field, and the pick is required — the answer has to end with a named task. Without the pick the app knows only that you said no, and what won is where the missing field lives. The task you skipped stays on today, keeps its estimate and its hours, and drops into what is left of the day. |
| Four reasons and a fifth you write | One tap on the same four the queue already uses. Each one names its side in its own wording, so the tap says which task it is about without a second question: *the one I picked matters more than you think*, *the offered one's estimate is wrong*, *wrong time of day for the offered one*, *fresh information*. Fresh information is the only one filed against both tasks, because either could be the thing that changed. A fifth choice takes free text for the times none of the four is honest. No "other" that leads nowhere — choosing the fifth means writing the line. |
| The reason stays optional; the pick does not | A required reason turns every override into a small interrogation, and people answer interrogations with whatever clears the screen fastest. The named task is the fact worth having, so that is the only thing insisted on. |
| Free‑text reasons are read, not just filed | They are the sample that tells you which fifth canned reason to add later. A free‑text box nobody reviews is a place for evidence to go and die. |
| Not today expands rather than pushing silently | L opens a row in place: tomorrow, a named weekday, pick a day, no date, or waiting on someone. This is the quick reschedule, and it closes the hole where L moved a task off today without ever saying where it landed. |
| Waiting on someone is a branch of not today, not a key of its own | The difference between the two is which date the answer writes. Naming a day writes the do date: the task stays yours and counts against that day's shift. Naming a person writes a blocker with an expected‑by date, and that date seeds the do date. The task then greys back, drops below your own work with who and when in its title line, and every reminder on it is suspended, because warning you about something you cannot do is noise. Same question asked, different fields written. |
| Being a commitment does not cover being blocked | The two point in opposite directions. Commitment means someone is waiting on you. Blocked means you are waiting on someone. A task can be both at once and usually is — you still owe Ravi the review, you just cannot do it until he ships. The kind field stays correct and unchanged; the blocker is the separate fact that suspends the reminders. |
| When a task already carries a blocker, L edits the expected‑by date | Nothing is added. The person is already recorded, so the branch offers the one field that moved: the day they now say it will arrive. Editing it re‑seeds the do date and leaves the due date alone. |
| Three dates, and each one has an owner | Due date is the deadline and only the user moves it. Do date is when the user intends to work on it, and the calendar writes it. Expected by is the other person's forecast, it sits on the blocker, and it disappears when the blocker does. A task waiting on Ravi and owed to Priya is two tasks, not one task holding two dates. |
| A late expected‑by date changes state, not dates | When the day the other person named passes, the do date does not move on its own — the app rescheduling your work because somebody else slipped is exactly the decision the queue exists to make you take. The blocker's state goes from waiting to late, the task's line reads *Ravi is two days late*, and the next planning session asks about it once with three answers: chased him, he gave a new date, or the blocker comes off. |
| Safe‑start alarms read the due date only | The alarm works backwards from the due date and time through the estimate. Do dates get no alarm in v1, because a day the user picked for themselves is a plan rather than a promise, and the user can set an ordinary reminder for it. An optional do‑date reminder is a later version. |
| Pushing something names its cost | "Not today" prints who is affected and by how long. The screen never accepts a push silently. |
| No confirmation dialogs anywhere | Every action resolves instantly, states its consequence in the same line, and undoes. There is nothing left for a dialog to protect. |
| Ticking something re‑prices the shift | Estimates and meetings draw on the same hours, and the remaining time updates in the same frame. Cause and effect are never on separate screens. |
| Work you are waiting on is visibly not yours | Present but demoted. It must not read as something you are failing to do. |
| Today does not re‑plan | A one‑task screen is the wrong tool the moment the day stops matching the plan, and re‑planning is not the board's job either. Today carries two doors: one to the queue, one to the board when you need to look rather than decide. |
| The queue can run mid‑day | It is not only a once‑a‑day ritual. Called from today, it takes the hours that are left as its capacity and asks the same questions about what now will not happen. |
| Hours that open up mid‑day are offered, once | When an answer on today frees or removes hours, a line appears under the ledger naming what changed and offering the queue. It is a link, not a second mode on today, and it is absent unless the day actually changed. Waiting for the night close to spend a freed afternoon is too late. |
| Setting a date shows the day's total and asks nothing | Moving a task to Thursday prints what Thursday now holds. A day has no capacity of its own, so there is nothing to be over and no question to ask. You meet Thursday's real problem when you plan Thursday, which is the moment you can act on it. Silence would be the wrong answer — that is how a Thursday ends up holding fourteen hours with no memory of how. |

## The queue: closing today, planning tomorrow

Run once a day, at whatever hour the user plans — the end of a shift for one person, first thing in the morning for another. You are never asked to arrange anything. You spend a known capacity one decision at a time, with the cost printed before you pick.

| Rule | Detail |
| --- | --- |
| When planning happens is the user's choice | The app never assumes an evening. Planning is a session you start, at an hour you set, and the app only needs to know which day you are planning for. |
| Closing today comes first | The queue accounts for today before planning anything: what you committed to, what is untouched, and for each one done, not doing, or carry. Fifteen seconds, in the same flow. You cannot plan a day honestly without knowing what was missed in the one before it. |
| Carrying is a decision like any other | Untouched work is never swept forward silently. Each task is answered, and carrying is recorded as carrying — which is what feeds the push counts, the stale rule, and the app's ability to say that four re‑dates is an answer. |
| Estimates are calibrated here or nowhere | Estimated against actual is compared at close, because nothing else in the app ever asks. Without it the estimate is a number you invent and never read, and capacity becomes a guess about guesses. |
| The chain is computed, not planned | Fixed commitments are derived backwards from other people's clocks and shown as a chain you cannot drag. Planning happens in what is left. |
| Remaining time is described by its shape | Three stray gaps and one unbroken run, not "four hours". A four‑hour total is not a four‑hour block. |
| One question at a time, large | Contested time becomes a question with two to four options, each carrying its cost. No arranging, no dragging. |
| Only real trade‑offs become questions | A question appears where the choice actually costs something — contested time, a window about to expire, a promise that will be missed. Where the work simply fits, it is placed and reported. This is what stops several shifts each producing their own trivial question and turning a ninety‑second plan into ten minutes of trivia. |
| A short queue is a good queue | Length varies with how bad the day is, and there is no minimum. If nothing is contested, the queue opens on the finished plan and says so. |
| Every question has a fourth door | "None of these — show me the board" ends the queue and hands you the full day. An opinionated screen with no exit is a cage, and taking the exit is not failure. |
| The output is what is not happening | The plan closes with three lists: committed with times, going out tonight so others can act without you, and explicitly dropped. The dropped list is the real product of planning. |
| Nothing dropped is a warning | An empty drop list means tomorrow is over‑planned again, not that you had a good day, and the queue says so. |
| Answers commit instantly and reverse | Each pick lands, prints its consequence, and U undoes it. Ninety seconds start to finish, no confirm step. |
| Protected days are rules, not empty containers | A day off does not appear as a container to fill. It appears as a rule that refuses new work and asks about anything already sitting on it. |
| Repeated pushes are data | Four re‑dates is an answer. The queue says so out loud and offers deleting as bookkeeping rather than failure. |

## The calendar

The calendar exists so that moving work between days is a drag rather than a trip into a task and out again. It shows a day, a week, or any number of days you ask for. Each day has two regions, and which region you drop a task into decides what the app records.

| Rule | Detail |
| --- | --- |
| Each day has an all‑day region and a timed region | The all‑day region is a sticky strip at the top of the day. The timed region is the hour grid below it. The two regions record different things, and dropping a task into one of them is how you choose which. |
| Dropping a task in the all‑day region sets its do date and nothing else | The task is now work you intend to do on that day. The app is told the day and is told nothing about when in the day, which is the honest record for most work. |
| Dropping a task in the timed region sets its do date and a block | The drop sets the do date from the day you dropped it on, and it sets a block from the time you dropped it at. The block is a start time and an end time, and it occupies that stretch of the day whatever the day's shifts are doing across it — one shift, two, or none. |
| A block is resized by dragging its edges or by typing the times | Dragging the top surface of the block moves its start time. Dragging the bottom surface moves its end time. The same two times can be typed in instead, and typing and dragging write to the same three fields: the start time, the end time, and the estimate. |
| A block you dragged is a block you placed | The *placed by app* flag is false on anything you dropped or resized yourself, so the app will not move it without asking you. A block the app places later carries the flag as true and can be reshuffled freely. |
| Every shift a block overlaps is charged for the part of the block inside it | A block is charged by overlap, not by where it started. A two‑hour block straddling noon takes an hour from the morning shift and an hour from the afternoon one. The charge is never split by proportion or guessed at, because the overlap is a real number of minutes that the block genuinely occupies. Each shift's remaining time updates in the same frame as the drop. |
| Time in a block that no shift covers is charged to nobody | An hour of a block that sits in a lunch gap, or after the last shift of the day, is time genuinely outside your shifts. No shift absorbs it and no shift is stretched to reach it. The rest of the same block is still charged to whichever shifts it overlaps. |
| A block is charged to a shift even when the shift does not accept the task | The category rule on a shift governs what the app may place there. It does not govern what your own hands do. A block you draw across a calls‑only shift occupies that hour, so the hour is charged, and the tablet names the shift and what it takes. |
| A block's length and the estimate are one number | They never come apart. A shift is charged the minutes the block occupies, and those minutes are the estimate. |
| Dragging a task into the grid opens its block at the length of its estimate | A task typed in with a forty‑minute estimate becomes a forty‑minute block. You choose where it goes and the app already knows how long it is. |
| Resizing a block is how you change an estimate | Dragging the top or bottom surface of a block is a deliberate act, so the app reads it as you saying the task will take longer or less long than you thought. The estimate is rewritten to the new length, and the shift is recharged. Typing the start and end times does the same thing. |
| Drawing a block sets the start time, the end time and the estimate together | Drawing one on the calendar is the only way to set all three at once. A task captured by typing has an estimate and no block; a task drawn on the calendar has all three from the moment you let go. |
| A block that covers a whole shift fills that shift | The covered shift is charged its entire length. If it already held work of its own it is now over its capacity, and the queue asks about it like any other shift that is over. This is the right reading, because you did double‑book that hour. |
| A block that puts a shift over its capacity interrupts, above the tablet's level | A tablet is for keeping you aware. Going over a shift's capacity is a different thing, so it raises a popup rather than a tablet, and the popup carries a link into the queue. The tablet stays for the cases where nothing is over — a block in a gap, a block past the last shift, a block crossing into a shift that takes something else. |
| The queue settles an over‑capacity shift by showing everything on it | Following the link opens the queue on that shift alone, listing every task and block charged to it, including a block that was drawn in a neighbouring shift and crossed into this one. You decide what comes off. The queue does not privilege the shift's own tasks over the block that crossed into it, because the block is one of the things filling the shift. |
| A block at an hour no shift covers is accepted, and the app says so once | The drop is never refused. The block is placed where you put it, the app creates no shift and stretches none, and a small tablet appears at the bottom of the screen saying that this block is not in any shift. The tablet is there to keep you aware, not to make you fix anything. Time in that block belongs to no shift, so no shift's scheduled total time moves. |
| Dropping a task on a future day shows that day's total and asks nothing | The calendar prints what the day now holds. A day has no capacity of its own, so there is nothing for the total to be over and no question for the app to ask. You meet a stuffed Thursday when you plan Thursday. |

## Dates

The most confused area in every task manager. Most apps have three or four date fields and explain none of them, so people fill in the wrong one and then distrust their own list.

| Field | What it is, and the decision |
| --- | --- |
| Due date | The day it must be finished. The hard limit. |
| Due time | An hour on that day, or all‑day. Matters enormously the moment another person's clock is involved. Required for reminders. |
| Do date | The day you plan to work on it, stored separately from due. Most people's lists are ninety percent do‑dates and ten percent real deadlines, and keeping them apart is what stops due dates being abused to make things show up. |
| Who set the do date | You or the app. Always "user" in v1. Free to add now, ambiguous to add later. |
| Warning period | Not shipped. It was a field you filled in to control what a screen showed you, and it overlapped the start reminder so heavily that neither one had a clear job. The behaviour is computed instead: a task appears as work from its do date, or from the day its start reminder falls, whichever comes first. See Reminders v1. |
| Defer until | The task genuinely does not exist to you until this date — absent, not greyed out. A greyed‑out row is still noise. |
| Snooze | No task carries a snooze field. Deferring and snoozing are the same mechanism with different intent, and the field that pushes a task out of sight is *defer until*. A notification has a *later* action that reschedules that one reminder and touches no date, and the word snooze is retired from the interface so the two are not confused. |
| Scheduled block | Start and end. Set by hand in v1; a scheduler writes to the same field later. |
| Created, modified, completed | Automatic. Invisible until they power age, staleness and "what did I actually do last week". |
| Expiry | Not shipped. After some dates a task is pointless rather than late, but almost nobody ships this and the case is narrow. |

## How long, and what shape

The estimate says how much time a task needs. Chunking says what shape that time has to be. Both are needed before the queue can honestly say what fits.

| Rule | Detail |
| --- | --- |
| An estimate is always a single number | Never a range, whatever the route in — quick capture, typed in the app, or brought from somewhere else. A range would make every piece of arithmetic in the app choose which end of it to use, and a block on the calendar has one length. Actual time is recorded from day one, whether or not anything reads it yet. |
| An estimate is optional | A task can carry no estimate at all. It sits as an all‑day task, takes nothing out of any shift, and appears in the queue as work for the day with no cost against it. Refusing to let a task exist unpriced would push you into inventing numbers, and an invented number is worse than an absent one because the arithmetic believes it. |
| The default estimate is a setting you turn on | With it on, anything that arrives without an estimate is given the default length. The default is set in Settings and can be set per category rather than once for everything. With it off, an unestimated task stays unestimated. |
| The queue offers an estimate and never insists on one | When the queue reaches a task with no estimate it offers a field, and taking the task for the day without filling it in is a complete answer. The task goes onto the day and is counted among the unestimated ones. Making the field compulsory here would turn the one screen you have to get through every day into a place where you invent numbers to escape it. |
| Onboarding never asks for the default estimate | The app ships with a figure and the setting starts off. A guidance tour after sign‑up points at Settings, where you turn the default on or change its length. Asking for a number before you have used the app would be asking you to guess at how long your own tasks take before you have seen one priced. |
| The board does not mark which tasks are running on the default | Turning the default on is you accepting that anything you did not price yourself carries a number the app chose. Flagging every one of those tasks afterwards would be the app reopening a decision you already made, on rows you were not asking about. |
| An unestimated task can only be given a block by drawing one | Dropping it in the all‑day strip leaves it unestimated. Dragging it into the hour grid draws a block, and a block is an estimate, so the task is priced from that moment. There is no way to have a block and no estimate. |
| What length an unestimated task's block opens at | With the default estimate turned on, the block opens at the default length. With it off, the drop is a gesture you have to finish: nothing is placed until you drag out the block's two ends, because the app has no number to open at and will not invent one. |
| Two chunking facts | Can this be split across sessions, and if so what is the smallest piece worth doing. Estimate says three hours; chunking says whether that is three hours in a row or six half‑hours. |
| The queue cannot work without it | Naming the shape of remaining time only has teeth if tasks say what shape they can use. Four free hours in twenty‑minute pieces are worth nothing to a report and everything to an invoice backlog. |
| Asked at capture and in the queue | Available on capture for the person who already knows, and asked in the queue at the moment it matters — when a gap is being offered to a task that may not fit it. Never required on every task. |
| Unsplittable by default | One block of the estimate. Wrongly splitting a task wastes a session; wrongly refusing to split one only leaves a gap unfilled. |
| Splitting can be a net loss | "Deep‑clean the kitchen" is divisible in principle, but stopping halfway leaves the room worse than before you started. What makes most tasks unsplittable is the cost of starting again, not indivisibility — so the question asked is "can this be picked up mid‑way", not "is this one thing". |
| Worked examples | Annual report: 6h, splittable, minimum 45 minutes, because a 20‑minute gap goes on re‑reading where you left off. Invoice backlog: 2h, splittable, minimum 5 minutes. Dentist appointment: 1h, unsplittable. Kitchen: 3h, unsplittable because of the setup cost. |
| Not shipped | Story points, pomodoro counts, self‑reported percentage progress, energy level, difficulty. Points and pomodoros are team or ritual machinery; a percentage you type is fiction; energy is a field people filter by when tired, which is exactly when they will not have filled it in. |

## Recurring tasks

| Rule | Detail |
| --- | --- |
| Five patterns, and no more | Daily, weekdays, weekly on chosen days, monthly on a date, every N weeks. Third Tuesday and last‑weekday‑of‑month are where recurrence engines accumulate subtle bugs, for cases you can hand‑date twice a year. |
| Two meanings, both typeable | Repeat on fixed dates, and repeat N days after you last finished. Rent is due the 1st whether you paid on the 5th or not; plants watered on day 11 are next due on day 18, not day 14. Typed as *every* and *every!* — one character, at the moment you know which you mean. |
| Why a checkbox for this fails | Buried under the frequency in a dialog, it is a second step after you already have what you asked for, so nobody scrolls to it. Fixed dates on the plants gives you fourteen overdue watering tasks after a holiday. Completion‑based on the rent quietly moves your rent date to the 5th forever. |
| The rule is stored apart from each occurrence | What makes clean history and clean misses possible. |
| Missed occurrences do not pile up | Twelve overdue copies of "check crypto funds" turns the list into a monument to failure you stop reading. A missed habit is gone, and the series records the skip. |
| Reasons are inherited | A recurring task's reason is given once and never asked for again. |

## Habits

| Rule | Detail |
| --- | --- |
| What a habit is in stage 1 | A recurring task nobody is waiting on. It completes, the completion is logged, and the log is shown as history. Missed occurrences do not pile up. |
| Quotas arrive at stage 4 | "Three hours a week" rather than every day. Typed at capture as *3h/week*, echoed back in the preview, editable on the task page like any other field. It waits for stage 4 because a quota is only meaningful once there is enough completion history to measure pace against. |
| Progress ships with the quota, not before | *2h of 3h · 4 days left*, worked out from the completion log. A target without progress is a field you fill in and the app ignores, so neither ships without the other. |
| No checkbox | A checkbox cannot say "partway through the period and short of pace". Habits get the fraction and the days remaining, stated flatly and without colour. |
| Behind is not failed | A habit behind pace ranks up and its reason says why — *1h of 3h, two days left*. It never becomes urgent, never alarms, never blocks closing the day. Nobody is waiting on a habit; that is what makes it one. |
| Day‑of‑week constraints only | "Weekdays", "not Sundays", "Tuesdays and Thursdays" are stored and acted on. A time of day is not a constraint — if you want it in the evening, give it an hour and it becomes a timed task. |
| Nothing is parsed and then ignored | Every phrase the parser understands lands on a field something reads. Anything it does not understand, it says so about at capture, while you are still looking at the task. Recording a constraint and doing nothing with it is the app lying by omission. |

## Reminders

Notification wording, the actions on a notification, capture syntax and rescheduling behaviour are all in Reminders v1.

There is one mechanism and it is called a reminder: an offset from a due time that fires a push notification. Nothing else in the app fires. Seeing a task in a list you have not opened does not get the meds taken before 10am.

| Rule | Detail |
| --- | --- |
| Push, or it is not a reminder | An in‑app timer only fires when the app is already open, which is the one case where you did not need reminding. Push means a scheduled job on the server, notification permission, and a device record per signed‑in device. That cost is known and accepted. |
| Push is the only channel | No calendar events, no text messages. The work that a second channel would have taken goes into making this one reliable instead: scheduling on the server, permission checked at setup rather than assumed, and a visible warning on any device where notifications are switched off. |
| One mechanism, and one of them is computed | A reminder is an offset from the due time. The **start reminder** is the one whose offset is the estimate rather than a number you typed, which is what used to be called the safe‑start alarm. Same object, same list on the task, same scheduler. What differs is that commitments get one without being asked. |
| Every commitment gets a start reminder | At the due time minus the estimate, or at 00:00 on the due date where there is no due time, recomputed whenever the estimate, the due time or the other person's timezone changes. On unless you remove it — no missed commitments is the day‑sixty test, and a guarantee you can forget to switch on is not a guarantee. |
| Removing the start reminder says what it costs | Deleting a reminder you set is silent. Deleting the start reminder names what you are giving up, because it is the only thing standing between a busy evening and a missed promise. |
| Every device, one state | It fires everywhere at once. Completing on the desktop marks the task done and that syncs back, so the phone does not fire two seconds later for something already finished. Where a second device fires anyway, the notification is withdrawn rather than left sitting — a stale reminder teaches you to ignore them. |
| Later is the only snooze, and it is per reminder | The notification's *Later* action reschedules that one reminder by fifteen minutes on every device and touches no date on the task. It is the only thing in the app called a snooze. Not today and push move a do date, defer until hides the task, something else moves nothing — four different scopes, and the word snooze belongs to none of them. |
| A snooze records why, in the same press | There is no plain Later button. Pressing Later expands the notification into three reasons — in the middle of something, wrong time of day, waiting on someone — and each reason is itself the snooze. A reminder snoozed four times is the best signal the app can collect and it shows up nowhere else, so it is worth the one extra press. All three reschedule the reminder by the snooze interval and change nothing else. The interval is one value in Settings, fifteen minutes out of the box, and the notification names it. Snoozing the same reminder twice swaps the reasons for a row of longer intervals on the next press, because two snoozes is evidence the fixed value is wrong for that reminder. Where two reasons are both true, waiting on someone wins. No blocker is set from a notification: a notification cannot take a name, and a nameless blocker is one nothing can clear. The planning session asks who you are waiting on and the blocker is set there. No free text on a notification. |
| Several per task | One is rarely enough for anything that matters — a day out to prepare, fifteen minutes out to move. Any number, each firing and syncing on its own. |
| Presets offered at capture | One day before, thirty minutes before, fifteen minutes before, at the due time. Relative to the due time, so moving the deadline moves them with it. A custom absolute time exists and is expected to be rare. |
| Presets need a due time | A task due Thursday with no hour has nothing to be fifteen minutes before, so the presets are not shown on it. In their place sits one quiet caption‑sized line, *add a due time for reminders*, which focuses the time field when pressed. Soft guidance in a caption, never a callout. |
| Reminders are opt in | Everything else in the app works by you coming and asking what is next. A push inverts that, so nothing arms itself because a task has a date. Naming an hour schedules the task and does not arm a notification. If reminders end up on everything they are noise, and the first one you dismiss without reading is the day the feature died. The start reminder on a commitment is the single exception. |
| A default reminder is a toggle you turn on | Off out of the box. Turned on, it takes one offset — fifteen minutes, an hour, a day before — and applies it to every task you add from then on, leaving existing tasks alone. With the toggle on, a task with no due time gets its reminder at 00:00 on its date, which is the only route by which an untimed task is reminded at all. This is the one decision for people who want reminders on everything, instead of a decision per task. |

## People on a task

One kind of record — a person — and one kind of field that points at it, rather than four unrelated people‑fields.

| Rule | Detail |
| --- | --- |
| A person is a record, not a string | Name, timezone, working hours, how you reach them, stored once. Every task involving them inherits the timezone, so "whose day closes first" has something real to work with instead of a name retyped twenty times and mistyped somewhere. |
| A contact, not an account | People never log in. The whole idea works in a single‑user app, and multi‑user later just lets a person optionally gain an account. The task schema does not change. |
| A task holds person‑and‑role pairs | Not four fixed slots. Any number, including none. The same human genuinely holds two roles at once — Sam asked for it and is also the one blocking it. Fixed slots force you to pick one fact, and the discarded one is usually the one the ranking needed. |
| Four roles, and no user‑invented ones | Asked by, waiting on, delegated to, assignee. Each has behaviour the app acts on, which is what earns a role its place. A role the app cannot reason about is decoration, and once you can invent one you have rebuilt custom fields through the back door. |
| An expected‑by date on a waiting‑on | "Sam said Tuesday." It earns itself immediately by letting the app say *you expected this Tuesday, it is Thursday* rather than leaving a blocked task silent forever. |
| Create a person by typing their name | An unknown name offers to create itself in the same keystroke. A dropdown that refuses unknown names stops you recording who asked, and the field dies. |
| A person is also a view | Everything involving Sam in one place, grouped by role — what you owe her, what you are waiting on, what you delegated. Genuinely useful before a call, and impossible if the same human lives as loose text in four unrelated fields. |
| Not shipped | Watchers, approvers, and a created‑by field. The first two are team machinery. Created‑by is your own name in every row today, and when multi‑user arrives every existing row is you, so it backfills in one migration. |

## Ranking

A score over every property, with the two things that usually go wrong corrected: the score is never shown, and the weights are never edited in a settings screen.

| Rule | Detail |
| --- | --- |
| A sentence, never a number | Today prints the reason a task won, built from whichever inputs were actually decisive — usually one or two. "Priya's day ends at 17:00 Berlin, two hours from now. She's blocked until this lands." The same task with nobody attached reads "Due tomorrow 09:00". A number like 19.4 cannot be argued with; a sentence can. |
| Say so when there is no reason | Where nothing is decisive, the line reads "no strong reason — next by due date". A confident sentence explaining a bad ranking is worse than no explanation. |
| What the weights are | A promise to a named person whose day closes soon outranks everything. Due date then due time is the fallback where no person is involved. Blocked work carries a negative weight, so it stays visible and clearly not your failing but cannot take a slot from work you can actually do. Keep counts and push counts raise a task's standing over weeks. |
| Time is an input, so the order moves on its own | A task blocked on Sam's receipt sits fourth with "waiting on Sam since Tuesday". Twenty minutes after the receipt arrives it is second, reason "unblocked 20 minutes ago, due tomorrow". Nothing was re‑sorted by hand and no notification was needed. |
| Overrides count the winner, not just the loser | Each press of N records the task rejected, the task chosen, and the reason if one was given. Three skips of the same task tell you almost nothing on their own; three skips where the same invoice won every time tell you the invoice has no due date and nobody attached, so the ranking had nothing to weight it with. The app can then ask you the one question that fixes it permanently. |
| Free text is counted as a reason, never as a weight | A written reason is stored against the override and read by you. Nothing in the ranking parses it. The four canned reasons map onto fields the app understands; a sentence does not, and pretending otherwise would move weights on a guess. |
| Observe, say, act — and only act on a click | The app always counts your overrides. It may name a pattern out loud, once, in plain words. It changes a weight only when you press the button. Ignore the prompt and the weights are untouched — not applied provisionally, not applied with an undo. |
| Never learn silently | Weights nudged quietly toward what you already do converge on what you already do. That is fine when you are calibrated and useless when you are not, and the days you most need to be told "actually, this one" are exactly the days you have been avoiding something. The disagreement is preserved on purpose. The accepted cost: prompts you ignore, and patterns that resurface months later. |
| A pattern of overrides usually means a missing field | Choosing the same task over the ranking three days running, when it has no due date and nobody attached, means the app was never told why it matters. It asks — "is someone waiting on this?" — and once you add the person the task outranks the other on its own. Diagnosing a missing field is more useful than adjusting a weight, and you can check whether it worked. |
| A pattern about you is named, not corrected | Nine overrides in fourteen days, eight of them away from tasks with a person attached, is stated plainly: either promises are weighted too heavily, or these are the ones being avoided. Two options follow — weigh promises less, or leave it — and the app takes neither by itself. |
| No priority field | The most requested and least effective field in this category. Everything becomes P1 within a month, and a value set at capture is permanently at odds with what the queue works out from live facts. Being able to override the ranking is the answer; a second ranking system is not. |

## Figuring it out, or getting it done

Two states borrowed from Basecamp's hill charts, used in three places rather than as a chart. Never a percentage: sixty percent means nothing when you have not worked out what you are doing, and hiding uncertainty is what lets work stall unnoticed.

| Where | What it does |
| --- | --- |
| On projects and larger tasks | A two‑state field — figuring it out, or doing it — written as a word in the title line like every other state. Most tasks never set it and show nothing. |
| In the queue | A stalled task that is still being figured out gets a different question: not "when will you do this" but "what decision are you stuck on". The answer to an unsolved problem is a smaller task that resolves the uncertainty, not a date. |
| At close of day | Offered as a fourth answer beside done, not doing and carry, on the third carry — the cheapest place to capture the state, since you are already there. |

## States the app works out, rather than filters you maintain

A filter is a question you wrote, so it only knows what you thought of. A computed state is derived from the data, and every view can simply ask for it.

| Rule | Detail |
| --- | --- |
| A project can be a sequence | Say once that a project runs in order, and only its first unfinished task is available. "Renew passport" — get photos, fill the form, post it, collect it — shows one task, not four. Tick the first and the second becomes available that instant. This removes the single largest source of invented dates in any list: defer‑dating each step of a process by hand. |
| The other steps still exist | They are absent from the day, not deleted. Opening the project shows the whole sequence. |
| Available is derived, never defined | A task is unavailable when its defer date is in the future, its project is on hold, its project is a sequence and this is not the first unfinished task, or it is blocked by another task. Adding a fifth reason later makes every view correct immediately; with saved filters it would mean editing every view you own. |
| Unavailable means absent, not greyed out | "Book flu jab", deferred to 1 October, is genuinely gone until then and back with no action from you. Noise you have already decided to ignore is worse than none. |
| Projects carry a review interval | You set the cadence per project — weekly on live work, quarterly on the dormant — and the app works out when it comes due. You choose how often; you never track when. |
| Review is a screen that empties | It shows only the projects actually due, one at a time with their tasks. Change what needs changing, mark reviewed, the clock resets. Fourteen projects becomes the four that are due. |
| What review catches | A project that has gone quiet — no tasks left, or the same three it had in March. The tasks themselves look fine, so no task‑level view can surface it. |

## Capture and quick‑add syntax

| Rule | Detail |
| --- | --- |
| One line becomes many fields | "pay rent every 1st at 9am #home" sets recurrence, time and project from a single typed line, with what the app understood shown as you type. |
| A choice that changes behaviour belongs in the line | Not a layer down where a default decides for you silently. That is why the two kinds of recurrence are typed rather than buried in a dialog. |
| Syntax is never the only way | Everything expressible in the line is also settable on the task page. It is a shortcut for people who learn it. |
| Unparsed text stays in the title | Never discarded. |
| The task's reason is optional | One line, offered at capture and never required, carried for the task's life once given. |
| Where a task came from is recorded | Email, voice capture, a meeting, a message. It is what tells you why a task you no longer recognise exists. |

## Status and history

| Rule | Detail |
| --- | --- |
| Cancelled is not the same as done | Deliberately not doing something is its own state. Keeping them apart is the difference between a history you can learn from and a pile of green ticks. |
| Someday is a real state | Real, but not now and not on any date. The alternative is a date you invent and then push forever. |
| Deleted means recoverable | Thirty days, with a timestamp. Undo depends on it. |
| Every change is logged | Each transition recorded with its time. This is what feeds staleness, push counts and an honest weekly review. |
| The app never ends a task on its own | Auto‑closing after a period of silence was rejected. Kill already sits in the stale block, and the decision to abandon something belongs to the person, however long the silence. |

## Rules that bind every screen

| Rule | Detail |
| --- | --- |
| Nothing about one person's life is in the code | Shifts, categories, capacities, projects, deadlines and working hours are all data a user sets for themselves. Someone with four jobs, none, a part‑time mother, a student or a NASA employee all get an app that still makes sense. |
| Decide the model before the surface | The wireframe answers what is here and why; the UI answers what it looks like; the interaction answers what happens between states. Skipping the first and restyling later never reaches the good version. |
| What happens between states is designed | What follows a tap — the optimistic write, the failure, the undo window — is specified alongside the layout, not left to the build. |
| Reversible instead of confirmed | Undo in a line of the ledger, never a modal. This holds across board, today and queue. |
| State is written in words | No colour‑only signals anywhere. Colour may reinforce; it may not carry the meaning alone. |
| The keyboard reaches everything | Any action a pointer can take has a key. Screens that ask for decisions number their options. |
| Consequences print where the action happened | No toast in a corner, no separate confirmation screen. The same frame shows the change and its price. |
| Empty states say one plain sentence | No illustration, no encouragement, and the useful input already focused. |

## Rejected, and why

Kept so they are not re‑argued.

| Rejected | Reason |
| --- | --- |
| Budgets — named slices of a day with their own hours | Replaced by shifts, which add the two things budgets lacked: which weekdays they apply to, and which categories of task they accept. |
| One capacity for the whole day | A single daily number cannot say that your morning is full while your day is not. Capacity now lives on each shift. |
| A sidebar project tree | Spends permanent horizontal space on navigation that grouping already provides. |
| A query bar as the whole interface | Everything is invisible until you type, and it leans entirely on your memory. Its search became the search bar over the board. |
| Views as the primary navigation | Too much furniture for one person's five views. |
| Typing narrows the board in place | Searching for one thing means reading past group headers that say "0 of 22". |
| One input that both filters and rearranges | The app has to guess whether a phrase filters or rearranges, and is baffling when it guesses wrong. |
| A cap on visible columns | Left over from before columns slid under the title. Nothing breaks now, so the app has no business objecting. |
| Every behaviour as an opt‑in setting | An app where everything is a toggle has no opinion, and this one is built on having one. |
| Buckets that promote themselves by date | New, today, upcoming, later re‑sorting itself is a weaker version of the ranking already decided. |
| Cards that visibly age and yellow | The colour version of information already given in words — "kept twice · 59d". |
| Reminders triggered by place or by messaging someone | Mobile‑native work, permissions, and a narrow win. Errands are not the stalling problem this app exists for. |
| A triage queue and fixed cycles | There are no cycles here, and the stale block plus capture already do triage. |
| Custom fields, formulas, per‑type schemas | The moment you ship them the task page becomes a form and the app's opinions stop mattering. |
| Icons, colours and covers on tasks | A decision per task that returns nothing. |
