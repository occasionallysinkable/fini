import { describe, it, expect } from "vitest";
import {
  governingZone,
  commitmentDueInstant,
  computeTaskDueInstant,
  safeStart,
  startReminderFireAt,
  orderChain,
  type CommitmentPerson,
  type ChainInput,
} from "./clock";

/*
  WP12 · the invariant-11 clock, unit-tested hard because this is where a silent
  bug costs a deadline: a person in another zone, a DST boundary, a due date with
  no time, a task with no estimate, the user's own tasks. Berlin (a DST zone) and
  Asia/Karachi (UTC+5, no DST) are the two other-person zones exercised; the user
  sits in Asia/Karachi like the seeded user.
*/

const USER_ZONE = "Asia/Karachi";

describe("governingZone — invariant 11: a commitment's clock is the other person's", () => {
  it("an asked-by person with a zone governs", () => {
    const people: CommitmentPerson[] = [{ role: "asked_by", timezone: "Europe/Berlin" }];
    expect(governingZone(people, USER_ZONE)).toEqual({ zone: "Europe/Berlin", fromPerson: true });
  });

  it("a delegated-to person with a zone governs when there is no asked-by", () => {
    const people: CommitmentPerson[] = [{ role: "delegated_to", timezone: "America/New_York" }];
    expect(governingZone(people, USER_ZONE)).toEqual({ zone: "America/New_York", fromPerson: true });
  });

  it("asked-by wins over delegated-to when both carry a zone", () => {
    const people: CommitmentPerson[] = [
      { role: "delegated_to", timezone: "America/New_York" },
      { role: "asked_by", timezone: "Europe/Berlin" },
    ];
    expect(governingZone(people, USER_ZONE).zone).toBe("Europe/Berlin");
  });

  it("own tasks (nobody attached) use the user's zone", () => {
    expect(governingZone([], USER_ZONE)).toEqual({ zone: USER_ZONE, fromPerson: false });
  });

  it("a commitment person with NO zone falls back to the user's zone", () => {
    // The app only reads another clock where it knows the facts (decisions 105).
    const people: CommitmentPerson[] = [{ role: "asked_by", timezone: null }];
    expect(governingZone(people, USER_ZONE)).toEqual({ zone: USER_ZONE, fromPerson: false });
  });

  it("waiting-on and assignee roles never pull the clock", () => {
    const people: CommitmentPerson[] = [
      { role: "waiting_on", timezone: "Europe/Berlin" },
      { role: "assignee", timezone: "America/New_York" },
    ];
    expect(governingZone(people, USER_ZONE)).toEqual({ zone: USER_ZONE, fromPerson: false });
  });
});

