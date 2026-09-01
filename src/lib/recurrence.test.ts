import { describe, it, expect } from "vitest";
import {
  nextOccurrence,
  firstOccurrenceOnOrAfter,
  nextOccurrenceOnOrAfter,
  describeRule,
  type RecurrenceSpec,
} from "./recurrence";

/*
  WP8's correctness lives here — the next-occurrence date for every pattern in
  both modes, and the missed-occurrence collapse rule. The arithmetic is the one
  place a silent bug costs a routine, so it gets the unit tests (handoff · Tests).
*/

const NO_DAYS = [false, false, false, false, false, false, false];
function days(...idx: number[]): boolean[] {
  const w = [...NO_DAYS];
  for (const i of idx) w[i] = true;
  return w;
}

function spec(p: Partial<RecurrenceSpec>): RecurrenceSpec {
  return {
    pattern: "daily",
    weekdays: NO_DAYS,
    dayOfMonth: null,
    n: null,
    mode: "fixed",
    ...p,
  };
}

describe("nextOccurrence · the five patterns", () => {
  it("daily is the next day", () => {
    expect(nextOccurrence(spec({ pattern: "daily" }), "2026-09-01")).toBe("2026-09-02");
    // Across a month boundary.
    expect(nextOccurrence(spec({ pattern: "daily" }), "2026-09-30")).toBe("2026-10-01");
  });

  it("weekdays skips the weekend", () => {
    // 2026-09-04 is a Friday → next weekday is Monday the 7th.
    expect(nextOccurrence(spec({ pattern: "weekdays" }), "2026-09-04")).toBe("2026-09-07");
    // Thursday → Friday.
    expect(nextOccurrence(spec({ pattern: "weekdays" }), "2026-09-03")).toBe("2026-09-04");
    // Saturday → Monday.
    expect(nextOccurrence(spec({ pattern: "weekdays" }), "2026-09-05")).toBe("2026-09-07");
  });

  it("weekly lands on the chosen weekday", () => {
    // Every Monday (index 1). From Monday 2026-09-07 → next Monday the 14th.
    const s = spec({ pattern: "weekly", weekdays: days(1) });
    expect(nextOccurrence(s, "2026-09-07")).toBe("2026-09-14");
    // From a Wednesday → the coming Monday.
    expect(nextOccurrence(s, "2026-09-09")).toBe("2026-09-14");
  });

  it("weekly on several days picks the soonest", () => {
    // Tuesdays and Thursdays (2, 4). From Tuesday the 8th → Thursday the 10th.
    const s = spec({ pattern: "weekly", weekdays: days(2, 4) });
    expect(nextOccurrence(s, "2026-09-08")).toBe("2026-09-10");
    // From Thursday the 10th → the next Tuesday, the 15th.
    expect(nextOccurrence(s, "2026-09-10")).toBe("2026-09-15");
  });

  it("weekly with no day chosen is a plain seven days on", () => {
    const s = spec({ pattern: "weekly", weekdays: NO_DAYS });
    expect(nextOccurrence(s, "2026-09-03")).toBe("2026-09-10");
  });

  it("monthly on a date moves to next month's date", () => {
    const s = spec({ pattern: "monthly_date", dayOfMonth: 1 });
    expect(nextOccurrence(s, "2026-09-01")).toBe("2026-10-01");
    // Anchored earlier in the month than the target day → same month.
    expect(nextOccurrence(spec({ pattern: "monthly_date", dayOfMonth: 15 }), "2026-09-01")).toBe(
      "2026-09-15"
    );
  });

  it("monthly on the 31st clamps to short months", () => {
    const s = spec({ pattern: "monthly_date", dayOfMonth: 31 });
    // After Jan 31 → Feb 28 (2026 is not a leap year).
    expect(nextOccurrence(s, "2026-01-31")).toBe("2026-02-28");
    // After Feb 28 → March 31.
    expect(nextOccurrence(s, "2026-02-28")).toBe("2026-03-31");
    // A leap February.
    expect(nextOccurrence(s, "2028-01-31")).toBe("2028-02-29");
  });

  it("every N weeks adds N*7 days", () => {
    expect(nextOccurrence(spec({ pattern: "every_n_weeks", n: 1 }), "2026-09-11")).toBe(
      "2026-09-18"
    );
    expect(nextOccurrence(spec({ pattern: "every_n_weeks", n: 2 }), "2026-09-01")).toBe(
      "2026-09-15"
    );
  });
});

