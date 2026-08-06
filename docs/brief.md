### One of seven · why the app exists

# The brief

What the app is for, the life it has to survive, and the tests that settle arguments about it. No feature lists — those are in the spec. No screen rules — those are in decisions. Unanswered questions are in open.

## What it is

A personal task manager whose job is not only to hold a list but to minimize friction and produce a decision for their user. It carries, in generally anticipated cases, multiple live tasks that may have and possible share multiple contexts. At the planning stage of each user's day, (whatever time for planning they choose), the app turns the relevant handful of tasks into two things: a plan anchored to real deadlines, and a written list of what will not happen.

### First principle

Planning is deciding what will not happen. A tool that only records intentions has not planned anything.

### Second principle

Nothing in the app's code/syntax/design/logic is subjective. Everything, in the build of the app, is objective. Shifts, deadlines, tasks and their properties, capacities, projects and deadlines are all data all users set for themselves. Someone with four jobs, or none, or a mother working part-time, or a student or a NASA Employee, all get an app that still makes sense.

## The life it is tested against

Awais's circumstances today. None are written into the code. They are the case the design has to handle.

| Fact | What it forces |
| --- | --- |
| Sixty to seventy live tasks; twenty to thirty worked in any two weeks | The board is not small. The features of "Projects", "sub-projects" and "search" do real work. The "filing/organization" is not just an add-on, it is required by Awais because he normally has a big list of stuff to go through before closing any day, and planning any tomorrow. The evening queue picks from many tasks rather than ordering a few. |
| Works 17:00 to 01:00, moving an hour with daylight saving | There is no standard working day. Working hours are stored per weekday and kept as history rather than overwritten. These are Awais's working hours, to be taken into account at the design/logic planning phase of app, but certainly not to be hardcoded in app. Someone could have any number of work-hours. |
| Current employer of Awais is nine hours behind; 17:00 here is 08:00 there | The whole shift sits inside the client's working day. He is reachable throughout, so focus time has to be defended rather than found. |
| Three daily commitments with deadlines 18:00, 19:30 and 21:00 | One example of a general pattern. How many there are, who owns them and when they fall are all rows in a table. The app never assumes three, or any. |
| 21:00 to 01:00 is the only unbroken work time 's run | How much unbroken time a day has is as important as how many hours it has in total. |
| Personal hours sit before 17:00 or after 01:30 (30mins buffer time) | A day can hold several separate stretches of available time. Some people have one, some have five, some have none named at all. |
| Thinks about estimates loosely, in spans rather than exact figures | The app still stores one number, because every calculation it does needs one and a block on the calendar has one length. Anything arriving without an estimate takes a default length set in Settings. Record what it actually took from day one, whether or not anything reads that data yet. |
| Two projects today, wanting sub‑projects | Two levels of project, both named by the user. Clients under work; home and career under personal. One configuration, not a structure baked in. |
| Has abandoned a task manager for one to two months at a time | Avoidance and overwhelming dread of opening the app because there'll be failures in it (stuff Awais did not do) and planning to do in it, is the main way this fails, ahead of missed deadlines. Use is measured so that going quiet reads as a defect in the app. |

## One thing exists: a task

Every task has a **kind**. The kind decides one thing only: what happens when the task is missed. Kind can be set when the task is captured or at any point after. Leaving it unset is allowed.

| Kind | What it means | On a miss |
| --- | --- | --- |
| Commitment | Someone else is owed. Has a person, a time it is due, and that person's timezone. | Shown as a miss with the person named. Alarms outside the app at the latest safe start. |
| Own (previously known as self-set) | Nobody is waiting. Work or personal alike — what matters is whether someone is owed, not whether it is a job. This is the default and the majority. | Shown as a miss, carrying a count of how often it has been pushed. No person to name. |
| Unassigned | Captured but not yet sorted. A legitimate resting state, not an error. | Treated as own for as long as it stays unassigned. The planning review may offer to sort it. It never insists and never changes the kind on its own. |
| Habit | Recurs, nobody is waiting, and a single missed occurrence does not matter. | No overdue task appears. The series records the skip and the board stays clean. |

## Talking to it

You speak or type freely — about tasks, about the week, about what is bothering you — and the app turns it into proposed changes, shows them as a before‑and‑after, and applies only what you accept.

| Stage | What it covers | What it buys |
| --- | --- | --- |
| Stage 1 | Capture. Text in, candidate tasks out, confirmed in a fast queue. | The everyday way things get into the app. Nothing changes without confirmation. |
| Stage 5 | Editing by description. "Move the review to Monday and tell the dev." Turned into a set of changes against real tasks, applied when you accept them. | Bulk and awkward edits that would otherwise take twenty clicks. Needs a settled data model, which is why it is last. |
| Stage 5 | Open dump. Talk about the week, the backlog, whatever is on your mind. The app labels each part useful or not useful, tags the useful parts, and deletes the rest once they have gone unused long enough. | Questions for the queue on light days, and the app knowing why something matters beyond a one‑line reason. |

