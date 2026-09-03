import { describe, it, expect } from "vitest";
import {
  ACTIVITY_FILTERS,
  resolveFilter,
  groupByDay,
  type ActivityLine,
} from "./activity";

describe("activity filters (R10)", () => {
  it("lists the six, in order, everything first with a null kind", () => {
    expect(ACTIVITY_FILTERS.map((f) => f.key)).toEqual([
      "everything",
      "reminders",
      "overrides",
      "dates",
      "people",
      "deletions",
    ]);
    expect(ACTIVITY_FILTERS[0].kind).toBeNull();
  });

  it("resolves a known key, and falls back to everything for junk or absence", () => {
    expect(resolveFilter("overrides").key).toBe("overrides");
    expect(resolveFilter("dates").kind).toBe("dates");
    expect(resolveFilter(null).key).toBe("everything");
    expect(resolveFilter("nonsense").key).toBe("everything");
  });
});

function line(
  id: string,
  dayIso: string,
  heading: string
): ActivityLine & { dayIso: string; heading: string } {
  return {
    id,
    at: `${dayIso}T10:00:00.000Z`,
    time: "10:00",
    who: "You",
    summary: id,
    undoable: false,
    isDeletion: false,
    dayIso,
    heading,
  };
}

describe("groupByDay (R9)", () => {
  it("groups consecutive same-day lines under one heading, days newest-first", () => {
    const rows = [
      line("a", "2026-09-03", "Thursday 3 September"),
      line("b", "2026-09-03", "Thursday 3 September"),
      line("c", "2026-09-02", "Wednesday 2 September"),
    ];
    const days = groupByDay(rows);
    expect(days).toHaveLength(2);
    expect(days[0].dayIso).toBe("2026-09-03");
    expect(days[0].lines.map((l) => l.id)).toEqual(["a", "b"]);
    expect(days[1].dayIso).toBe("2026-09-02");
    expect(days[1].lines.map((l) => l.id)).toEqual(["c"]);
    // The day-tagging fields are stripped from the emitted lines.
    expect("dayIso" in days[0].lines[0]).toBe(false);
  });

  it("returns no days for an empty stream", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