describe("both modes come from the anchor", () => {
  // The plants: every 7 days (every_n_weeks n=1), after completion. Watered on
  // day 11 → next due day 18, never day 14 (decisions · Two meanings).
  it("after_completion counts from the completion date", () => {
    const s = spec({ pattern: "every_n_weeks", n: 1, mode: "after_completion" });
    // The occurrence was scheduled for the 11th but finished late, on the 13th.
    // Fixed would look at the 11th; after-completion looks at the 13th.
    expect(nextOccurrence(s, "2026-09-13")).toBe("2026-09-20");
  });

  it("fixed counts from the scheduled date", () => {
    // Rent on the 1st: paid late on the 5th, still next due the 1st (the caller
    // passes the scheduled date as the anchor, not the completion date).
    const s = spec({ pattern: "monthly_date", dayOfMonth: 1, mode: "fixed" });
    expect(nextOccurrence(s, "2026-09-01")).toBe("2026-10-01");
  });
});

describe("firstOccurrenceOnOrAfter · seeding a new series", () => {
  it("is today when today already fits", () => {
    expect(firstOccurrenceOnOrAfter(spec({ pattern: "daily" }), "2026-09-01")).toBe("2026-09-01");
    // 2026-09-01 is a Tuesday, a weekday.
    expect(firstOccurrenceOnOrAfter(spec({ pattern: "weekdays" }), "2026-09-01")).toBe(
      "2026-09-01"
    );
    // Interval series start the day they are made.
    expect(
      firstOccurrenceOnOrAfter(spec({ pattern: "every_n_weeks", n: 2 }), "2026-09-01")
    ).toBe("2026-09-01");
  });

  it("steps forward when today does not fit", () => {
    // A Saturday for a weekdays rule → the Monday.
    expect(firstOccurrenceOnOrAfter(spec({ pattern: "weekdays" }), "2026-09-05")).toBe(
      "2026-09-07"
    );
    // "every 1st" captured mid-month → the next 1st.
    expect(
      firstOccurrenceOnOrAfter(spec({ pattern: "monthly_date", dayOfMonth: 1 }), "2026-09-15")
    ).toBe("2026-10-01");
    // "every Monday" captured on a Wednesday → the coming Monday.
    expect(
      firstOccurrenceOnOrAfter(spec({ pattern: "weekly", weekdays: days(1) }), "2026-09-09")
    ).toBe("2026-09-14");
  });
});

describe("nextOccurrenceOnOrAfter · missed occurrences collapse, never pile up", () => {
  it("jumps straight to the first still-future date", () => {
    // A daily rule whose occurrence sat on 2026-09-01 while today is the 20th:
    // the next live occurrence is the 20th, not nineteen overdue copies.
    const s = spec({ pattern: "daily" });
    expect(nextOccurrenceOnOrAfter(s, "2026-09-01", "2026-09-20")).toBe("2026-09-20");
  });

  it("a monthly rule skips whole missed months at once", () => {
    // Rent occurrence on 2026-06-01, unpaid; today is 2026-09-10. The next live
    // one is 2026-10-01 — the single next future date, and June/July/Aug are
    // recorded as skipped rather than stacked.
    const s = spec({ pattern: "monthly_date", dayOfMonth: 1 });
    expect(nextOccurrenceOnOrAfter(s, "2026-06-01", "2026-09-10")).toBe("2026-10-01");
  });

  it("returns the immediate next when nothing was actually missed", () => {
    const s = spec({ pattern: "daily" });
    // Occurrence yesterday, today is the 2nd → the next is today.
    expect(nextOccurrenceOnOrAfter(s, "2026-09-01", "2026-09-02")).toBe("2026-09-02");
  });
});

describe("describeRule · the summary prose", () => {
  it("names each pattern and marks the mode", () => {
    expect(describeRule(spec({ pattern: "daily" }))).toBe("every day");
    expect(describeRule(spec({ pattern: "weekdays" }))).toBe("every weekday");
    expect(describeRule(spec({ pattern: "weekly", weekdays: days(1) }))).toBe("every Monday");
    expect(describeRule(spec({ pattern: "monthly_date", dayOfMonth: 1 }))).toBe(
      "on the 1st of each month"
    );
    expect(describeRule(spec({ pattern: "every_n_weeks", n: 2 }))).toBe("every 2 weeks");
    expect(
      describeRule(spec({ pattern: "every_n_weeks", n: 1, mode: "after_completion" }))
    ).toBe("every week, from completion");
  });
});
