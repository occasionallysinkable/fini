import { describe, it, expect } from "vitest";
import type { BoardTask } from "./board";
import {
  buildSections,
  sectionPopulated,
  groupPeopleByRole,
  readSidebarWidth,
  clampSidebarWidth,
  shapeText,
  fmtMinutes,
  SECTION_META,
  ROLE_ORDER,
  ROLE_CHOICES,
  SIDEBAR_WIDTH_KEY,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  type TaskPageData,
  type TaskPagePerson,
  type SectionId,
} from "./task-page";

/*
  WP6 · the task page's pure logic. These guard the things the page gets wrong
  quietly: the five sections drifting out of order or an empty one drawing a form
  of dashes, roles being shown that nobody is in, and the two settings keys the
  sidebar shares with WP10 changing name or bounds.
*/

const emptyBoardTask: BoardTask = {
  id: "t1",
  title: "A task",
  projectId: null,
  projectName: null,
  kind: "own",
  status: "active",
  dueDate: null,
  dueTime: null,
  doDate: null,
  deferUntil: null,
  estimateMinutes: null,
  recurring: false,
  createdAt: "2026-08-01T00:00:00.000Z",
};

function tp(over: Partial<TaskPageData> = {}): TaskPageData {
  return {
    id: "t1",
    title: "A task",
    boardTask: emptyBoardTask,
    dueDate: null,
    dueTime: null,
    doDate: null,
    deferUntil: null,
    estimateMinutes: null,
    splittable: false,
    minChunkMinutes: null,
    actualMinutes: null,
    people: [],
    reminders: [],
    notes: [],
    history: [],
    historyCount: 0,
    ...over,
  };
}

function person(over: Partial<TaskPagePerson>): TaskPagePerson {
  return { personId: "p", name: "Someone", timezone: null, role: "assignee", ...over };
}

describe("the five sections", () => {
  it("are always in the fixed order when, how long, who, reminders, notes", () => {
    const ids = buildSections(tp()).map((s) => s.id);
    expect(ids).toEqual<SectionId[]>(["when", "howLong", "who", "reminders", "notes"]);
    // SECTION_META is the single source of that order.
    expect(SECTION_META.map((m) => m.id)).toEqual(ids);
  });

  it("on an empty task, every section is unpopulated and offers just its control", () => {
    const sections = buildSections(tp());
    expect(sections.every((s) => !s.populated)).toBe(true);
    // WP7 gives reminders its own add flow, so every section now offers its word.
    expect(sections.map((s) => s.control)).toEqual([
      "add a date",
      "add an estimate",
      "add a person",
      "add a reminder",
      "add a note",
    ]);
  });

  it("gives the reminders section its control and lists them when present (WP7)", () => {
    const empty = buildSections(tp()).find((s) => s.id === "reminders")!;
    expect(empty.control).toBe("add a reminder");
    expect(empty.populated).toBe(false); // empty ⇒ heading hidden, control shown
    const withOne = buildSections(
      tp({ reminders: [{ id: "r", label: "A day before", when: null, isStart: false }] })
    ).find((s) => s.id === "reminders")!;
    expect(withOne.populated).toBe(true); // present ⇒ listed with its heading
    expect(withOne.control).toBe("add a reminder");
  });

  it("marks a section populated only when it has content", () => {
    // when: any of the four date fields
    expect(sectionPopulated(tp({ dueDate: "2026-08-07" })).when).toBe(true);
    expect(sectionPopulated(tp({ doDate: "2026-08-06" })).when).toBe(true);
    expect(sectionPopulated(tp({ deferUntil: "2026-09-01" })).when).toBe(true);
    // how long: estimate, actual, or a minimum piece
    expect(sectionPopulated(tp({ estimateMinutes: 90 })).howLong).toBe(true);
    expect(sectionPopulated(tp({ actualMinutes: 30 })).howLong).toBe(true);
    // who / reminders / notes: their lists
    expect(sectionPopulated(tp({ people: [person({})] })).who).toBe(true);
    expect(
      sectionPopulated(tp({ reminders: [{ id: "r", label: "x", when: null, isStart: false }] }))
        .reminders
    ).toBe(true);
    expect(sectionPopulated(tp({ notes: [{ id: "n", body: "hi" }] })).notes).toBe(true);
  });

  it("does not treat a bare unsplittable default as How-long content", () => {
    // splittable defaults false and minChunk null — that alone is not "content",
    // so an otherwise-empty task keeps How long collapsed to its control.
    expect(sectionPopulated(tp({ splittable: false })).howLong).toBe(false);
  });
});

describe("people — grouped pairs, not slots (R7)", () => {
  it("draws only the roles that have someone, in role order", () => {
    const people = [
      person({ personId: "a", name: "Ann", role: "assignee" }),
      person({ personId: "b", name: "Bo", role: "asked_by" }),
      person({ personId: "c", name: "Cy", role: "waiting_on" }),
    ];
    const groups = groupPeopleByRole(people);
    // asked_by, waiting_on, delegated_to, assignee — delegated_to is absent.
    expect(groups.map((g) => g.role)).toEqual(["asked_by", "waiting_on", "assignee"]);
    expect(groups.map((g) => g.heading)).toEqual(["Asked by", "Waiting on", "Assignee"]);
  });

  it("keeps two people in one role together, in the given (human) order", () => {
    const people = [
      person({ personId: "a", name: "Ann", role: "waiting_on" }),
      person({ personId: "b", name: "Bo", role: "waiting_on" }),
    ];
    const [group] = groupPeopleByRole(people);
    expect(group.people.map((p) => p.name)).toEqual(["Ann", "Bo"]);
  });

  it("shows no roles at all for a task with nobody attached", () => {
    expect(groupPeopleByRole([])).toEqual([]);
  });

  it("offers all four role words on the task page's add-a-person (role is asked here)", () => {
    // On the task page the role is not known, so all four are offered. (Where the
    // app already knows the role — the not-today waiting-on branch — it does not
    // ask; that branch is elsewhere and passes the role straight to addTaskPerson.)
    expect(ROLE_CHOICES.map((c) => c.role)).toEqual(ROLE_ORDER);
    expect(ROLE_CHOICES.map((c) => c.word)).toEqual([
      "asked by",
      "waiting on",
      "delegated to",
      "assignee",
    ]);
  });
});

describe("sidebar width — remembered in user.settings", () => {
  it("defaults when unset, and reads a stored width back", () => {
    expect(readSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(readSidebarWidth({})).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(readSidebarWidth({ [SIDEBAR_WIDTH_KEY]: 500 })).toBe(500);
  });

  it("clamps within bounds and ignores rubbish", () => {
    expect(clampSidebarWidth(10_000)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(423.7)).toBe(424);
    // A stored width outside the bounds is clamped on read, not trusted.
    expect(readSidebarWidth({ [SIDEBAR_WIDTH_KEY]: 99999 })).toBe(MAX_SIDEBAR_WIDTH);
    expect(readSidebarWidth({ [SIDEBAR_WIDTH_KEY]: "wide" })).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("formatting helpers", () => {
  it("formats minutes", () => {
    expect(fmtMinutes(90)).toBe("1h 30m");
    expect(fmtMinutes(120)).toBe("2h");
    expect(fmtMinutes(45)).toBe("45m");
  });

  it("describes shape", () => {
    expect(shapeText(false, null)).toBe("one run");
    expect(shapeText(true, null)).toBe("splittable");
    expect(shapeText(true, 45)).toBe("splittable · 45m at least");
  });
});
