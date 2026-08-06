### Seven of seven · every screen the resolutions decided

# Wireframes

Eleven screens and states, drawn at the size they are used. Each one cites the resolution it comes from. What is drawn here is the model and the layout; type, spacing and colour are the design system's, and are not being decided again per screen.

Today, the board and planning were drawn earlier and are unchanged except where a resolution says otherwise. They are in today, board and planning.

### 01 · Capture · R16, R17, R15

## One line, and what the app understood

The echo under the line is prose, not chips. It names the field it filled and the value it filled it with, so a wrong parse is caught while you are still looking at the line. The inference about kind is printed with its cause.

### New task

|

Title —

Due —

in Priya's timezone, Berlin

Estimate —

Person —

Project —

Reminders —

Reason —

Kind —

17:00 is outside your shifts on Thursday.

Add · return

Open the task page · ⇧return

### 02 · Task page · R6, R7

## A sidebar with no empty fields in it

Five sections in a fixed order, each ending in one plain-word control. Roles appear only when someone is in them. The right-hand column here is annotation, not part of the screen.

### Work › Reporting

close · esc

### Send Priya the Q3 figures

commitment · recurring monthly · pushed twice

She presents them Friday morning.

### When

Due

Thu 7 Aug · 17:00 Berlin

Wed 6 Aug

add a defer date

### How long

Estimate

1h 30m

Shape

splittable · 45m at least

Actual

not yet recorded

### Who

Asked by

Priya Menon · Berlin · her day ends 17:00

Waiting on

two days late

add a person

### Reminders

A day before · Wed 6 Aug 17:00

Fifteen minutes before · Thu 16:45

— computed from the estimate

All suspended while Ravi is blocking this.

add a reminder

### Notes

add a note

History · 14 entries ▸

### Why no empty rows

Four labelled rows of dashes read as a form, and a form asks to be completed. One word per section asks nothing and costs one click when you actually have something to add.

### Both roles at once

Priya is waiting on this and Ravi is blocking it. That is the normal case, and it is why people are pairs rather than slots. The kind stays commitment throughout.

### The suspension is stated

Reminders are listed with their real times and then one line says they will not fire. Hiding them would make the task look unarmed once Ravi delivers.

### Editing

Every value on this page edits in place on click. There is no edit mode and no save button, because every write is undoable from the activity page.

### 03 · Calendar · R8

## Seven days from today, with the shifts drawn

Shift bands are the only shading on the grid, so an hour that belongs to nobody is visibly the paper. The rail on the left is undated work, ranked, and is what you drag from.

### No do date · 23

Annual report

6h · splittable

Invoice backlog

2h · splittable

Renew the domain

Deep-clean the kitchen

3h · one run

Book the flu jab

no estimate

show all 23

6 – 12 August

1 day

3 days

7 days

Wed 6

5h 10m · 2 shifts

Thu 7

6h 40m · 2 shifts

Fri 8

2h · 2 shifts

Sat 9

no shifts

all day

Renew the domain

Book the flu jab

### Morning · 40m left

### Afternoon · 1h left

Invoice backlog

Gym

Gym, 19:00 – 20:00 Friday, is not inside any shift.

dismiss

### The magenta edge

Payroll submission is deadline-bearing and cannot be dragged. Everything else has a cyan edge and moves freely.

### The heavier shadow

The Priya block is mid-drag. Its two shift bands both light up while it is held, because it would be charged to both.

### The grey edge

Gym sits in no shift. It is placed anyway, the tablet says so once, and no shift's remaining time moved.

### Saturday

No shift runs on Saturday, so the column has no bands and reads as unshifted rather than empty. Dropping there still works and still says so.

### 04 · Today, N pressed · R1, R2

## Something else, in three states

### a · the list is open

Annual report · 6h

### What are you doing instead?

· 2h

· 1h 30m

· 15m

· 30m

or search for anything else

### b · picked, reason offered

Invoice backlog

You chose this. 2h, splittable from 5m.

Invoice backlog

Annual report

undo

### Why, if you like

1 · This one matters more than you think

2 · The other one's estimate is wrong

3 · Wrong time of day for the other one

4 · Fresh information

5 · Write a line

### c · nothing else is left

Annual report · 6h

Nothing else is on today.

search for anything

Pulling something forward is a real answer, and it is the one the app most wants recorded.

### 05 · Today, L pressed · R3, R4

## Not today, and its two follow-ups in sequence

### a · the row, open

Draft the retainer note

### b · 5 pressed · the person first

Draft the retainer note

Waiting on whom?

|

Ravi Shah

Ravinder Kaur

create "Rav"

### c · then the date

Draft the retainer note

When did Ravi say it would land?

Your do date moves to match. The due date does not move.

### d · already blocked · one field only

Review the site plan

Two days late.

New date?

remove blocker

### e · the ledger line each of them writes

undo · U

One line, under the frame, held until the next answer replaces it. The cost is in the same sentence as the action, which is the rule that lets the app have no confirmation dialogs.

### 06 · The queue · R11, R12

## A question with the chunking line, and the close

### a · the gap is smaller than the task

Question 2 of 4 · Afternoon shift

Forty-five minutes are free before the school run. What goes in them?

— clears 6 of 14 invoices

— 6h of 6h still to do after

— Thursday's total drops to 4h 15m

None of these — show me the board

Annual report is three hours and the gap is forty-five minutes. Can you pick it up part-way?

No, it needs one run

### b · the close, with the stale line

Thursday is planned. 5h 40m committed of 6h.

### Committed, with times

09:00 Payroll submission · 11:30 Send Priya the Q3 figures · 14:15 Invoice backlog

### Going out tonight, so others can act

Ravi — chase the site plan, two days late. Priya — figures land Thursday, not Wednesday.

### Not happening

Annual report — no run long enough this week. Deep-clean the kitchen — dropped, third carry.

Eleven tasks nobody has touched in fourteen days. Oldest is sixty-one days.

go through them

### 07 · Activity · R9, R10

## Everything that happened, and who did it

The actor column is the point. "Did anything actually fire" and "did I move that or did it move itself" are the two questions this page exists to answer.

everything

reminders

overrides

dates

people

deletions

### Today · Wednesday 6 August

App

Ravi is late · *Review the site plan* · expected 4 August

You

Something else: chose *Invoice backlog* over *Annual report* — "client called, needs the numbers today"

App

Friday now holds 6h 10m

You

Draft the retainer note

undo

You

Snoozed 15m, in the middle of something · *Payroll submission*

App

Start reminder fired · *Payroll submission* · delivered to 2 devices

### Tuesday 5 August

You

Planned Wednesday · 4 questions · 2 dropped

You

Chase the old invoice

restore

Ravi

Expected-by moved to 4 August · *Review the site plan*

loading more…

### 08 · Onboarding and shifts · R13, R14

## One question at sign-up, and a table afterwards

### a · the only setup question there is

How many hours of real work does your day hold?

Mine is about five. I am up at 10, but two of those hours go to email and the school run.

hours

This becomes one shift called Day, taking every kind of task. You can split it later, or never.

Start

### b · settings, once there are two

Shifts

| Name | Window | Days | Takes | Capacity |
| --- | --- | --- | --- | --- |
| Morning | 08:00–12:00 | Mon–Fri | work | 3h |
| Afternoon | 13:30–17:30 | Mon–Fri | work, admin | 3h 30m |
| Evening | 19:00–22:00 | every day | personal | 2h — from the window |

add a shift

use 2h 20m

leave it
