import { describe, it, expect } from "vitest";
import {
  tzOffsetMs,
  wallToUtc,
  computeFireTime,
  reminderLabel,
  snoozeMode,
  snoozeByMinutes,
  intervalChoices,
  reminderTag,
  closeTagsForReminders,
  formatFireTime,
  PRESETS,
  SNOOZE_REASONS,
} from "./reminders";

/*
  The reminder arithmetic — fire times, snooze rescheduling, multi-device
  withdrawal — unit-tested on its own, because a silent bug here costs a
  deadline (handoff). Karachi (UTC+5, no DST) is the seeded user's zone; a
  US-Eastern case exercises the DST-transition path the naive offset would miss.
*/

describe("wallToUtc — a wall clock in a zone → the UTC instant", () => {
  it("Karachi is UTC+5 all year (no DST)", () => {
    // 17:00 in Karachi is 12:00 UTC.
    expect(wallToUtc("2026-09-04", "17:00", "Asia/Karachi").toISOString()).toBe(
      "2026-09-04T12:00:00.000Z"
    );
    // Midnight local is 19:00 UTC the previous day.
    expect(wallToUtc("2026-09-04", "00:00", "Asia/Karachi").toISOString()).toBe(
      "2026-09-03T19:00:00.000Z"
    );
  });

  it("handles a DST zone on both sides of the switch", () => {
    // New York in January is EST (UTC-5): noon local → 17:00 UTC.
    expect(wallToUtc("2026-01-15", "12:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T17:00:00.000Z"
    );
    // New York in July is EDT (UTC-4): noon local → 16:00 UTC.
    expect(wallToUtc("2026-07-15", "12:00", "America/New_York").toISOString()).toBe(
      "2026-07-15T16:00:00.000Z"
    );
  });

  it("tzOffsetMs is positive east of UTC", () => {
    expect(tzOffsetMs("Asia/Karachi", new Date("2026-09-04T00:00:00Z"))).toBe(5 * 60 * 60 * 1000);
    expect(tzOffsetMs("UTC", new Date("2026-09-04T00:00:00Z"))).toBe(0);
  });
});

describe("computeFireTime", () => {
  const tz = "Asia/Karachi";

  it("an offset reminder fires N minutes before the due instant", () => {
    // Due 17:00 Karachi (12:00 UTC), 15 minutes before → 11:45 UTC.
    const at = computeFireTime({ dueDate: "2026-09-04", dueTime: "17:00", timeZone: tz, offsetMinutes: 15 });
    expect(at?.toISOString()).toBe("2026-09-04T11:45:00.000Z");
  });

  it("offset 0 fires exactly at the due time", () => {
    const at = computeFireTime({ dueDate: "2026-09-04", dueTime: "17:00", timeZone: tz, offsetMinutes: 0 });
    expect(at?.toISOString()).toBe("2026-09-04T12:00:00.000Z");
  });

  it("a one-day offset lands 24h before", () => {
    const at = computeFireTime({ dueDate: "2026-09-04", dueTime: "17:00", timeZone: tz, offsetMinutes: 24 * 60 });
    expect(at?.toISOString()).toBe("2026-09-03T12:00:00.000Z");
  });

  it("a due date with no time falls back to 00:00 on the date (R25), offset ignored", () => {
    const at = computeFireTime({ dueDate: "2026-09-04", dueTime: null, timeZone: tz, offsetMinutes: 30 });
    // 00:00 Karachi on the 4th → 19:00 UTC on the 3rd.
    expect(at?.toISOString()).toBe("2026-09-03T19:00:00.000Z");
  });

  it("an absolute reminder keeps its own instant regardless of the due time", () => {
    const abs = new Date("2026-09-04T09:30:00.000Z");
    const at = computeFireTime({ dueDate: "2026-09-04", dueTime: "17:00", timeZone: tz, absoluteAt: abs });
    expect(at?.toISOString()).toBe(abs.toISOString());
  });

  it("an offset reminder with no due date at all cannot be placed", () => {
    expect(computeFireTime({ dueDate: null, dueTime: null, timeZone: tz, offsetMinutes: 15 })).toBeNull();
  });
});

describe("reminderLabel", () => {
  it("names offsets, the due time, and absolutes in words", () => {
    expect(reminderLabel({ offsetMinutes: 0, absoluteAt: null })).toBe("At the due time");
    expect(reminderLabel({ offsetMinutes: 15, absoluteAt: null })).toBe("15m before");
    expect(reminderLabel({ offsetMinutes: 120, absoluteAt: null })).toBe("2h before");
    expect(reminderLabel({ offsetMinutes: 24 * 60, absoluteAt: null })).toBe("1 day before");
    expect(reminderLabel({ offsetMinutes: 48 * 60, absoluteAt: null })).toBe("2 days before");
    expect(reminderLabel({ offsetMinutes: null, absoluteAt: new Date() })).toBe("At a set time");
    expect(reminderLabel({ isStartReminder: true, offsetMinutes: 90, absoluteAt: null })).toBe("Start reminder");
  });

  it("the presets match the four the wireframe offers", () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      "1 day before",
      "30 min before",
      "15 min before",
      "at the due time",
    ]);
  });
});

