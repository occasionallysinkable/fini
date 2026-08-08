import { describe, it, expect } from "vitest";
import {
  SWEEP_THRESHOLD,
  UNDO_VERB,
  KEEP_VERB,
  ageInDays,
  buildStaleRows,
  isStale,
  isTouch,
  keptLabel,
  lastTouchAt,
  readStaleTreatment,
  showSweeps,
  staleView,
  type StaleTaskInput,
} from "./stale";

/*
  WP5 · the stale block's arithmetic, tested where a silent bug would cost: the
  fourteen-day derivation, the kept-count wording, the three-at-a-time cut, and
  the block's absence when nothing is stale. The DB round-trip (that keep/push/
  kill write through mutate() and undo) is pinned in board/actions.test.ts and
  verified in the running app.
*/

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-08-08T12:00:00.000Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

describe("isStale · the fourteen-day derivation from activity rows", () => {
  it("is stale when the last activity row is fourteen days old and status is active", () => {
    expect(
      isStale({ status: "active", lastActivityAt: daysAgo(14), createdAt: daysAgo(40) }, now)
    ).toBe(true);
  });

  it("is stale when the last activity is older than fourteen days", () => {
    expect(
      isStale({ status: "active", lastActivityAt: daysAgo(30), createdAt: daysAgo(40) }, now)
    ).toBe(true);
  });

  it("is not stale when an activity row touched it within fourteen days", () => {
    expect(
      isStale({ status: "active", lastActivityAt: daysAgo(13), createdAt: daysAgo(40) }, now)
    ).toBe(false);
    // One day short: a keep or edit yesterday resets the clock, which is the
    // whole mechanism — keeping writes an activity row.
    expect(
      isStale({ status: "active", lastActivityAt: daysAgo(1), createdAt: daysAgo(40) }, now)
    ).toBe(false);
  });

  it("is never stale unless the status is active", () => {
    for (const status of ["done", "cancelled", "someday"]) {
      expect(
        isStale({ status, lastActivityAt: daysAgo(60), createdAt: daysAgo(90) }, now)
      ).toBe(false);
    }
  });

  it("falls back to creation when the task has no activity row at all", () => {
    expect(
      isStale({ status: "active", lastActivityAt: null, createdAt: daysAgo(20) }, now)
    ).toBe(true);
    expect(
      isStale({ status: "active", lastActivityAt: null, createdAt: daysAgo(3) }, now)
    ).toBe(false);
  });
});

describe("isTouch / lastTouchAt · undo returns a task to the block", () => {
  const future = new Date(now.getTime() + 30 * DAY);

  it("counts a normal write as a touch", () => {
    expect(isTouch({ verb: "task.edit.title", undoExpiresAt: future })).toBe(true);
    // Even a long-expired window is still a real, if old, touch.
    expect(isTouch({ verb: "task.capture", undoExpiresAt: daysAgo(20) })).toBe(true);
  });

  it("does not count an undo row — it records a reversal, not work", () => {
    expect(isTouch({ verb: UNDO_VERB, undoExpiresAt: null })).toBe(false);
  });

  it("does not count an action that was itself undone (undoExpiresAt nulled)", () => {
    expect(isTouch({ verb: KEEP_VERB, undoExpiresAt: null })).toBe(false);
  });

  it("keep then undo leaves no touch since the original capture — task is stale again", () => {
    // The ledger after: keep a 61-day-old task, then undo the keep.
    const rows = [
      { verb: "task.capture", at: daysAgo(61), undoExpiresAt: daysAgo(31) }, // the last genuine touch
      { verb: KEEP_VERB, at: daysAgo(0), undoExpiresAt: null }, // the keep, now undone
      { verb: UNDO_VERB, at: daysAgo(0), undoExpiresAt: null }, // the undo row
    ];
    const touch = lastTouchAt(rows);
    expect(touch).toEqual(daysAgo(61));
    // → back in the block. (Kept count comes from non-undone keep rows: zero.)
    expect(isStale({ status: "active", lastActivityAt: touch, createdAt: daysAgo(61) }, now)).toBe(true);
  });

  it("a keep that stands (not undone) is a touch — the task is muted, not stale", () => {
    const rows = [
      { verb: "task.capture", at: daysAgo(61), undoExpiresAt: daysAgo(31) },
      { verb: KEEP_VERB, at: daysAgo(1), undoExpiresAt: new Date(now.getTime() + 29 * DAY) },
    ];
    const touch = lastTouchAt(rows);
    expect(touch).toEqual(daysAgo(1));
    expect(isStale({ status: "active", lastActivityAt: touch, createdAt: daysAgo(61) }, now)).toBe(false);
  });

  it("push then undo behaves the same as keep then undo", () => {
    const rows = [
      { verb: "task.capture", at: daysAgo(40), undoExpiresAt: daysAgo(10) },
      { verb: "task.bulkPush", at: daysAgo(0), undoExpiresAt: null }, // pushed, then undone
      { verb: UNDO_VERB, at: daysAgo(0), undoExpiresAt: null },
    ];
    const touch = lastTouchAt(rows);
    expect(touch).toEqual(daysAgo(40));
    expect(isStale({ status: "active", lastActivityAt: touch, createdAt: daysAgo(40) }, now)).toBe(true);
  });

  it("returns null when a task's only writes were all reversed", () => {
    expect(
      lastTouchAt([
        { verb: KEEP_VERB, at: daysAgo(2), undoExpiresAt: null },
        { verb: UNDO_VERB, at: daysAgo(2), undoExpiresAt: null },
      ])
    ).toBeNull();
  });
});

