### v1 · settles the reminders questions in Open

# Reminders

There is one mechanism in v1 and it is called a reminder. This page defines it, says what its notification reads, says how it gets added while you are typing, and separates it from the four other things in the app that also postpone something.

## One mechanism, not three

The finalised documents carried three things that each warned you about a task in advance: a warning period, a safe‑start alarm, and a reminder. Three overlapping mechanisms is three things to learn and three places to look when nothing fires. v1 ships one.

| Was | What it did | What happens to it |
| --- | --- | --- |
| **Reminder** | A push notification at an offset you chose from the due time. | **This is the surviving mechanism.** A task carries any number of reminders. Each one is an offset from the due time, or an absolute date and time. Nothing else in the app fires a notification about a task. |
| **Safe‑start alarm** | A push notification at the due time minus the estimate. | Becomes a reminder with a computed offset, called the **start reminder**. Its offset is the estimate rather than a number you typed, so it moves when the estimate moves. It is the same object as any other reminder, in the same list on the task, fired by the same scheduler. The only thing special about it is that commitments get one without being asked. |
| **Warning period** | A per‑task field deciding the day a task began appearing as work rather than as a future item. It fired nothing. | **Deleted from v1.** It was a field you filled in to control what a screen showed you, which is a setting pretending to be a task property. The behaviour it produced is now computed: a task appears as work from its do date, or from the day its start reminder falls, whichever comes first. A task with no do date, no due date and no reminder never appears on today at all. It still sits on the board, which is the full inventory and shows everything — *renew passport, due 12 September* and *fix the bike, no dates* are both there today, they are simply not today's work. Today is the filtered view of the board rather than a separate list. Nobody types a warning period and nobody wonders which of three fields was the one that failed. |

So the whole model is: **a reminder is an offset from a due time.** The start reminder is the one whose offset the app works out for you.

## Reminders are opt in

| Rule | Detail |
| --- | --- |
| Nothing arms itself because a task has a date | Naming an hour schedules the task and does not arm a notification. A timed task with no reminder on it is silent. What naming an hour buys you is that the reminder presets become available, because there is now a time to be fifteen minutes before. |
| The one exception is a commitment's start reminder | Someone else is owed, and no missed commitments is the test the app is built to pass. A guarantee you can forget to switch on is not a guarantee. Removing it is one control and it names what you are giving up. |
| A commitment with no due time still gets one | Without an hour there is nothing to subtract the estimate from, so the start reminder lands at 00:00 on the due date instead. It is worse than a computed one and better than a hole in the guarantee. Adding a due time replaces it with the computed offset. |
| A default reminder is a toggle you turn on | Off out of the box. Turned on, it takes one offset — fifteen minutes before, an hour before, a day before — and applies it to every task you add from then on. It changes nothing that already exists, and any task can have its reminder removed afterwards. This is the setting for people who want reminders on everything, and it is one decision rather than a decision per task. |
| With the toggle on, an untimed task fires at midnight | A task due Thursday with no hour has nothing to be fifteen minutes before, so its reminder lands at 00:00 on the Thursday. This is the only route by which a task with no due time gets a reminder at all, and the toggle says so where you turn it on. |

## Five ways to put something off, and what each one touches

The app has more than one postpone because there is more than one thing to postpone. The distinction that matters is scope: a reminder, a date, or neither. Two of these were fighting over the word snooze, so the word now belongs to exactly one of them.

| Control | Where | Scope | What it does, and an example |
| --- | --- | --- | --- |
| **Later** / *the snooze* | On the notification | One reminder | The reminder rings again after the snooze interval, which is fifteen minutes out of the box and is one value in Settings. All three reasons use it. No date on the task moves, nothing about the task changes, and the task's other reminders are untouched. *Your 9:30 reminder for the meds goes off while you are on a call. You press Later, then in the middle of something. It rings at 9:45. The task is still due at 10:00 and still sits where it sat.* |
| **Not today** | The today screen, key L | The task's do date | Moves the day you intend to work on the task, and prints who is affected. *The screen offers the tax return. You press L and pick Thursday. Its do date is Thursday, it leaves today, and the shift it was charging gets its hours back.* |
| **Something else** | The today screen, key N | No date at all | Says you are not doing the task the ranking chose, and makes you name the one you are doing instead. Nothing is postponed — the rejected task stays exactly as it was, due when it was due, and comes back next time it ranks. *The screen offers the tax return. You press N and pick the invoice. The tax return is still today's work; you just are not on it right now.* |
| **Defer until** | A field on the task | The task's existence | The task is absent from every screen until the date arrives — not greyed, not ranked low, gone. *The visa renewal cannot be started before March. You defer it until 1 March and the app stops showing it to you entirely, so it is not eleven weeks of noise.* |
| **Push** | The planning queue | The task's do date | The same move as Not today, made during a planning session rather than on today, and counted the same way. *Tomorrow is over capacity by three hours. The queue offers the tax return and you push it to Friday.* |