describe("snooze — reasons then intervals", () => {
  it("the first two snoozes ask a reason; the third swaps to intervals", () => {
    expect(snoozeMode(0)).toBe("reasons");
    expect(snoozeMode(1)).toBe("reasons");
    expect(snoozeMode(2)).toBe("intervals");
    expect(snoozeMode(5)).toBe("intervals");
  });

  it("the three reasons are exactly the snooze-reason enum values", () => {
    expect(SNOOZE_REASONS.map((r) => r.id)).toEqual([
      "middle_of_something",
      "wrong_time_of_day",
      "waiting_on_someone",
    ]);
  });

  it("a reason-snooze reschedules by the settings interval", () => {
    const now = new Date("2026-09-04T09:30:00.000Z");
    expect(snoozeByMinutes(now, 15).toISOString()).toBe("2026-09-04T09:45:00.000Z");
    expect(snoozeByMinutes(now, 45).toISOString()).toBe("2026-09-04T10:15:00.000Z");
  });

  it("interval choices are all strictly in the future", () => {
    const now = new Date("2026-09-04T09:30:00.000Z");
    const choices = intervalChoices(now, "Asia/Karachi");
    expect(choices.map((c) => c.id)).toEqual(["30m", "1h", "evening", "morning"]);
    for (const c of choices) expect(c.at.getTime()).toBeGreaterThan(now.getTime());
    // 30m and 1h are relative to now.
    expect(choices[0].at.toISOString()).toBe("2026-09-04T10:00:00.000Z");
    expect(choices[1].at.toISOString()).toBe("2026-09-04T10:30:00.000Z");
  });

  it('"this evening" rolls to the next day once 18:00 has passed', () => {
    // 20:00 Karachi = 15:00 UTC — past this evening's 18:00 local.
    const now = new Date("2026-09-04T15:00:00.000Z");
    const evening = intervalChoices(now, "Asia/Karachi").find((c) => c.id === "evening")!;
    // Next 18:00 Karachi is the 5th → 13:00 UTC.
    expect(evening.at.toISOString()).toBe("2026-09-05T13:00:00.000Z");
  });

  it('"this evening" is today when it is still the afternoon', () => {
    // 10:00 Karachi = 05:00 UTC — before 18:00 local.
    const now = new Date("2026-09-04T05:00:00.000Z");
    const evening = intervalChoices(now, "Asia/Karachi").find((c) => c.id === "evening")!;
    // 18:00 Karachi on the 4th → 13:00 UTC.
    expect(evening.at.toISOString()).toBe("2026-09-04T13:00:00.000Z");
  });
});

describe("multi-device withdrawal", () => {
  it("a reminder's tag is stable and namespaced", () => {
    expect(reminderTag("abc123")).toBe("rem-abc123");
  });

  it("completing a task withdraws every reminder on it", () => {
    expect(closeTagsForReminders(["r1", "r2", "r3"])).toEqual(["rem-r1", "rem-r2", "rem-r3"]);
    expect(closeTagsForReminders([])).toEqual([]);
  });
});

describe("formatFireTime", () => {
  it("formats a fire instant in the user's zone", () => {
    const at = new Date("2026-09-04T11:45:00.000Z"); // 16:45 Karachi
    expect(formatFireTime(at, "Asia/Karachi")).toContain("16:45");
    expect(formatFireTime(null, "Asia/Karachi")).toBe("needs a due date");
  });
});
