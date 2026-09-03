import { describe, it, expect } from "vitest";
import {
  WHOLE_DAY_MINUTES,
  hhmmToMinutes,
  windowMinutes,
  capacityFromWindowMinutes,
  capacityNote,
  shiftAdmitsCategory,
  routeTasks,
  shiftLoad,
  dayTotalMinutes,
  remainingLabel,
  unestimatedLabel,
  onboardHoursToMinutes,
  isOnboarded,
  readWakingHours,
  everyWeekday,
  weekdaysLabel,
  shiftDayIntervals,
  blockShiftOverlapMinutes,
  chargeBlockAcrossShifts,
  type RoutableShift,
  type RoutableTask,
  type ChargeableShift,
  type BlockInterval,
} from "./shifts";

const EVERY = everyWeekday();
// A shift active only on weekdays Mon–Fri (index 1..5).
const MON_FRI = [false, true, true, true, true, true, false];

describe("hhmmToMinutes", () => {
  it("parses valid times", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("23:59")).toBe(1439);
    expect(hhmmToMinutes("24:00")).toBe(1440);
  });
  it("rejects malformed", () => {
    expect(hhmmToMinutes(null)).toBeNull();
    expect(hhmmToMinutes("")).toBeNull();
    expect(hhmmToMinutes("9")).toBeNull();
    expect(hhmmToMinutes("9:5")).toBeNull();
    expect(hhmmToMinutes("aa:bb")).toBeNull();
    expect(hhmmToMinutes("10:99")).toBeNull();
  });
});

describe("windowMinutes", () => {
  it("ordinary window is end minus start", () => {
    expect(windowMinutes("09:00", "17:00")).toBe(8 * 60);
    expect(windowMinutes("13:00", "13:45")).toBe(45);
  });
  it("start === end is the whole day (R29 default)", () => {
    expect(windowMinutes("00:00", "00:00")).toBe(WHOLE_DAY_MINUTES);
    expect(windowMinutes("08:00", "08:00")).toBe(WHOLE_DAY_MINUTES);
  });
  it("crossing midnight wraps (R29 11:00–03:00)", () => {
    expect(windowMinutes("23:00", "01:00")).toBe(2 * 60);
    expect(windowMinutes("11:00", "03:00")).toBe(16 * 60);
  });
  it("malformed times hold no minutes", () => {
    expect(windowMinutes("bad", "17:00")).toBe(0);
  });
  it("capacityFromWindowMinutes is the window length", () => {
    expect(capacityFromWindowMinutes("09:00", "17:00")).toBe(480);
  });
});

describe("capacityNote", () => {
  it("says the capacity was pre-filled from the window (R13)", () => {
    expect(capacityNote("09:00", "17:00")).toBe(
      "Pre-filled from the window (8h). Edit to override."
    );
  });
});

describe("shiftAdmitsCategory (invariant 12)", () => {
  it("empty admit-list admits everything, including uncategorised", () => {
    expect(shiftAdmitsCategory([], "c1")).toBe(true);
    expect(shiftAdmitsCategory([], null)).toBe(true);
  });
  it("a restricted shift admits only its listed categories", () => {
    expect(shiftAdmitsCategory(["c1", "c2"], "c1")).toBe(true);
    expect(shiftAdmitsCategory(["c1", "c2"], "c3")).toBe(false);
  });
  it("a restricted shift does not admit an uncategorised task", () => {
    expect(shiftAdmitsCategory(["c1"], null)).toBe(false);
  });
});