Read down the scope column and there is no overlap: one moves a reminder, three move a date, one moves nothing. **Later is the only snooze in the app** and it is per reminder, with no exceptions — none of its three reasons touches the task. The word snooze is not used for not today, something else, defer until or push.

### Why Later asks why

A reminder snoozed four times is the most useful signal the app can collect. It means the time was wrong, or the task was wrong, or you were blocked — and none of those show up anywhere else, because the task still looks fine and the deadline has not moved yet.

So the reason is captured, and the cost of capturing it is one press. There is no plain Later button. Pressing Later expands the notification into three reasons, and each reason is itself the snooze — pressing one both reschedules the reminder and records why. Two presses total, which is what a bare Later would have cost on most phones anyway.

Three reasons, the list is closed, and there is no free text on a notification. Each button is an instruction to the app rather than a description of your mood, and the table says what each one instructs.

| Press this | What it does immediately | What it teaches the app |
| --- | --- | --- |
| **In the middle of something** | The reminder rings again after the snooze interval. Nothing else about the task changes. | The task keeps losing to whatever you are actually doing. Four of these is a ranking problem, and the queue can raise the task's position or ask whether it belongs on this day at all. |
| **Wrong time of day** | The reminder rings again after the snooze interval. Nothing else about the task changes — identical behaviour to the first button. | The reminder is set at the wrong hour. Four of these is an offset problem, and the queue can offer to move the reminder rather than the task. Same behaviour as the first button, different fix. |
| **Waiting on someone** | The reminder rings again after the same interval as the other two. Nothing else about the task changes: no blocker, no suspension. | The task could not be done, which is the one thing the other two do not say. The next planning session asks who you are waiting on, and that is where the blocker gets set — with a name on it. |

Two of the three can be true at once — it is the wrong hour *and* you are waiting on Ravi. The tie‑break is a single rule: **waiting on someone wins**, because it is the only one of the three that says the task cannot be done at all, and a reminder that rings again after the snooze interval for something you still cannot do is the noise this whole design is trying to avoid. Press the button whose consequence you want, not the one that describes how you feel.

None of the three sets a blocker. A notification cannot take a name, so a blocker set from one would record nobody — and a blocker the app cannot attach a person to is a blocker nothing can clear. Every route that clears a blocker needs the person: the today screen edits their expected‑by date, the task page removes them, and the planning queue asks whether they delivered. A nameless one has none of those, so it would sit on the task suspending reminders until somebody noticed the silence. Reminders failing silently is the worst outcome this design has, and it is not worth a lock‑screen shortcut.

So the third button stays inside the reminder: it reschedules like the other two and files the reason. The blocker gets set at the next planning session, which asks who you are waiting on, because that is the one moment you can answer with a name and the app can then tell when the answer arrives.

## Everything that can fire, and nothing else

Three sources, and the list is closed. A notification that is not one of these three is a bug rather than a feature.

| Source | Default | Time it fires | What it is for |
| --- | --- | --- | --- |
| **The start reminder** | On, on every commitment with a due date | The due time minus the estimate, or 00:00 on the due date where there is no due time | The last moment you can start and still deliver. This is the guarantee the app is built on, so it is the one reminder that arms itself. |
| **A reminder you set** | Off, unless the default toggle is on | A preset offset from the due time, or an absolute time | A hard hour on a specific day, which nothing else in the app can express. Any number per task. |
| **The planning nudge** | On, once you have set a planning hour | At the hour you chose to plan | Planning is a session you start, and a session nobody remembers to start does not happen. This is a reminder like any other, on a standing task the app owns rather than one you wrote — every other task has to be typed, and this one is generated from the planning hour in Settings. One notification a day, and switching it off is a single toggle. |

Habits never fire. A habit behind pace ranks up and states its fraction, and that is the whole of its escalation. Do dates never fire either — a day you picked for yourself is a plan, and if you want warning before it you add a reminder like anyone else. A blocker's expected‑by date does not fire in v1; chasing somebody is the planning queue's job.

## What the notification says

A notification is read on a lock screen, in about a second, by someone doing something else. Two lines are available and both are used. The first line is the task. The second line is the due time and, where there is one, the reason already written on the task.

A reminder is about one task and says nothing about any other. It never mentions what else is on the shift, what else is due, or how the day is going — arriving to point you at one thing and then handing you a second thing to think about is how a reminder becomes something you swipe away.

### The start reminder · a commitment

### Start now

2:40pm

Send Priya the Q3 numbers

Due 5:00pm her time. 2h estimated. Later than this and it is late.

Done

Later

The kicker carries the instruction so the title can stay the task's own words. *Later than this and it is late* is the whole reason this notification exists, and it is worth its line.

