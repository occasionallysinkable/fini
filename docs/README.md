# Design documents

These files are the design of the app. Read them before writing code; they are the contract.
Where two documents disagree, `resolutions.md` wins.

| File | What it holds |
| --- | --- |
| `handoff.md` | The stack, the database schema, the invariants, the ranking function, the nineteen work packages and their acceptance criteria, nine hand-test scenarios, and a list of features not to build. Start here. |
| `decisions.md` | Every settled behavioural rule, screen by screen. The reference to search when a question comes up. |
| `resolutions.md` | Twenty-seven numbered resolutions that closed the remaining questions, including corrections to `decisions.md`. Newest and authoritative. |
| `reminders.md` | Notification wording, the two actions, snooze mechanics and rescheduling. Needed for WP7. |
| `blocks-across-shifts.md` | How a calendar block is charged when it crosses more than one shift, worked through in five cases. Needed for WP14. |
| `wireframes.md` | The described layout of each screen and state, cross-referenced to its resolution. |
| `spec.md` | What is in version one and what is deliberately left out. |
| `brief.md` | Why the app exists and what counts as success. |
| `open.md` | Questions that cannot be answered until the app has been used. Nothing here blocks a build. |

## Building

Build one work package at a time, in order, in a fresh conversation each time. Paste:

```
Read docs/handoff.md, docs/decisions.md, docs/resolutions.md.

Build WP1 and only WP1. Do not start WP2.
Hold every rule in the Invariants section of handoff.md.
Use the stack named in handoff.md and no other.

When you are done, list WP1's acceptance criteria
and tell me how you verified each one.
```

Verify every package's acceptance criteria through the running app in the
browser, not only through scripts and unit tests. Scripts and tests run in a
single module graph, so they cannot catch a whole class of defect that only
appears once the app is running — for example a server action and the
server-component graph ending up with separate copies of a module-level
singleton (this is how the write-guard defect fixed in `fix/write-guard-store`
went unseen: `mutate()` verified green in scripts while a live server-action
write could be wrongly blocked).