describe("routeTasks", () => {
  const day: RoutableShift = {
    id: "day",
    startMinutes: 0,
    endMinutes: 0,
    weekdays: EVERY,
    admittedCategoryIds: [],
  };
  const morning: RoutableShift = {
    id: "morning",
    startMinutes: 9 * 60,
    endMinutes: 12 * 60,
    weekdays: MON_FRI,
    admittedCategoryIds: ["work"],
  };
  const afternoon: RoutableShift = {
    id: "afternoon",
    startMinutes: 13 * 60,
    endMinutes: 17 * 60,
    weekdays: MON_FRI,
    admittedCategoryIds: ["work"],
  };

  it("routes every untimed task to the single Day shift (stage-1 shape)", () => {
    const tasks: RoutableTask[] = [
      { id: "t1", categoryId: null, estimateMinutes: 30 },
      { id: "t2", categoryId: "anything", estimateMinutes: 60 },
    ];
    const { byShift, unrouted } = routeTasks([day], tasks, 3 /* Wed */);
    expect(byShift.get("day")!.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(unrouted).toHaveLength(0);
  });

  it("routes a task to the earliest admitting shift, counted once", () => {
    const tasks: RoutableTask[] = [{ id: "t1", categoryId: "work", estimateMinutes: 45 }];
    // Wednesday (index 3): both morning and afternoon are active and admit work.
    const { byShift } = routeTasks([afternoon, morning], tasks, 3);
    // Earliest window start wins regardless of passed order → morning.
    expect(byShift.get("morning")!.map((t) => t.id)).toEqual(["t1"]);
    expect(byShift.get("afternoon")).toEqual([]);
  });

  it("does not route to a shift that is off that weekday", () => {
    const tasks: RoutableTask[] = [{ id: "t1", categoryId: "work", estimateMinutes: 45 }];
    // Sunday (index 0): Mon–Fri shifts are off → nowhere to go.
    const { byShift, unrouted } = routeTasks([morning, afternoon], tasks, 0);
    expect(byShift.get("morning")).toEqual([]);
    expect(unrouted.map((t) => t.id)).toEqual(["t1"]);
  });

  it("leaves a task unrouted when no active shift admits its category", () => {
    const tasks: RoutableTask[] = [{ id: "t1", categoryId: "errand", estimateMinutes: 20 }];
    const { unrouted } = routeTasks([morning, afternoon], tasks, 3);
    expect(unrouted.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("shiftLoad + dayTotal (invariants 3, 5)", () => {
  it("sums estimates and counts the unestimated separately", () => {
    const routed: RoutableTask[] = [
      { id: "a", categoryId: null, estimateMinutes: 30 },
      { id: "b", categoryId: null, estimateMinutes: 90 },
      { id: "c", categoryId: null, estimateMinutes: null },
    ];
    const load = shiftLoad(routed, 480);
    expect(load.scheduledMinutes).toBe(120);
    expect(load.unestimatedCount).toBe(1);
    expect(load.remainingMinutes).toBe(360);
  });

  it("remaining goes negative on an overload (never hidden)", () => {
    const routed: RoutableTask[] = [{ id: "a", categoryId: null, estimateMinutes: 600 }];
    const load = shiftLoad(routed, 480);
    expect(load.remainingMinutes).toBe(-120);
  });

  it("null capacity yields null remaining", () => {
    const load = shiftLoad([{ id: "a", categoryId: null, estimateMinutes: 30 }], null);
    expect(load.remainingMinutes).toBeNull();
  });

  it("day total is the sum of the shifts' scheduled minutes", () => {
    const l1 = shiftLoad([{ id: "a", categoryId: null, estimateMinutes: 120 }], 480);
    const l2 = shiftLoad([{ id: "b", categoryId: null, estimateMinutes: 60 }], 240);
    expect(dayTotalMinutes([l1, l2])).toBe(180);
  });
});

describe("remainingLabel + unestimatedLabel (invariant 7 — words)", () => {
  it("names left / full / over by", () => {
    expect(remainingLabel(90)).toBe("1h 30m left");
    expect(remainingLabel(0)).toBe("full");
    expect(remainingLabel(-45)).toBe("over by 45m");
    expect(remainingLabel(null)).toBe("no capacity set");
  });
  it("unestimated shows only when there is something to caveat", () => {
    expect(unestimatedLabel(0)).toBeNull();
    expect(unestimatedLabel(2)).toBe("2 unestimated");
  });
});

describe("onboardHoursToMinutes (R13)", () => {
  it("converts hours to minutes in range", () => {
    expect(onboardHoursToMinutes(8)).toBe(480);
    expect(onboardHoursToMinutes(6.5)).toBe(390);
    expect(onboardHoursToMinutes(0.5)).toBe(30);
    expect(onboardHoursToMinutes(24)).toBe(1440);
  });
  it("rejects out-of-range or unreadable answers", () => {
    expect(onboardHoursToMinutes(0)).toBeNull();
    expect(onboardHoursToMinutes(-3)).toBeNull();
    expect(onboardHoursToMinutes(25)).toBeNull();
    expect(onboardHoursToMinutes(NaN)).toBeNull();
  });
});

describe("isOnboarded (R14 — the app never asks again)", () => {
  it("is true once a shift exists", () => {
    expect(isOnboarded({}, 1)).toBe(true);
    expect(isOnboarded(null, 2)).toBe(true);
  });
  it("is true when the flag records the answer even with no shifts", () => {
    expect(isOnboarded({ onboardedAt: "2026-09-03T10:00:00.000Z" }, 0)).toBe(true);
  });
  it("is false on a fresh account with neither", () => {
    expect(isOnboarded({}, 0)).toBe(false);
    expect(isOnboarded(null, 0)).toBe(false);
    expect(isOnboarded({ onboardedAt: "" }, 0)).toBe(false);
  });
});

describe("readWakingHours (R29 default whole day)", () => {
  it("defaults to 00:00–00:00", () => {
    expect(readWakingHours({ wakingStart: null, wakingEnd: null })).toEqual({
      start: "00:00",
      end: "00:00",
    });
  });
  it("returns the stored window, midnight-crossing allowed", () => {
    expect(readWakingHours({ wakingStart: "11:00", wakingEnd: "03:00" })).toEqual({
      start: "11:00",
      end: "03:00",
    });
  });
});

describe("weekdaysLabel", () => {
  it("collapses common shapes", () => {
    expect(weekdaysLabel(everyWeekday())).toBe("every day");
    expect(weekdaysLabel(MON_FRI)).toBe("Mon–Fri");
    expect(weekdaysLabel([true, false, false, true, false, false, false])).toBe("Sun, Wed");
    expect(weekdaysLabel([false, false, false, false, false, false, false])).toBe("no days");
  });
});

// ---------------------------------------------------------------------------
// WP14 · block overlap charging — the arithmetic the calendar exists to get
// right. Times are minutes past midnight (9:00 = 540). The five named cases come
// straight from blocks-across-shifts.md; charging by overlap, never by where the
// block started, is the whole point.
// ---------------------------------------------------------------------------

const H = (h: number, m = 0) => h * 60 + m;

describe("shiftDayIntervals", () => {
  it("an ordinary window is one interval", () => {
    expect(shiftDayIntervals(H(9), H(17))).toEqual([[540, 1020]]);
  });
  it("start === end is the whole day", () => {
    expect(shiftDayIntervals(0, 0)).toEqual([[0, 1440]]);
    expect(shiftDayIntervals(H(8), H(8))).toEqual([[0, 1440]]);
  });
  it("a midnight-crossing window is two pieces", () => {
    expect(shiftDayIntervals(H(23), H(3))).toEqual([
      [1380, 1440],
      [0, 180],
    ]);
  });
});

describe("blockShiftOverlapMinutes", () => {
  it("a block wholly inside one shift is charged its whole length", () => {
    // Morning 9–12, block 10:00–11:00 → the whole 60 minutes are the shift's.
    expect(blockShiftOverlapMinutes({ startMinutes: H(10), endMinutes: H(11) }, { startMinutes: H(9), endMinutes: H(12) })).toBe(60);
  });
  it("a block entirely outside a shift is charged nothing", () => {
    expect(blockShiftOverlapMinutes({ startMinutes: H(13), endMinutes: H(14) }, { startMinutes: H(9), endMinutes: H(12) })).toBe(0);
  });
  it("a whole-day shift absorbs the whole block", () => {
    expect(blockShiftOverlapMinutes({ startMinutes: H(10), endMinutes: H(12) }, { startMinutes: 0, endMinutes: 0 })).toBe(120);
  });
  it("a midnight-crossing shift covers both its late-night and early-morning pieces", () => {
    // Shift 23:00–03:00. A block in the late piece (23:15–23:45) → 30m.
    expect(blockShiftOverlapMinutes({ startMinutes: H(23, 15), endMinutes: H(23, 45) }, { startMinutes: H(23), endMinutes: H(3) })).toBe(30);
    // A block in the early piece (01:00–02:00) → 60m.
    expect(blockShiftOverlapMinutes({ startMinutes: H(1), endMinutes: H(2) }, { startMinutes: H(23), endMinutes: H(3) })).toBe(60);
  });
});

describe("chargeBlockAcrossShifts — the five cases (blocks-across-shifts.md)", () => {
  const morning = (over: Partial<ChargeableShift> = {}): ChargeableShift => ({
    id: "morning",
    name: "Morning",
    startMinutes: H(9),
    endMinutes: H(12),
    admittedCategoryIds: ["work"],
    capacityMinutes: 180,
    priorLoadMinutes: 0,
    ...over,
  });

  it("case one · crosses into the next accepting shift, 30m each", () => {
    const afternoon: ChargeableShift = {
      id: "afternoon", name: "Afternoon", startMinutes: H(12), endMinutes: H(17),
      admittedCategoryIds: ["work"], capacityMinutes: 300, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(11, 30), endMinutes: H(12, 30) };
    const r = chargeBlockAcrossShifts(block, [morning(), afternoon], "work");
    expect(r.charges.map((c) => [c.shiftId, c.overlapMinutes])).toEqual([
      ["morning", 30],
      ["afternoon", 30],
    ]);
    expect(r.uncoveredMinutes).toBe(0);
    expect(r.startedInShiftId).toBe("morning");
    expect(r.extendsBeyondStartShift).toBe(true);
    expect(r.overCapacityShiftIds).toEqual([]);
    expect(r.charges.every((c) => c.admitsTask)).toBe(true);
  });

  it("case two · crosses a gap where no shift runs → middle hour uncovered", () => {
    const afternoon: ChargeableShift = {
      id: "afternoon", name: "Afternoon", startMinutes: H(13), endMinutes: H(17),
      admittedCategoryIds: ["work"], capacityMinutes: 240, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(11, 30), endMinutes: H(13, 30) };
    const r = chargeBlockAcrossShifts(block, [morning(), afternoon], "work");
    expect(r.charges.map((c) => [c.shiftId, c.overlapMinutes])).toEqual([
      ["morning", 30],
      ["afternoon", 30],
    ]);
    expect(r.uncoveredMinutes).toBe(60); // the lunch hour belongs to no shift
    expect(r.overCapacityShiftIds).toEqual([]);
  });

  it("case three · crosses into a shift that does not accept the task", () => {
    const deep: ChargeableShift = {
      id: "deep", name: "Deep Work", startMinutes: H(9), endMinutes: H(12),
      admittedCategoryIds: ["work"], capacityMinutes: 180, priorLoadMinutes: 0,
    };
    const calls: ChargeableShift = {
      id: "calls", name: "Calls", startMinutes: H(12), endMinutes: H(14),
      admittedCategoryIds: ["calls"], capacityMinutes: 120, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(11), endMinutes: H(13) }; // project work
    const r = chargeBlockAcrossShifts(block, [deep, calls], "work");
    expect(r.charges.map((c) => [c.shiftId, c.overlapMinutes, c.admitsTask])).toEqual([
      ["deep", 60, true],
      ["calls", 60, false], // charged anyway; the tablet names the disagreement
    ]);
    expect(r.uncoveredMinutes).toBe(0);
  });

  it("case four · runs off the end of the last shift → overhang uncovered", () => {
    const evening: ChargeableShift = {
      id: "evening", name: "Evening", startMinutes: H(19), endMinutes: H(21),
      admittedCategoryIds: [], capacityMinutes: 120, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(20), endMinutes: H(22) };
    const r = chargeBlockAcrossShifts(block, [evening], null);
    expect(r.charges.map((c) => [c.shiftId, c.overlapMinutes])).toEqual([["evening", 60]]);
    expect(r.uncoveredMinutes).toBe(60); // the hour after the day ends
    expect(r.overCapacityShiftIds).toEqual([]);
    expect(r.extendsBeyondStartShift).toBe(true);
  });

  it("case five · swallows a short shift whole → it fills and goes over", () => {
    const morn: ChargeableShift = {
      id: "morning", name: "Morning", startMinutes: H(9), endMinutes: H(11),
      admittedCategoryIds: ["work"], capacityMinutes: 120, priorLoadMinutes: 0,
    };
    const errands: ChargeableShift = {
      id: "errands", name: "Errands", startMinutes: H(11), endMinutes: H(12),
      admittedCategoryIds: [], capacityMinutes: 60, priorLoadMinutes: 30, // already holds a 30m errand
    };
    const afternoon: ChargeableShift = {
      id: "afternoon", name: "Afternoon", startMinutes: H(12), endMinutes: H(17),
      admittedCategoryIds: ["work"], capacityMinutes: 300, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(10), endMinutes: H(13) }; // 3 hours
    const r = chargeBlockAcrossShifts(block, [morn, errands, afternoon], "work");
    expect(r.charges.map((c) => [c.shiftId, c.overlapMinutes])).toEqual([
      ["morning", 60],
      ["errands", 60], // its whole hour
      ["afternoon", 60],
    ]);
    const err = r.charges.find((c) => c.shiftId === "errands")!;
    expect(err.totalMinutes).toBe(90); // 30 prior + 60 block
    expect(err.overByMinutes).toBe(30); // over its 60-minute capacity
    expect(r.overCapacityShiftIds).toEqual(["errands"]); // → popup, not tablet
    expect(r.uncoveredMinutes).toBe(0);
  });

  it("a block in no shift at all is charged to nobody but still measured", () => {
    // Saturday-style: no shift covers the drop. Nothing charged, still occupied.
    const block: BlockInterval = { startMinutes: H(19), endMinutes: H(20) };
    const r = chargeBlockAcrossShifts(block, [], null);
    expect(r.charges).toEqual([]);
    expect(r.uncoveredMinutes).toBe(60);
    expect(r.startedInShiftId).toBeNull();
    expect(r.extendsBeyondStartShift).toBe(true);
    expect(r.overCapacityShiftIds).toEqual([]);
  });

  it("a block wholly inside one shift does not extend beyond it", () => {
    const block: BlockInterval = { startMinutes: H(9, 30), endMinutes: H(10, 30) };
    const r = chargeBlockAcrossShifts(block, [morning()], "work");
    expect(r.charges).toEqual([
      { shiftId: "morning", shiftName: "Morning", overlapMinutes: 60, admitsTask: true, totalMinutes: 60, overByMinutes: 0 },
    ]);
    expect(r.extendsBeyondStartShift).toBe(false);
    expect(r.uncoveredMinutes).toBe(0);
  });

  it("the block-length equals the estimate invariant (5): overlaps + uncovered sum to it", () => {
    const afternoon: ChargeableShift = {
      id: "afternoon", name: "Afternoon", startMinutes: H(13), endMinutes: H(17),
      admittedCategoryIds: ["work"], capacityMinutes: 240, priorLoadMinutes: 0,
    };
    const estimate = 120;
    const block: BlockInterval = { startMinutes: H(11, 30), endMinutes: H(11, 30) + estimate };
    const r = chargeBlockAcrossShifts(block, [morning(), afternoon], "work");
    const charged = r.charges.reduce((s, c) => s + c.overlapMinutes, 0);
    expect(charged + r.uncoveredMinutes).toBe(estimate);
  });
});