### A reminder you set · thirty minutes before

### In 30 minutes

9:30am

Take the meds

Due 10:00am. Before food.

Done

Later

The second line is the due time and the task's own reason, the one line you wrote at capture. Where a task has no reason the second line is just the due time, and that is a complete notification.

### Later, expanded

### Remind me again in 45 minutes

9:30am

Take the meds

In the middle of something

Wrong time of day

Waiting on someone

Each button is the snooze, and each one reschedules the reminder and files the reason in a single press. The header states the interval so no button has to repeat it — this account has it set to forty‑five minutes.

| Setting the interval | How |
| --- | --- |
| The default | Fifteen minutes out of the box. One value in Settings — fifteen minutes, thirty, forty‑five, an hour — applying to every snooze on every task. The notification header always names the current value, so it is never a number you have to remember. |
| Once you have snoozed the same reminder twice | The second press is evidence that the interval is wrong for this particular reminder, so the third expansion swaps the three reasons for a row of intervals — thirty minutes, an hour, this evening, tomorrow morning. It costs nothing on a first snooze and it appears exactly when the fixed interval has already failed. The reason is not asked again; it was captured on the presses before. |
| An arbitrary time | Not on the notification. Picking a specific hour is what the task's own reminder field is for, and typing a time on a lock screen is not something anyone does. The interval row covers the cases the fixed value misses. |

### The planning nudge

### Plan tomorrow

8:00pm

Four things are unanswered today

Tomorrow has 6h of shifts and 9h committed.

Start

Not tonight

This is the one notification whose title is a count rather than a task, and it names the overshoot because the overshoot is what the session is going to be about. It does not say how long the session takes; somebody who plans every evening already knows.

### Lines the notification never writes

| Not this | Because |
| --- | --- |
| *Reminder: Send Priya the Q3 numbers* | The word reminder is the one thing the reader already knows. It costs eight characters of a line that has about forty. |
| *Don't forget to send Priya the numbers!* | Cheerfulness is what makes notifications dismissible. The app's voice is flat everywhere else and it does not change here. |
| *Due 10:00am. Three other things on this shift.* | A reminder points at one task. Naming the rest of the shift starts a planning session the reader did not ask for, at the moment they were about to act. |
| *Overdue: 3 tasks* | A notification you cannot act on in one press is a notification you learn to swipe away. Counts belong on the board. |
| *You're doing great — 4 done today* | Nothing fires to congratulate you. There is no engagement notification in this app. |

## The two actions on the notification

A notification acts on the reminder and on nothing else. It can finish the task, because finishing is what the reminder was asking for, and it can move the reminder. It cannot move a date — dates are changed on the today screen, in the planning queue, or on the task itself, where you can see what the change costs. Both actions resolve on the server, so they work from a lock screen without opening the app.

| Action | What it does |
| --- | --- |
| **Done** | Completes the task, withdraws the notification on every other device, and cancels every remaining reminder on it. If somebody was waiting, the completion is recorded against them exactly as it would be in the app. |
| **Later** | Expands into the three reasons and files whichever one you press. Each one reschedules this reminder by the snooze interval and re‑arms it on every device. No date on the task changes, no blocker is set, and the reminder's original offset is kept, so moving the due date later still moves the reminder correctly. |
| *Doing nothing* | The notification sits until the operating system clears it, and nothing fires again. No reminder repeats itself. A notification that nags is a notification you switch off at the operating system level, and then the start reminder is gone with it. |

## Adding a reminder while you are typing

Capture is typed and fast, and a reminder has to be addable in the same breath as the task. Two routes, and the typed one is the primary.

### Typed, in quick add

A bang and an offset. The parser already reads dates and times, so the reminder token is deliberately narrow: `!` followed by a duration and the word before, or by a bare time.

| You type | You get |
| --- | --- |
| `Meds 10am !30m` | Due today at 10:00, one reminder thirty minutes before it. |
| `Passport Thu 9am !1d !30m` | Two reminders, a day out and half an hour out. Any number of bangs. |
| `Call the bank Fri !9am` | Due Friday with no hour. The bare time makes a reminder at 9:00 on the Friday and does not become the due time — a reminder is not a deadline. |
| `Meds 10am !` | The bare bang means at the due time. The shortest way to arm anything. |

Everything the parser reads is echoed back as chips under the field before you press return, so the reminder is visible rather than assumed. If you write `!30m` on a task with no time at all, the chip reads *needs a time* in magenta and the reminder is dropped on save — stated while you are still typing, not discovered three days later when nothing fired.

### Tapped, on the task

The task's reminder field is a row of presets rather than a picker, because four presets cover almost everything and a picker costs four taps for the same result.

### Remind me

1 day before

30 min before

15 min before

At 10:00am

Custom…

Presets are offsets from the due time, so moving the deadline moves them. Custom takes an absolute date and time and stays where you put it.

