### Settled · the calendar

# How a block is charged when it crosses more than one shift

You drag a task into the hour grid and the block you draw does not fit neatly inside one shift. The rule for that is settled, and the five cases below show what it produces. An earlier proposal charged the whole block to the shift it started in, and it is recorded at the foot of the page with the reason it was dropped.

## The rule

Every shift the block overlaps is charged for the part of the block that sits inside it. A two‑hour block straddling noon takes an hour from the morning shift and an hour from the afternoon one. Any part of the block that no shift covers is charged to nobody, because that time is genuinely outside your shifts.

The drop is never refused. When a block runs outside the shift it started in, the app says so once in a small tablet at the bottom of the screen, in the same way it already handles a block dropped at an hour no shift covers. The tablet keeps you aware and asks nothing.

## Five cases

### Case one

### The block crosses into the next shift, and both shifts accept the task

The Morning shift runs 9 to 12 and the Afternoon shift runs 12 to 5. You drop *Write the Acme brief* at 11:30 and drag it to 12:30. Both shifts take project work, so either one could legitimately hold this task.

project work, admin

project work, calls

### What the app sees

The block overlaps the Morning shift by 30 minutes and the Afternoon shift by 30 minutes. Both shifts accept project work.

### What the app does

The Morning shift is charged 30 minutes and the Afternoon shift is charged 30 minutes.

### What the app says

Nothing. The block runs into a shift that accepts this task and both shifts are charged correctly, so there is no fact worth interrupting you with.

This is the common case and the reason the rule is worth having. Half an hour of spill onto an afternoon that accepts the task is not a problem, and an app that stopped to ask about it would be stopping several times a day. Both shifts lose the half hour they actually gave up.

### Case two

### The block crosses a gap where no shift runs

The Morning shift runs 9 to 12, lunch is not a shift, and the Afternoon shift starts at 1. You drop the same task at 11:30 and drag it to 1:30, so the middle hour of the block sits in a stretch of the day that belongs to no shift.

project work, admin

no shift

project work

11:30–1:30 · two hours

### What the app sees

The block overlaps Morning by 30 minutes and Afternoon by 30 minutes. Its middle hour falls where no shift runs.

### What the app does

Morning is charged 30 minutes and Afternoon is charged 30 minutes. The middle hour is charged to no shift at all.

### What the app says

The tablet reads: an hour of this block is not in any shift.

The tablet here is the one you already agreed to for a block dropped outside every shift, saying the same thing about part of a block instead of all of it. You are working through lunch, and the app records that rather than charging the hour to a shift that was not running.

### Case three

### The block crosses into a shift that does not accept the task

The Deep Work shift runs 9 to 12 and takes project work. The Calls shift runs 12 to 2 and takes calls only. You drop *Review the front end* at 11 and drag it to 1, so the second hour of the block sits in a shift that would refuse this task if you tried to put it there directly.

project work

calls only

11:00–1:00 · project work

### What the app sees

The block overlaps Deep Work by an hour and the Calls shift by an hour. Calls does not accept project work.

### What the app does

Deep Work is charged an hour and the Calls shift is charged an hour. The Calls shift now has an hour less room for calls.

### What the app says

The tablet reads: this block runs an hour into Calls, which does not take project work.

The app does not refuse this, because you drew the block deliberately and the shift's category rule exists to guide the app's own placing rather than to overrule you. The Calls shift is charged anyway, because you cannot take a call during an hour you have filled with something else. The hour is gone whatever the shift was set up to hold, and the tablet is what tells you the two disagree.

### Case four

### The block runs off the end of the last shift of the day

The Evening shift runs 7 to 9 and is the last shift of the day. You drop a two-hour block at 8, so its second hour is after every shift has ended.

admin, reading

no shift · day is over

### What the app sees

The block overlaps the Evening shift by an hour. Its second hour is past the last shift of the day.

### What the app does

The Evening shift is charged one hour, which is the part inside it. The second hour is charged to nobody, and no shift is created or stretched to reach it.

### What the app says

The tablet reads: an hour of this block is after your last shift ends.

