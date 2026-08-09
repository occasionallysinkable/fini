import { describe, it, expect } from "vitest";
import {
  arrangeBoard,
  flattenGroups,
  compareTasks,
  deriveHidden,
  filterCounts,
  searchEverything,
  stateWords,
  captureSnapshot,
  applySnapshot,
  type BoardTask,
  type ColumnBox,
  type Sort,
  type ViewSnapshot,
} from "./board";

/*
  WP4 · the board's pure logic. These guard the four things that go silently
  wrong on a board: the order rows come out in, the derived hidden-column count,
  the "2 of 18" a filter chip prints, and the search that flattens by kind. The
  snapshot round-trip guards that Escape restores every field it captured.
*/

// A minimally-specified row; each test overrides only what it exercises.
function task(over: Partial<BoardTask>): BoardTask {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: "untitled",
    projectId: null,
    projectName: null,
    kind: "unassigned",
    status: "active",
    dueDate: null,
    dueTime: null,
    doDate: null,
    deferUntil: null,
    estimateMinutes: null,
    recurring: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const dueSort: Sort = { field: "due", dir: "asc" };

// The state line — one shared function so the board and the task page cannot
// drift (R6: the task page prints "the same words the board prints, in the same
// wording"). WP6's task-page sidebar calls this very function, so guarding its
// output here guards both surfaces at once.
describe("stateWords · the shared state line", () => {
  const today = "2026-08-08";

  it("names recurring, kind-not-set and deferred, in that order", () => {
    const t = task({ kind: "unassigned", recurring: true, deferUntil: "2026-09-01" });
    expect(stateWords(t, { today })).toEqual(["recurring", "kind not set", "deferred"]);
  });

  it("says nothing for a plain task with a set kind", () => {
    const t = task({ kind: "own" });
    expect(stateWords(t, { today })).toEqual([]);
  });

  it("only calls a future defer date 'deferred'", () => {
    expect(stateWords(task({ kind: "own", deferUntil: "2026-08-09" }), { today })).toEqual([
      "deferred",
    ]);
    // A defer date in the past is spent — no word.
    expect(stateWords(task({ kind: "own", deferUntil: "2026-08-01" }), { today })).toEqual([]);
  });

  it("adds the stale word only under the board's marked-in-place treatment", () => {
    const t = task({ kind: "own" });
    expect(stateWords(t, { today })).toEqual([]);
    expect(stateWords(t, { today, staleInPlace: true })).toEqual(["stale"]);
  });
});

describe("arrangeBoard · grouping and sort ordering", () => {
  it("sorts by due date soonest first, undated last", () => {
    const rows = [
      task({ id: "none", title: "no due" }),
      task({ id: "late", title: "later", dueDate: "2026-08-20" }),
      task({ id: "soon", title: "sooner", dueDate: "2026-08-08" }),
    ];
    const [group] = arrangeBoard(rows, [], dueSort);
    expect(group.tasks.map((t) => t.id)).toEqual(["soon", "late", "none"]);
  });

  it("breaks equal due dates by due time, then title", () => {
    const rows = [
      task({ id: "b", title: "b", dueDate: "2026-08-08", dueTime: "15:00" }),
      task({ id: "a", title: "a", dueDate: "2026-08-08", dueTime: "09:00" }),
      task({ id: "c", title: "c", dueDate: "2026-08-08", dueTime: null }),
    ];
    const [group] = arrangeBoard(rows, [], dueSort);
    // 09:00, then 15:00, then the timeless one last.
    expect(group.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("groups by project and orders groups by their soonest-due task", () => {
    const rows = [
      task({ id: "p1", projectId: "P1", projectName: "Alpha", dueDate: "2026-08-15" }),
      task({ id: "p2", projectId: "P2", projectName: "Beta", dueDate: "2026-08-09" }),
      task({ id: "p1b", projectId: "P1", projectName: "Alpha", dueDate: "2026-08-25" }),
    ];
    const groups = arrangeBoard(rows, ["project"], dueSort);
    // Beta leads (its earliest is 08-09, before Alpha's 08-15).
    expect(groups.map((g) => g.label)).toEqual(["Beta", "Alpha"]);
    // Within Alpha, soonest first.
    const alpha = groups.find((g) => g.label === "Alpha")!;
    expect(alpha.tasks.map((t) => t.id)).toEqual(["p1", "p1b"]);
    expect(alpha.count).toBe(2);
  });

  it("puts projectless tasks in a 'No project' group", () => {
    const rows = [task({ id: "x", dueDate: "2026-08-10" })];
    const groups = arrangeBoard(rows, ["project"], dueSort);
    expect(groups[0].label).toBe("No project");
  });

  it("supports a second grouping level (project then kind)", () => {
    const rows = [
      task({ id: "a", projectId: "P", projectName: "P", kind: "own", dueDate: "2026-08-10" }),
      task({ id: "b", projectId: "P", projectName: "P", kind: "commitment", dueDate: "2026-08-09" }),
    ];
    const groups = arrangeBoard(rows, ["project", "kind"], dueSort);
    expect(groups).toHaveLength(1);
    const sub = groups[0].groups;
    // commitment sub-group leads: its task is due sooner.
    expect(sub.map((g) => g.label)).toEqual(["commitment", "own"]);
    expect(flattenGroups(groups).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("reverses order under a descending sort but keeps nulls last", () => {
    const rows = [
      task({ id: "none" }),
      task({ id: "a", dueDate: "2026-08-08" }),
      task({ id: "b", dueDate: "2026-08-20" }),
    ];
    const desc = compareTasks;
    const sorted = [...rows].sort((x, y) => desc(x, y, { field: "due", dir: "desc" }));
    expect(sorted.map((t) => t.id)).toEqual(["b", "a", "none"]);
  });
});

describe("deriveHidden · from scroll geometry, not a disabled tally", () => {
  // Four scrollable columns, each 100 wide, laid out end to end after the
  // frozen title (which is 150 wide and lives at content x [0,150)).
  const boxes: ColumnBox[] = [
    { id: "project", offsetLeft: 150, width: 100 },
    { id: "due", offsetLeft: 250, width: 100 },
    { id: "estimate", offsetLeft: 350, width: 100 },
    { id: "kind", offsetLeft: 450, width: 100 },
  ];
  const FROZEN = 150;
  const VIEWPORT = 400; // shows 400px of content beyond the origin

  it("counts nothing hidden when everything fits", () => {
    // viewport wide enough (150 frozen + 4*100 = 550) to show all
    const h = deriveHidden(boxes, FROZEN, 0, 600);
    expect(h.left).toEqual([]);
    expect(h.right).toEqual([]);
  });

  it("counts columns off the right edge", () => {
    // At scrollLeft 0, viewport 400 → visible content [0,400). project fully
    // shows (150–250), due partially (250–350 within 400), estimate starts at
    // 350 (<400, partial), kind starts at 450 (>=400 → hidden right).
    const h = deriveHidden(boxes, FROZEN, 0, VIEWPORT);
    expect(h.right).toEqual(["kind"]);
    expect(h.left).toEqual([]);
  });

  it("counts columns fully swallowed by the frozen title as hidden-left", () => {
    // Scroll right by 200: the title covers content [200, 350). project
    // (150–250) and due (250–350) both end at or before 350, so both are fully
    // under the title. estimate (350–450) begins exactly at the title's edge, so
    // it is visible, not hidden.
    const h = deriveHidden(boxes, FROZEN, 200, VIEWPORT);
    expect(h.left).toEqual(["project", "due"]);
    // visible right edge = 200+400 = 600 → nothing past it.
    expect(h.right).toEqual([]);
  });

  it("does not count a partially visible column", () => {
    // Scroll by 50: title covers [50,200). project (150–250) right edge 250 >
    // 200, so it is only partly under the title → not hidden.
    const h = deriveHidden(boxes, FROZEN, 50, VIEWPORT);
    expect(h.left).toEqual([]);
  });
});

describe("filterCounts · a chip narrows the board and headers read '2 of 18'", () => {
  it("reads matched of total per group", () => {
    // 18 tasks in one project; 2 mention 'invoice'.
    const rows: BoardTask[] = [];
    for (let i = 0; i < 16; i++) {
      rows.push(task({ id: `t${i}`, title: `task ${i}`, projectId: "W", projectName: "Work" }));
    }
    rows.push(task({ id: "i1", title: "invoice backlog", projectId: "W", projectName: "Work" }));
    rows.push(task({ id: "i2", title: "send invoice", projectId: "W", projectName: "Work" }));

    const counts = filterCounts(rows, "project", ["invoice"]);
    expect(counts).toHaveLength(1);
    expect(counts[0].label).toBe("Work");
    expect(counts[0].matched).toBe(2);
    expect(counts[0].total).toBe(18);
    // The header string the component builds.
    expect(`${counts[0].matched} of ${counts[0].total}`).toBe("2 of 18");
  });

  it("drops groups with no match", () => {
    const rows = [
      task({ id: "a", title: "invoice", projectId: "W", projectName: "Work" }),
      task({ id: "b", title: "walk dog", projectId: "H", projectName: "Home" }),
    ];
    const counts = filterCounts(rows, "project", ["invoice"]);
    expect(counts.map((c) => c.label)).toEqual(["Work"]);
  });

  it("ANDs multiple chips", () => {
    const rows = [
      task({ id: "a", title: "send invoice to Priya" }),
      task({ id: "b", title: "send invoice to Ravi" }),
    ];
    const counts = filterCounts(rows, null, ["invoice", "priya"]);
    expect(counts[0].matched).toBe(1);
  });
});

describe("searchEverything · flattened and grouped by kind", () => {
  const sources = {
    activeTasks: [
      task({ id: "t1", title: "invoice backlog", projectName: "Work" }),
      task({ id: "t2", title: "walk the dog" }),
    ],
    completedTasks: [task({ id: "c1", title: "old invoice", status: "done" })],
    notes: [{ id: "n1", body: "invoice numbers from client", taskId: null }],
    projects: [
      { id: "p1", name: "Invoices" },
      { id: "p2", name: "Gardening" },
    ],
  };

  it("returns nothing for an empty query", () => {
    expect(searchEverything("   ", sources)).toEqual([]);
  });

  it("groups hits by kind, in a fixed order, dropping empty kinds", () => {
    const groups = searchEverything("invoice", sources);
    expect(groups.map((g) => g.kind)).toEqual(["task", "completed", "note", "project"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["t1"]);
    expect(groups[3].items.map((i) => i.primary)).toEqual(["Invoices"]);
  });

  it("ranks an earlier substring match first", () => {
    const s = {
      ...sources,
      activeTasks: [
        task({ id: "late", title: "backlog invoice" }),
        task({ id: "early", title: "invoice backlog" }),
      ],
    };
    const [tasksGroup] = searchEverything("invoice", s);
    expect(tasksGroup.items.map((i) => i.id)).toEqual(["early", "late"]);
  });
});

describe("captureSnapshot / applySnapshot · Escape restores exactly", () => {
  const view: ViewSnapshot = {
    grouping: ["project"],
    columns: ["title", "project", "due", "estimate"],
    sort: { field: "due", dir: "asc" },
    scrollLeft: 320,
    scrollTop: 40,
    selection: ["a", "b"],
  };

  it("round-trips every field", () => {
    expect(applySnapshot(captureSnapshot(view))).toEqual(view);
  });

  it("is isolated from later edits to the live view", () => {
    const live = captureSnapshot(view);
    const snap = captureSnapshot(live);
    // The user changes things during search…
    live.grouping.push("kind");
    live.columns.pop();
    live.selection.length = 0;
    live.sort.field = "title";
    live.scrollLeft = 0;
    // …the snapshot taken before search took over is untouched.
    expect(applySnapshot(snap)).toEqual(view);
  });
});