On a task with no due time the presets are not shown, because a greyed control invites a tap that does nothing. In their place sits one quiet line at the field's own label size — *add a due time for reminders* — which focuses the time field when pressed. It is soft guidance and it gets the space of a caption, not a callout: no box, no icon, no colour, one line, and it disappears the moment a time exists.

On a commitment the start reminder sits at the top of the same list, marked as the app's: *Start reminder 2:40pm — 2h before 5:00pm.* It has one control, which removes it, and removing it names what it costs.

## When a reminder changes on its own

A reminder scheduled on the server outlives the state it was scheduled from, so every one of these has to be handled or the app fires at the wrong time and loses the user's trust in one press.

| What happens | What the reminders do |
| --- | --- |
| The due time moves | Every offset reminder moves with it and is rescheduled. Absolute reminders stay where they are; if one now falls after the due time, the task page says so in plain words rather than silently deleting it. |
| The estimate changes | The start reminder is recomputed, because its offset is the estimate. Nothing you set is touched — you set a time, not a calculation. |
| The task becomes blocked | Every reminder on the task is suspended, the start reminder included, because warning you about something you cannot do is noise. One rule wherever the blocker came from — a notification, the today screen, or the task page. To be reminded to chase the person, the task page offers that in one press when you set the blocker, and it is a reminder of its own rather than a surviving one. |
| The blocker is removed | Every suspended reminder is re‑armed and the start reminder is recomputed. If its time has already passed, it fires once, immediately, and says so: *Should have started 40 minutes ago.* |
| The task is completed anywhere | Every reminder on it is cancelled and any notification already showing is withdrawn on every device. A stale reminder teaches you to ignore reminders. |
| The task is deleted | Cancelled outright. Undoing the delete within thirty days restores the reminders with it, and any whose time has passed do not fire retroactively. |
| A repeat produces the next occurrence | Reminders belong to the series and are recreated on each occurrence at the same offsets. Completing one occurrence never cancels the next one's reminders. |
| Notifications are off on a device | The device shows a persistent line at the top of today naming which device is silent and offering the browser's permission prompt. The reminder still fires everywhere else. |

## When the other person is late

Ravi said Tuesday and it is Wednesday. Three things happen and none of them is a notification.

| What happens | Why |
| --- | --- |
| The do date does not move on its own | Moving it would be the app rescheduling your work because somebody else slipped, which is exactly the decision the planning queue exists to make you take yourself. The expected‑by date is also the only record of what Ravi actually said, so it is not overwritten either. |
| The blocker's state changes from waiting to late | The task's line stops reading *waiting on Ravi since Tuesday* and starts reading *Ravi is two days late*. This is the whole day‑to‑day consequence, it costs nothing, and it is the same treatment staleness already gets. |
| The next planning session asks about it once | It comes up while you are closing the day, because it is an unanswered fact about today. Three answers: you chased him, which is recorded and re‑asks tomorrow; he gave a new date, which edits the expected‑by date and re‑seeds the do date; or the blocker comes off, because you are doing it without him or the task is dead. |

No notification, no new screen, one state change and one queue question. A late person is not an emergency at the moment the clock passes midnight, and the hour you chose to plan is the right time to deal with it.

## Seeing what will fire

A notification system you cannot inspect is a notification system you distrust, and the fix is small: one saved view on the board that lists every armed reminder in time order, with the task, the time, and where the reminder came from. It is a filter on the board rather than a new screen, so it inherits selection, multi‑edit and search.

The reason this earns its place: the first serious question anyone asks a reminder feature is *did that actually save*, and the second is *what is going to wake me up tomorrow*. Both are one view.

Reminders that already fired are not listed here. They belong to the Activity page — one history of everything that happened in the app, whoever or whatever did it — which is a page of its own and is not designed yet. This view shows what is armed; Activity shows what fired.

## Deferred to v2

| Not in v1 | Why it was cut |
| --- | --- |
| Quiet hours | A good feature and not a v1 one. It needs a window, a rule per source, and a decision about whether a start reminder is allowed to break it — and none of that is needed to ship a reminder that fires at the time you asked for. |
| Chasing a passed expected‑by date | The only notification that would have been about somebody else's obligation rather than your own work. The planning queue already sees the passed date and can raise it at the hour you plan, which costs no new notification. |
| A reminder on a do date | A day you picked for yourself is a plan. If you want warning before it, add a reminder. |
| Free text on a snooze | The three canned reasons are the whole set on a notification. Typing on a lock screen is not a thing anyone does. |

## Still open

| Question | What is undecided |
| --- | --- |
| Nothing on this page | Every reminders question is answered. The board question this page raised is settled: the board is the full inventory and shows everything, and today is the filtered view of it. |

### Companion documents

The Brief The Spec Decisions Open Blocks Across Shifts