### What could go wrong with it

Confidently wrong

A misread instruction that silently changes the wrong task destroys trust for good. So: never apply anything without showing the change first, and every applied batch undoes as one unit.

Unclear reference

"Move that thing to Monday", across sixty tasks. The app has to ask rather than guess, and asking is only cheap if it asks well.

Slowness

Speak, transcribe, interpret, review, accept takes several seconds. For one quick edit that is slower than clicking, so it must never be the only route.

Privacy of the dump

Open talk about work and how you are doing is the most private data in the app, and it leaves your machine to be processed. Needs an explicit local‑only option and a delete‑everything control.

Cost that grows with talking

The one feature whose running cost rises with use. Fine for one person; a pricing problem if this ever becomes a product.

Drifting into a chatbot

The temptation is to answer questions instead of changing tasks. The test: 90% of the exchange either changes a task or is filed as context.

Depending on an outside service

Every conversational path needs a manual equivalent. If the model is unreachable the app gets slower, never blocked.

## What it must never do

This replaces Awais's only task manager. Three failures end the project: losing data, missing a deadline someone is waiting on due to the app's failed behavior, and being unable to see the day.

| Requirement | What it means in practice |
| --- | --- |
| Data lives on a server | A hosted database, with the browser's copy used only for reading. A bad connection means read‑only, never nothing. |
| Alarms fire without the app | Scheduled jobs run whether or not a browser is open. If the interface is broken, the deadlines still alarm. |
| Nothing is destroyed quietly | Undo everywhere, deletes recoverable for thirty days, no automatic tidying. Changes the app made on your behalf undo as one batch. |
| It works without the model | Every spoken or written instruction has a manual equivalent. |
| Weekly export | JSON and markdown, written automatically. The way out. |
|   |   |

## Five tests every feature has to pass

Does it help someone decide something?

Organising counts — seeing only work this week, or a whole project over six months, helps you decide. What fails is structure no screen ever reads.

Passes: projects, search, notes. Fails: a priority field, set when you know least about the day and permanently at odds with what the queue works out from live facts.

Is it correct, or just convenient?

Correctness earns its upkeep. Convenience adds surface area and new ways to be quietly wrong.

Passes: storing named timezones instead of fixed offsets. Fails: calendar import.

Does it survive the user being someone else?

Anything that assumes this shift, this client, this many jobs or this many deadlines is a defect. All of it is subjective data, per every user's account.

Passes: shifts as a list the user writes. Fails: a hardcoded evening shift, or a fixed number of questions in the queue.

Does it cost something every single day?

A cost paid once per task is fine. A cost paid per task per day is not. Whether you type it or say it makes no difference — how often you pay it is the test.

Passes: a reason given once and inherited by every repeat. Fails: re‑describing the same task every evening.

Can it be wrong without anyone noticing?

If a feature can be wrong, it has to be visibly wrong or undoable in one action.

Passes: alarms, which either fire or obviously do not. Fails: an edit applied without showing what changed.

## Success at day sixty

| Measure | What failing it means |
| --- | --- |
| No missed commitments | The reliability work was not enough, and nothing else about the app matters until it is fixed. |
| A not‑happening list with things on it | If it is empty, the app is recording intentions instead of forcing decisions. The model is wrong. |
| No gap longer than three days without opening it | Avoidance came back. The app has become another thing to face rather than the thing that makes facing it easier. |

The third measure catches the failure that has actually happened before: a backlog heavy enough that you stop opening the app for weeks. Opens per day, days planned and the length of any gap are recorded from stage 1.

## Settled arguments

Kept so they are not re‑argued. Screen and mechanic decisions live in decisions; these are the ones about the shape of the thing.

Where do questions come from on a light day?

From the open dump. With no gap to close, the queue draws on what you have said about the week. With nothing said, it asks nothing and closes. Silence is a valid output.

How many questions before it becomes a chore?

However many the day needs. Eleven unfinished tasks rolling into a full day warrants several; an empty week warrants none. Any fixed number in the code would be one person's preference.

Does a task's reason ever change?

Rarely, and it is editable. A changed reason usually means the task itself has changed into something else.

How deep do sub‑projects nest?

Two levels in the interface. The data model and every query handle any depth, so raising the limit later changes one number and the pickers rather than requiring a migration.

What happens to a task whose kind is never set?

It stays unassigned and behaves as own task forever. The app never insists and never changes it silently.

How does the dump avoid becoming a journal nobody reads?

It is never read back as a whole. The app labels each part useful or not useful, tags the useful parts, and surfaces them when something asks for them. Not‑useful parts are deleted after they have gone unused. Useful parts get a review a year or two on.

What gets deleted at first release?

Nothing. Both labels are still applied to every dump so the labelling can be judged against real data before any rule acts on it.
