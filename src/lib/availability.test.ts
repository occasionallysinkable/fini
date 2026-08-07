import { describe, it, expect } from "vitest";
import {
  isAvailable,
  firstUnfinishedTaskId,
  type TaskAvailabilityView,
} from "./availability";
import type { TaskStatus } from "@prisma/client";

/*
  Invariant 4's whole logic lives here. Each of the four conditions on
  decisions line 309 gets a case, plus the sequence-order derivation the third
  condition depends on. A silent bug here shows the wrong tasks on today, so
  this guards it.

  "Today" is fixed at 2026-08-07 so the defer-date maths is deterministic.
  A DATE column comes back at UTC midnight, so the fixtures build dates that way.
*/

const TODAY = "2026-08-07";
const date = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

// A fully-available task: no defer date, no project. Each case overrides only
// the field it is testing.
const base: TaskAvailabilityView = {
  deferUntil: null,
  project: null,
  isFirstUnfinishedInSequence: true,
};

describe("isAvailable", () => {
  it("is available with nothing standing in the way", () => {
    expect(isAvailable(base, TODAY)).toBe(true);
  });

  // Condition 1 — defer date.
  it("is unavailable when the defer date is in the future", () => {
    expect(isAvailable({ ...base, deferUntil: date("2026-10-01") }, TODAY)).toBe(false);
  });

  it("is available when the defer date is today", () => {
    // "in the future" is strictly after today; on the day it is back.
    expect(isAvailable({ ...base, deferUntil: date(TODAY) }, TODAY)).toBe(true);
  });

  it("is available when the defer date has passed", () => {
    expect(isAvailable({ ...base, deferUntil: date("2026-08-01") }, TODAY)).toBe(true);
  });

  // Condition 2 — project on hold.
  it("is unavailable when its project is on hold", () => {
    expect(
      isAvailable({ ...base, project: { onHold: true, isSequence: false } }, TODAY)
    ).toBe(false);
  });

  // Condition 3 — sequence position.
  it("is available when it is the first unfinished task of a sequence", () => {
    expect(
      isAvailable(
        { ...base, project: { onHold: false, isSequence: true }, isFirstUnfinishedInSequence: true },
        TODAY
      )
    ).toBe(true);
  });

  it("is unavailable when it is a later step of a sequence", () => {
    expect(
      isAvailable(
        { ...base, project: { onHold: false, isSequence: true }, isFirstUnfinishedInSequence: false },
        TODAY
      )
    ).toBe(false);
  });

  it("ignores sequence position when the project is not a sequence", () => {
    // A non-sequence project never gates on position, even if the flag is false.
    expect(
      isAvailable(
        { ...base, project: { onHold: false, isSequence: false }, isFirstUnfinishedInSequence: false },
        TODAY
      )
    ).toBe(true);
  });

  // Condition 4 — blockers are WP15, so nothing is blocked yet.
  it("does not treat any task as blocked before WP15", () => {
    // There is no input that can make condition 4 fire in this package.
    expect(isAvailable(base, TODAY)).toBe(true);
  });
});

describe("firstUnfinishedTaskId", () => {
  const t = (id: string, status: TaskStatus, deletedAt: Date | null = null) => ({
    id,
    status,
    deletedAt,
  });

  it("returns the earliest active task in the given order", () => {
    const tasks = [t("a", "done"), t("b", "active"), t("c", "active")];
    expect(firstUnfinishedTaskId(tasks)).toBe("b");
  });

  it("skips done, cancelled and someday steps", () => {
    const tasks = [t("a", "done"), t("b", "cancelled"), t("c", "someday"), t("d", "active")];
    expect(firstUnfinishedTaskId(tasks)).toBe("d");
  });

  it("skips deleted tasks even when active", () => {
    const tasks = [t("a", "active", new Date()), t("b", "active")];
    expect(firstUnfinishedTaskId(tasks)).toBe("b");
  });

  it("returns null when every task is finished", () => {
    const tasks = [t("a", "done"), t("b", "cancelled")];
    expect(firstUnfinishedTaskId(tasks)).toBeNull();
  });

  it("returns null for an empty project", () => {
    expect(firstUnfinishedTaskId([])).toBeNull();
  });
});
