import { describe, it, expect } from "vitest";
import {
  weekdayIndexOf,
  addDaysIso,
  clampDayCount,
  calendarDays,
  rangeLabel,
  instantToWallMinutes,
  minutesToHHMM,
  blockStartInstant,
  blockGridInterval,
  blockTimeLabel,
  blockConsequence,
  DEFAULT_CALENDAR_DAYS,
  MAX_CALENDAR_DAYS,
} from "./calendar";
import { chargeBlockAcrossShifts, type ChargeableShift, type BlockInterval } from "./shifts";

const H = (h: number, m = 0) => h * 60 + m;

describe("day range (R8 — seven days from today, not a Mon–Sun week)", () => {
  it("weekdayIndexOf reads a plain date", () => {
    // 2026-08-06 is a Thursday (index 4).
    expect(weekdayIndexOf("2026-08-06")).toBe(4);
  });
  it("addDaysIso stays a plain date across a month boundary", () => {
    expect(addDaysIso("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("calendarDays starts today and runs forward", () => {
    const days = calendarDays("2026-08-06", 3);
    expect(days.map((d) => d.iso)).toEqual(["2026-08-06", "2026-08-07", "2026-08-08"]);
    expect(days[0].isToday).toBe(true);
    expect(days[0].weekdayLong).toBe("Thursday");
    expect(days[1].weekdayShort).toBe("Fri");
    expect(days[2].monthShort).toBe("Aug");
  });
  it("clampDayCount keeps the field sane", () => {
    expect(clampDayCount(null)).toBe(DEFAULT_CALENDAR_DAYS);
    expect(clampDayCount(NaN)).toBe(DEFAULT_CALENDAR_DAYS);
    expect(clampDayCount(0)).toBe(1);
    expect(clampDayCount(1)).toBe(1);
    expect(clampDayCount(200)).toBe(MAX_CALENDAR_DAYS);
    expect(clampDayCount(3.4)).toBe(3);
  });
  it("rangeLabel reads naturally", () => {
    expect(rangeLabel(calendarDays("2026-08-06", 7))).toBe("6 – 12 August");
    expect(rangeLabel(calendarDays("2026-08-30", 7))).toBe("30 Aug – 5 Sep");
    expect(rangeLabel(calendarDays("2026-08-06", 1))).toBe("6 Aug");
  });
});

describe("wall-clock ⇄ instant for a block (invariant 10)", () => {
  it("a block round-trips through the user's zone at the same wall hour", () => {
    // 09:30 on 6 Aug in New York, read back in New York, is 09:30 (570 minutes).
    const start = blockStartInstant("2026-08-06", "09:30", "America/New_York");
    expect(instantToWallMinutes(start, "America/New_York")).toBe(H(9, 30));
  });
  it("blockGridInterval places the block and keeps length = estimate", () => {
    const start = blockStartInstant("2026-08-06", "11:30", "America/New_York");
    const end = new Date(start.getTime() + 120 * 60_000); // a two-hour block
    const interval = blockGridInterval(start, end, "America/New_York");
    expect(interval.startMinutes).toBe(H(11, 30));
    expect(interval.endMinutes - interval.startMinutes).toBe(120); // estimate preserved
  });
  it("minutesToHHMM / blockTimeLabel format the grid times", () => {
    expect(minutesToHHMM(570)).toBe("09:30");
    expect(minutesToHHMM(0)).toBe("00:00");
    expect(blockTimeLabel({ startMinutes: H(19), endMinutes: H(20) })).toBe("19:00–20:00");
  });
});

describe("blockConsequence — the tablet and the popup (invariant 8, no toast)", () => {
  const morning: ChargeableShift = {
    id: "morning", name: "Morning", startMinutes: H(9), endMinutes: H(12),
    admittedCategoryIds: ["work"], capacityMinutes: 180, priorLoadMinutes: 0,
  };
  const activeShiftsOf = (shifts: ChargeableShift[]) =>
    shifts.map((s) => ({ id: s.id, name: s.name, startMinutes: s.startMinutes, endMinutes: s.endMinutes }));

  it("a block neatly inside one shift says nothing", () => {
    const block: BlockInterval = { startMinutes: H(9, 30), endMinutes: H(10, 30) };
    const charge = chargeBlockAcrossShifts(block, [morning], "work");
    const c = blockConsequence({
      block, charge, taskTitle: "Write the brief", categoryName: "project work",
      activeShifts: activeShiftsOf([morning]), dayLabel: "Thursday",
    });
    expect(c.tabletLines).toEqual([]);
    expect(c.overCapacity).toBeNull();
  });

  it("a block wholly in no shift names the block and its time (Gym case)", () => {
    const block: BlockInterval = { startMinutes: H(19), endMinutes: H(20) };
    const charge = chargeBlockAcrossShifts(block, [], null);
    const c = blockConsequence({
      block, charge, taskTitle: "Gym", categoryName: null,
      activeShifts: [], dayLabel: "Friday",
    });
    expect(c.tabletLines).toEqual(["Gym, 19:00–20:00 Friday, is not inside any shift."]);
    expect(c.overCapacity).toBeNull();
  });

  it("a lunch-gap block says how much is in no shift (case two)", () => {
    const afternoon: ChargeableShift = {
      id: "afternoon", name: "Afternoon", startMinutes: H(13), endMinutes: H(17),
      admittedCategoryIds: ["work"], capacityMinutes: 240, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(11, 30), endMinutes: H(13, 30) };
    const charge = chargeBlockAcrossShifts(block, [morning, afternoon], "work");
    const c = blockConsequence({
      block, charge, taskTitle: "Write the brief", categoryName: "project work",
      activeShifts: activeShiftsOf([morning, afternoon]), dayLabel: "Thursday",
    });
    expect(c.tabletLines).toEqual(["1h of this block is not in any shift."]);
    expect(c.overCapacity).toBeNull();
  });

  it("a block past the last shift says so (case four)", () => {
    const evening: ChargeableShift = {
      id: "evening", name: "Evening", startMinutes: H(19), endMinutes: H(21),
      admittedCategoryIds: [], capacityMinutes: 120, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(20), endMinutes: H(22) };
    const charge = chargeBlockAcrossShifts(block, [evening], null);
    const c = blockConsequence({
      block, charge, taskTitle: "Read", categoryName: null,
      activeShifts: activeShiftsOf([evening]), dayLabel: "Wednesday",
    });
    expect(c.tabletLines).toEqual(["1h of this block is after your last shift ends."]);
  });

  it("a block into a non-admitting shift names it and what it takes (case three)", () => {
    const deep: ChargeableShift = {
      id: "deep", name: "Deep Work", startMinutes: H(9), endMinutes: H(12),
      admittedCategoryIds: ["work"], capacityMinutes: 180, priorLoadMinutes: 0,
    };
    const calls: ChargeableShift = {
      id: "calls", name: "Calls", startMinutes: H(12), endMinutes: H(14),
      admittedCategoryIds: ["calls"], capacityMinutes: 120, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(11), endMinutes: H(13) };
    const charge = chargeBlockAcrossShifts(block, [deep, calls], "work");
    const c = blockConsequence({
      block, charge, taskTitle: "Review the front end", categoryName: "project work",
      activeShifts: activeShiftsOf([deep, calls]), dayLabel: "Monday",
    });
    expect(c.tabletLines).toEqual([
      "This block runs 1h into Calls, which does not take project work.",
    ]);
    expect(c.overCapacity).toBeNull();
  });

  it("a block that puts a shift over capacity raises the popup, not a tablet (case five)", () => {
    const morn: ChargeableShift = {
      id: "morning", name: "Morning", startMinutes: H(9), endMinutes: H(11),
      admittedCategoryIds: ["work"], capacityMinutes: 120, priorLoadMinutes: 0,
    };
    const errands: ChargeableShift = {
      id: "errands", name: "Errands", startMinutes: H(11), endMinutes: H(12),
      admittedCategoryIds: [], capacityMinutes: 60, priorLoadMinutes: 30,
    };
    const afternoon: ChargeableShift = {
      id: "afternoon", name: "Afternoon", startMinutes: H(12), endMinutes: H(17),
      admittedCategoryIds: ["work"], capacityMinutes: 300, priorLoadMinutes: 0,
    };
    const block: BlockInterval = { startMinutes: H(10), endMinutes: H(13) };
    const charge = chargeBlockAcrossShifts(block, [morn, errands, afternoon], "work");
    const c = blockConsequence({
      block, charge, taskTitle: "Big push", categoryName: "project work",
      activeShifts: activeShiftsOf([morn, errands, afternoon]), dayLabel: "Tuesday",
    });
    expect(c.tabletLines).toEqual([]); // the popup replaces the tablet
    expect(c.overCapacity?.shiftName).toBe("Errands");
    expect(c.overCapacity?.line).toContain("over capacity");
  });
});
