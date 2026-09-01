import { describe, it, expect } from "vitest";
import { planReminders, reminderCreateOps, reminderRescheduleOps } from "./reminder-service";

/*
  The capture-time and reschedule planning, unit-tested. These are the pure
  seams between the arithmetic (reminders.ts) and the Prisma rows: what reminder
  rows a capture creates, and how they move when the due date changes. The push
  send and the database writes are exercised in the browser; this pins the
  decisions those writes are built from.
*/

const tz = "Asia/Karachi"; // UTC+5, no DST

describe("planReminders — what capture persists", () => {
  it("turns a typed offset into a row with its fire instant", () => {
    const rows = planReminders({
      dueDate: "2026-09-05",
      dueTime: "17:00",
      fallbackDate: "2026-09-01",
      timeZone: tz,
      typed: [{ offsetMinutes: 30 }],
      defaultReminder: { enabled: false, offsetMinutes: 15 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].offsetMinutes).toBe(30);
    expect(rows[0].absoluteAt).toBeNull();
    // 30m before 17:00 Karachi (12:00 UTC) → 11:30 UTC.
    expect(rows[0].nextFireAtUtc?.toISOString()).toBe("2026-09-05T11:30:00.000Z");
  });

  it("turns a typed absolute time into an absolute reminder on the due date", () => {
    const rows = planReminders({
      dueDate: "2026-09-05",
      dueTime: null,
      fallbackDate: "2026-09-01",
      timeZone: tz,
      typed: [{ absoluteTime: "09:00" }],
      defaultReminder: { enabled: false, offsetMinutes: 15 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].offsetMinutes).toBeNull();
    // 09:00 Karachi on the due date → 04:00 UTC; absolute stays put.
    expect(rows[0].absoluteAt?.toISOString()).toBe("2026-09-05T04:00:00.000Z");
    expect(rows[0].nextFireAtUtc?.toISOString()).toBe("2026-09-05T04:00:00.000Z");
  });

  it("drops a typed offset with no due date (nothing to fire against)", () => {
    const rows = planReminders({
      dueDate: null,
      dueTime: null,
      fallbackDate: "2026-09-01",
      timeZone: tz,
      typed: [{ offsetMinutes: 15 }],
      defaultReminder: { enabled: false, offsetMinutes: 15 },
    });
    expect(rows).toHaveLength(0);
  });

  it("adds the default reminder when the toggle is on and the user named none", () => {
    const rows = planReminders({
      dueDate: "2026-09-05",
      dueTime: "17:00",
      fallbackDate: "2026-09-01",
      timeZone: tz,
      typed: [],
      defaultReminder: { enabled: true, offsetMinutes: 15 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].offsetMinutes).toBe(15);
  });

  it("does NOT add the default reminder when the user named their own", () => {
    const rows = planReminders({
      dueDate: "2026-09-05",
      dueTime: "17:00",
      fallbackDate: "2026-09-01",
      timeZone: tz,
      typed: [{ offsetMinutes: 30 }],
      defaultReminder: { enabled: true, offsetMinutes: 15 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].offsetMinutes).toBe(30); // the typed one, not the default
  });

  it("adds nothing by default — reminders are opt in", () => {
    const rows = planReminders({
      dueDate: "2026-09-05",
      dueTime: "17:00",
      fallbackDate: "2026-09-01",
      timeZone: tz,
      typed: [],
      defaultReminder: { enabled: false, offsetMinutes: 15 },
    });
    expect(rows).toHaveLength(0);
  });
});

describe("reminderCreateOps — reversal folds into the capture ledger line", () => {
  it("creates one delete-row undo per planned reminder", () => {
    const planned = planReminders({
      dueDate: "2026-09-05",
      dueTime: "17:00",
      fallbackDate: "2026-09-01",
      timeZone: tz,
      typed: [{ offsetMinutes: 30 }, { offsetMinutes: 15 }],
      defaultReminder: { enabled: false, offsetMinutes: 15 },
    });
    const ops = reminderCreateOps("task-1", planned);
    expect(ops.creates).toHaveLength(2);
    expect(ops.creates.every((c) => c.taskId === "task-1")).toBe(true);
    expect(ops.undo).toEqual(planned.map((r) => ({ action: "deleteRow", model: "reminder", id: r.id })));
  });
});

describe("reminderRescheduleOps — moving the due date moves the offsets", () => {
  it("reschedules an offset reminder and leaves an absolute one alone", () => {
    const reminders = [
      { id: "r1", offsetMinutes: 30, absoluteAt: null, nextFireAtUtc: new Date("2026-09-05T11:30:00Z") },
      { id: "r2", offsetMinutes: null, absoluteAt: new Date("2026-09-05T04:00:00Z"), nextFireAtUtc: new Date("2026-09-05T04:00:00Z") },
    ];
    const { apply, undo } = reminderRescheduleOps(reminders, { dueDate: "2026-09-06", dueTime: "17:00" }, tz);
    // Only the offset reminder is touched.
    expect(apply).toHaveLength(1);
    expect(undo).toHaveLength(1);
    const applyOp = apply[0] as unknown as { id: string; data: { nextFireAtUtc: Date } };
    expect(applyOp.id).toBe("r1");
    // 30m before 17:00 on the 6th (12:00 UTC) → 11:30 UTC on the 6th.
    expect(applyOp.data.nextFireAtUtc.toISOString()).toBe("2026-09-06T11:30:00.000Z");
    const undoOp = undo[0] as unknown as { data: { nextFireAtUtc: Date } };
    expect(undoOp.data.nextFireAtUtc.toISOString()).toBe("2026-09-05T11:30:00.000Z");
  });

  it("clears the fire time when the due date is removed", () => {
    const reminders = [
      { id: "r1", offsetMinutes: 30, absoluteAt: null, nextFireAtUtc: new Date("2026-09-05T11:30:00Z") },
    ];
    const { apply } = reminderRescheduleOps(reminders, { dueDate: null, dueTime: null }, tz);
    const applyOp = apply[0] as unknown as { data: { nextFireAtUtc: Date | null } };
    expect(applyOp.data.nextFireAtUtc).toBeNull();
  });
});