This is the same fact as case two with a different ending, which is that part of the block is in no shift. It reads differently to you because working past your last shift is the thing you set shifts up to notice, and the Evening shift's own capacity is left honest at one hour.

### Case five

### The block swallows a short shift whole

The Morning shift runs 9 to 11, a one-hour Errands shift runs 11 to 12, and the Afternoon shift starts at 12. You drop a three-hour block at 10, so it covers the last hour of Morning, the whole of Errands, and the first hour of Afternoon.

project work

Errands · 11–12

project work

10:00–1:00 · three hours

### What the app sees

The block overlaps Morning by an hour, covers the whole of the one‑hour Errands shift, and overlaps Afternoon by an hour.

### What the app does

Morning is charged an hour, Errands is charged its whole hour, and Afternoon is charged an hour. Errands is now full, and if it already held work of its own it is over its capacity.

### What the app says

Errands is over its capacity, so a popup comes up rather than a tablet: this block covers the whole of Errands, which is now over. The popup carries a link into the queue.

This is the case that decided the rule. Charging by overlap makes a covered shift read as full, which is the truth, because an hour you have drawn a block across is an hour you cannot run errands in. Under the earlier proposal Errands read as empty while being completely occupied. If Errands already held a thirty‑minute task it is now over by half an hour and the queue will ask about it, which is the correct outcome, because you did double‑book that hour.

## The rule as one flow

You drop a block in the hour grid.

### Decision

Does any shift overlap the block?

### No

The block is placed where you put it and no shift is charged. The tablet says the block is not in any shift, and the flow ends here.

### Yes

Each overlapping shift is charged for the minutes of the block inside it, whether that shift accepts the task or not. Minutes no shift covers are charged to nobody. The flow continues.

### Decision

Is any shift the block overlaps now over its capacity?

### Yes

A popup comes up rather than a tablet, because going over is a different thing from being worth knowing about. The popup names the shift and carries a link into the queue, which opens on that shift alone and lists everything charged to it. The flow ends here.

### No

Nothing is over, so the tablet is the right level. The flow continues.

### Decision

Does the block extend past the shift it started in?

### No

The block sits inside one shift and that shift is charged its whole length. The app says nothing.

### Yes

The block stays exactly as drawn. The tablet names what the block runs into, and there are four things it can be.

A shift that accepts this task. That shift is charged the overlap and the tablet stays silent.

A gap where no shift runs. The tablet says how much of the block is in no shift.

A shift that does not accept this task. That shift is charged the overlap anyway, and the tablet names the shift and what it takes.

The end of the day. The overhang is charged to nobody and the tablet says the block runs past your last shift.

## The two rules that were dropped

### Charge the whole block to the shift it starts in

A two‑hour block dropped at 11:30 would take two hours from the morning shift and nothing from the afternoon one. This keeps each block's charge in a single place, and it describes the day wrongly. A shift whose hours a block has occupied would read as though it still had them, which is exactly the number shifts exist to get right. Case five is where it failed hardest: a one‑hour errands shift with a block drawn straight across it would still have read as empty.

### Refuse a drop that does not fit inside one shift

The block would snap back and the app would tell you to make it shorter or move it. This is the one option that makes the app argue with you about a day, which is the thing shifts are meant to do and days are not. It also fails the ordinary case, where thirty minutes of spill onto an afternoon that accepts the task is not a problem worth a refusal.

## Going over, and what is charged

Case five is the one case here that goes further than a tablet. Errands is over its capacity, so a popup comes up instead, carrying a link into the queue. The queue opens on the Errands shift alone and lists everything charged to it, which is the shift's own thirty‑minute errand and the three‑hour block that crossed into it from the morning. You choose which one comes off.

Every charge on this page is the block's length, which is the task's estimate. The two are one number and never come apart. Drawing a block sets the start time, the end time and the estimate together; dragging in a task that was typed opens its block at the length of the estimate it already had; and resizing a block afterwards rewrites that estimate, because dragging its edges is you saying the task will take longer or less long than you thought.
