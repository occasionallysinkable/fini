import { describe, it, expect } from "vitest";
import { isReviewDue, addDays, type ReviewView } from "./review";

/*
  The review screen shows only what is due (decisions line 312). This is that
  rule. "Today" is fixed so the interval maths is deterministic.
*/

const TODAY = "2026-08-07";
const at = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`);

describe("isReviewDue", () => {
  it("is never due without an interval set", () => {
    const p: ReviewView = { reviewIntervalDays: null, lastReviewedAt: at("2020-01-01") };
    expect(isReviewDue(p, TODAY)).toBe(false);
  });

  it("is due when a cadence is set but it was never reviewed", () => {
    expect(isReviewDue({ reviewIntervalDays: 7, lastReviewedAt: null }, TODAY)).toBe(true);
  });

  it("is not due before the interval has elapsed", () => {
    // Reviewed 2026-08-05, weekly → next due 2026-08-12, after today.
    expect(isReviewDue({ reviewIntervalDays: 7, lastReviewedAt: at("2026-08-05") }, TODAY)).toBe(false);
  });

  it("is due on the day the interval elapses", () => {
    // Reviewed 2026-07-31, weekly → next due 2026-08-07, which is today.
    expect(isReviewDue({ reviewIntervalDays: 7, lastReviewedAt: at("2026-07-31") }, TODAY)).toBe(true);
  });

  it("is due once the interval has passed", () => {
    expect(isReviewDue({ reviewIntervalDays: 7, lastReviewedAt: at("2026-06-01") }, TODAY)).toBe(true);
  });
});

describe("addDays", () => {
  it("adds across a month boundary", () => {
    expect(addDays("2026-07-31", 7)).toBe("2026-08-07");
  });
});