describe("keptLabel · wording across first, second and third appearance", () => {
  it("shows no label on the first appearance (never kept)", () => {
    expect(keptLabel(0)).toBeNull();
  });
  it("reads 'kept once' on the second appearance", () => {
    expect(keptLabel(1)).toBe("kept once");
  });
  it("reads 'kept twice' on the third appearance", () => {
    expect(keptLabel(2)).toBe("kept twice");
  });
  it("keeps counting past twice", () => {
    expect(keptLabel(3)).toBe("kept 3 times");
    expect(keptLabel(5)).toBe("kept 5 times");
  });
});

describe("ageInDays · total age since creation", () => {
  it("floors to whole days", () => {
    expect(ageInDays(daysAgo(28), now)).toBe(28);
    expect(ageInDays(new Date(now.getTime() - 41 * DAY - 3600_000), now)).toBe(41);
  });
});

function input(id: string, createdDaysAgo: number, keptCount = 0): StaleTaskInput {
  return { id, title: id, projectName: null, createdAt: daysAgo(createdDaysAgo), keptCount };
}

describe("buildStaleRows · oldest first, kept label and age carried", () => {
  it("orders by total age, oldest (earliest created) first", () => {
    const rows = buildStaleRows([input("young", 15), input("old", 61), input("mid", 30)], now);
    expect(rows.map((r) => r.id)).toEqual(["old", "mid", "young"]);
    expect(rows[0].ageDays).toBe(61);
  });

  it("computes the kept label from the kept count", () => {
    const rows = buildStaleRows([input("a", 28, 1)], now);
    expect(rows[0].keptLabel).toBe("kept once");
    expect(rows[0].keptCount).toBe(1);
  });

  it("is empty when nothing is stale — the block then shows nothing", () => {
    expect(buildStaleRows([], now)).toEqual([]);
  });
});

describe("staleView · three at a time, the remainder counted and its oldest named", () => {
  const rows = buildStaleRows(
    [input("a", 61), input("b", 50), input("c", 40), input("d", 30), input("e", 20), input("f", 15)],
    now
  );

  it("shows three and counts the rest, naming the oldest of the remainder", () => {
    const v = staleView(rows, false);
    expect(v.shown.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(v.remainderCount).toBe(3);
    // The oldest of the unshown three is "d", created thirty days ago.
    expect(v.remainderOldestAgeDays).toBe(30);
  });

  it("shows every row when expanded (the 'go through all' sweep), no remainder", () => {
    const v = staleView(rows, true);
    expect(v.shown).toHaveLength(6);
    expect(v.remainderCount).toBe(0);
    expect(v.remainderOldestAgeDays).toBeNull();
  });

  it("has no remainder when three or fewer are stale", () => {
    const few = buildStaleRows([input("a", 61), input("b", 20)], now);
    const v = staleView(few, false);
    expect(v.shown).toHaveLength(2);
    expect(v.remainderCount).toBe(0);
    expect(v.remainderOldestAgeDays).toBeNull();
  });
});

describe("showSweeps · past a handful (a judgement call, not a spec value)", () => {
  it("appears at the threshold and above, not below", () => {
    expect(SWEEP_THRESHOLD).toBe(6);
    expect(showSweeps(SWEEP_THRESHOLD - 1)).toBe(false);
    expect(showSweeps(SWEEP_THRESHOLD)).toBe(true);
    expect(showSweeps(20)).toBe(true);
  });
});

describe("readStaleTreatment · the config-panel control persisted in settings", () => {
  it("defaults to the block when nothing is set", () => {
    expect(readStaleTreatment(null)).toBe("block");
    expect(readStaleTreatment({})).toBe("block");
  });
  it("reads the three explicit positions", () => {
    expect(readStaleTreatment({ staleTreatment: "block" })).toBe("block");
    expect(readStaleTreatment({ staleTreatment: "inPlace" })).toBe("inPlace");
    expect(readStaleTreatment({ staleTreatment: "off" })).toBe("off");
  });
  it("falls back to the older boolean shape (staleMechanism: false → off)", () => {
    expect(readStaleTreatment({ staleMechanism: false })).toBe("off");
    expect(readStaleTreatment({ staleMechanism: true })).toBe("block");
  });
});
