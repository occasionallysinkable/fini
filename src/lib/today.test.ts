import { describe, it, expect } from "vitest";
import {
  addDays,
  furthestWeekday,
  tomorrow,
  selectToday,
  dueLine,
  type TodayTask,
} from "./today";

function task(p: Partial<TodayTask> & { id: string }): TodayTask {
  return {
    id: p.id,
    title: p.title ?? p.id,
    projectName: p.projectName ?? null,
    dueDate: p.dueDate ?? null,
    dueTime: p.dueTime ?? null,
    doDate: p.doDate ?? null,
    blocked: p.blocked ?? false,
    blockerLabel: p.blockerLabel ?? null,
  };
}

const TODAY = "2026-09-03"; // a Thursday

describe("date targets", () => {
  it("tomorrow is today + 1", () => {
    expect(tomorrow(TODAY)).toBe("2026-09-04");
  });

  it("the furthest weekday is today + 6, not today + 7 (which would wrap)", () => {
    const { date, label } = furthestWeekday(TODAY);
    expect(date).toBe(addDays(TODAY, 6));
    expect(date).toBe("2026-09-09"); // Wednesday
    expect(label).toBe("Wednesday");
    // A genuinely different offer from tomorrow.
    expect(date).not.toBe(tomorrow(TODAY));
  });
});

describe("selectToday · the set", () => {
  it("keeps tasks due today or do-dated today, drops the rest", () => {
    const rows = [
      task({ id: "dueToday", dueDate: TODAY }),
      task({ id: "doToday", doDate: TODAY }),
      task({ id: "dueTomorrow", dueDate: tomorrow(TODAY) }),
      task({ id: "doYesterday", doDate: addDays(TODAY, -1) }),
      task({ id: "nothing" }),
    ];
    const ids = selectToday(rows, TODAY).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["dueToday", "doToday"]));
    expect(ids).not.toContain("dueTomorrow");
    expect(ids).not.toContain("doYesterday");
    expect(ids).not.toContain("nothing");
  });
});

describe("selectToday · the order (R21: due date, then due time, then title)", () => {
  it("orders by due date, then due time, undated (do-only) last", () => {
    const rows = [
      task({ id: "doOnly", doDate: TODAY }), // no due date → last
      task({ id: "lateToday", dueDate: TODAY, dueTime: "17:00" }),
      task({ id: "earlyToday", dueDate: TODAY, dueTime: "09:00" }),
      task({ id: "noTime", dueDate: TODAY, dueTime: null }), // null time sorts after timed
      task({ id: "dueSoonWithDoToday", dueDate: tomorrow(TODAY), doDate: TODAY }),
    ];
    const ids = selectToday(rows, TODAY).map((t) => t.id);
    expect(ids).toEqual([
      "earlyToday",
      "lateToday",
      "noTime",
      "dueSoonWithDoToday",
      "doOnly",
    ]);
  });

  it("breaks a full tie by title", () => {
    const rows = [
      task({ id: "b", title: "Beta", dueDate: TODAY, dueTime: "10:00" }),
      task({ id: "a", title: "Alpha", dueDate: TODAY, dueTime: "10:00" }),
    ];
    expect(selectToday(rows, TODAY).map((t) => t.title)).toEqual(["Alpha", "Beta"]);
  });

  it("demotes blocked work below own work, whatever its due date", () => {
    const rows = [
      task({ id: "blockedEarly", dueDate: TODAY, dueTime: "08:00", blocked: true }),
      task({ id: "ownLate", dueDate: TODAY, dueTime: "23:00" }),
    ];
    // The blocked task is due earlier but must not lead — it is work you are
    // waiting on, present but demoted.
    expect(selectToday(rows, TODAY).map((t) => t.id)).toEqual(["ownLate", "blockedEarly"]);
  });
});

describe("dueLine · the flat line (R21)", () => {
  it("reads a due date today as 'Due today', with the time when there is one", () => {
    expect(dueLine(task({ id: "x", dueDate: TODAY }), TODAY)).toBe("Due today");
    expect(dueLine(task({ id: "x", dueDate: TODAY, dueTime: "15:00" }), TODAY)).toBe(
      "Due today 15:00"
    );
  });

  it("reads tomorrow and a further day plainly", () => {
    expect(dueLine(task({ id: "x", dueDate: tomorrow(TODAY), dueTime: "09:00" }), TODAY)).toBe(
      "Due tomorrow 09:00"
    );
    expect(dueLine(task({ id: "x", dueDate: "2026-09-10" }), TODAY)).toBe("Due Thursday 10 September");
  });

  it("says so plainly when a task is on today's plan with no due date", () => {
    expect(dueLine(task({ id: "x", doDate: TODAY }), TODAY)).toBe("No due date · on today's plan");
  });

  it("reads the blocker line for blocked work, not the due date", () => {
    const t = task({
      id: "x",
      dueDate: TODAY,
      blocked: true,
      blockerLabel: "waiting on Ravi, expected 4 Sep",
    });
    expect(dueLine(t, TODAY)).toBe("waiting on Ravi, expected 4 Sep");
  });
});