describe("commitmentDueInstant — a due date/time + zone → the UTC instant", () => {
  it("no due date → no instant, no zone", () => {
    expect(commitmentDueInstant({ dueDate: null, dueTime: "17:00", zone: "Europe/Berlin" })).toEqual({
      dueAtUtc: null,
      dueZone: null,
    });
  });

  it("a due time is read in the governing zone, not the user's", () => {
    // 17:00 in Berlin in September is CEST (UTC+2) → 15:00 UTC. If it were wrongly
    // read in Karachi (UTC+5) it would be 12:00 UTC — this is the whole invariant.
    const r = commitmentDueInstant({ dueDate: "2026-09-04", dueTime: "17:00", zone: "Europe/Berlin" });
    expect(r.dueAtUtc?.toISOString()).toBe("2026-09-04T15:00:00.000Z");
    expect(r.dueZone).toBe("Europe/Berlin");
  });

  it("a due date with NO due time is 00:00 on the date in the zone", () => {
    // Midnight in Berlin (CEST, UTC+2) is 22:00 UTC the previous day.
    const r = commitmentDueInstant({ dueDate: "2026-09-04", dueTime: null, zone: "Europe/Berlin" });
    expect(r.dueAtUtc?.toISOString()).toBe("2026-09-03T22:00:00.000Z");
    expect(r.dueZone).toBe("Europe/Berlin");
  });

  it("freezes the zone that produced it (the history snapshot)", () => {
    const r = commitmentDueInstant({ dueDate: "2026-09-04", dueTime: "09:00", zone: "Asia/Karachi" });
    expect(r.dueZone).toBe("Asia/Karachi");
    // 09:00 Karachi (UTC+5) → 04:00 UTC.
    expect(r.dueAtUtc?.toISOString()).toBe("2026-09-04T04:00:00.000Z");
  });

  it("handles a due time inside a DST spring-forward correctly", () => {
    // US clocks jump 02:00→03:00 on 2026-03-08. A 12:00 due time that day is EDT
    // (UTC-4) → 16:00 UTC; the naive offset (EST, UTC-5) would give 17:00.
    const r = commitmentDueInstant({ dueDate: "2026-03-08", dueTime: "12:00", zone: "America/New_York" });
    expect(r.dueAtUtc?.toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });
});

describe("computeTaskDueInstant — the composed clock (people + user zone)", () => {
  it("a commitment reads in the asked-by person's zone", () => {
    const r = computeTaskDueInstant({
      dueDate: "2026-09-04",
      dueTime: "17:00",
      people: [{ role: "asked_by", timezone: "Europe/Berlin" }],
      userZone: USER_ZONE,
    });
    expect(r.dueAtUtc?.toISOString()).toBe("2026-09-04T15:00:00.000Z");
    expect(r.dueZone).toBe("Europe/Berlin");
  });

  it("an own task reads in the user's zone", () => {
    const r = computeTaskDueInstant({
      dueDate: "2026-09-04",
      dueTime: "17:00",
      people: [],
      userZone: USER_ZONE,
    });
    // 17:00 Karachi (UTC+5) → 12:00 UTC.
    expect(r.dueAtUtc?.toISOString()).toBe("2026-09-04T12:00:00.000Z");
    expect(r.dueZone).toBe(USER_ZONE);
  });

  it("a person's zone change moves the instant (recompute path)", () => {
    const before = computeTaskDueInstant({
      dueDate: "2026-09-04",
      dueTime: "17:00",
      people: [{ role: "asked_by", timezone: "Europe/Berlin" }],
      userZone: USER_ZONE,
    });
    const after = computeTaskDueInstant({
      dueDate: "2026-09-04",
      dueTime: "17:00",
      people: [{ role: "asked_by", timezone: "America/New_York" }],
      userZone: USER_ZONE,
    });
    // 17:00 Berlin = 15:00 UTC; 17:00 New York (EDT) = 21:00 UTC.
    expect(before.dueAtUtc?.toISOString()).toBe("2026-09-04T15:00:00.000Z");
    expect(after.dueAtUtc?.toISOString()).toBe("2026-09-04T21:00:00.000Z");
  });
});

describe("safeStart — due_at_utc − estimate_minutes", () => {
  it("subtracts the estimate from the due instant", () => {
    const due = new Date("2026-09-04T15:00:00.000Z");
    expect(safeStart(due, 90)?.toISOString()).toBe("2026-09-04T13:30:00.000Z");
  });

  it("is null with no estimate", () => {
    expect(safeStart(new Date("2026-09-04T15:00:00.000Z"), null)).toBeNull();
  });

  it("is null with no due instant", () => {
    expect(safeStart(null, 90)).toBeNull();
  });

  it("crosses midnight backwards when the estimate is long", () => {
    // Due 01:00 UTC, needs 3h → safe start is 22:00 UTC the day before.
    const due = new Date("2026-09-04T01:00:00.000Z");
    expect(safeStart(due, 180)?.toISOString()).toBe("2026-09-03T22:00:00.000Z");
  });
});

describe("startReminderFireAt — WP13, the start reminder's fire instant", () => {
  it("is the safe start when there is a due instant and an estimate", () => {
    const due = new Date("2026-09-04T15:00:00.000Z"); // 17:00 Berlin, say
    expect(startReminderFireAt(due, 120)?.toISOString()).toBe("2026-09-04T13:00:00.000Z");
  });

  it("falls back to the due instant itself when there is no estimate", () => {
    // Nothing to work backwards through, so the last honest warning is the
    // deadline. The row is still armed (a commitment with a due date), not dropped.
    const due = new Date("2026-09-04T15:00:00.000Z");
    expect(startReminderFireAt(due, null)?.toISOString()).toBe("2026-09-04T15:00:00.000Z");
  });

  it("is null when there is no due instant (no due date → no start reminder)", () => {
    expect(startReminderFireAt(null, 120)).toBeNull();
    expect(startReminderFireAt(null, null)).toBeNull();
  });

  it("respects the governing zone, because it reads the due instant not a wall time", () => {
    // due_at_utc for 00:00 (no due time) on 2026-09-04 in Asia/Karachi (UTC+5) is
    // 2026-09-03T19:00Z. An untimed commitment with no estimate lands there — the
    // reminders.md "00:00 on the due date" rule, in the person's zone, no special
    // case in this function.
    const untimedKarachi = commitmentDueInstant({ dueDate: "2026-09-04", dueTime: null, zone: "Asia/Karachi" });
    expect(startReminderFireAt(untimedKarachi.dueAtUtc, null)?.toISOString()).toBe(
      "2026-09-03T19:00:00.000Z"
    );
  });
});

describe("orderChain — today's deadlines ordered by safe start", () => {
  it("orders by safe start, not by due instant", () => {
    // B is due later but needs so long its safe start is earliest — it leads.
    const tasks: ChainInput[] = [
      { id: "a", title: "A", dueAtUtc: new Date("2026-09-04T15:00:00Z"), estimateMinutes: 30 },
      { id: "b", title: "B", dueAtUtc: new Date("2026-09-04T18:00:00Z"), estimateMinutes: 300 },
    ];
    expect(orderChain(tasks).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("a task with no estimate falls back to its due instant for ordering", () => {
    const tasks: ChainInput[] = [
      { id: "noest", title: "No estimate", dueAtUtc: new Date("2026-09-04T16:00:00Z"), estimateMinutes: null },
      { id: "est", title: "Estimated", dueAtUtc: new Date("2026-09-04T17:00:00Z"), estimateMinutes: 30 },
    ];
    const chain = orderChain(tasks);
    // noest orders at 16:00 (its due), est orders at 16:30 (17:00 − 30m) → noest first.
    expect(chain.map((t) => t.id)).toEqual(["noest", "est"]);
    expect(chain.find((t) => t.id === "noest")?.safeStart).toBeNull();
  });

  it("breaks ties on title so the order is stable", () => {
    const at = new Date("2026-09-04T15:00:00Z");
    const tasks: ChainInput[] = [
      { id: "z", title: "Zebra", dueAtUtc: at, estimateMinutes: 60 },
      { id: "a", title: "Apple", dueAtUtc: at, estimateMinutes: 60 },
    ];
    expect(orderChain(tasks).map((t) => t.title)).toEqual(["Apple", "Zebra"]);
  });
});
