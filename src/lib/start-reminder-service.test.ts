import { describe, it, expect } from "vitest";
import { planStartReminder, type ExistingStartReminder } from "./start-reminder-service";

/*
  WP13 · the pure arming/recompute/removal decision, unit-tested hard because this
  is exactly where a silent bug costs a deadline: a commitment that should be
  armed and is not, a start reminder that re-arms after the user deliberately took
  it off, or one that fails to move when the estimate or the zone changes.

  The DB seams (reading the row, the person-wide recompute, the one-pass) are thin
  wrappers over this function and over the DB, verified in the running browser; the
  arithmetic and the branch table are proven here.
*/

const DUE = new Date("2026-09-04T15:00:00.000Z"); // e.g. 17:00 Berlin
const NEW_ID = "new-start-id";

function armed(over: Partial<ExistingStartReminder> = {}): ExistingStartReminder {
  return { id: "sr1", enabled: true, offsetMinutes: 120, nextFireAtUtc: new Date("2026-09-04T13:00:00.000Z"), ...over };
}

describe("planStartReminder — arming a fresh commitment (no row yet)", () => {
  it("arms a commitment with a due date, firing at the safe start", () => {
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: DUE, estimateMinutes: 120, existing: null, newId: NEW_ID,
    });
    expect(plan.create).toEqual({
      id: NEW_ID, taskId: "t1", offsetMinutes: 120, nextFireAtUtc: new Date("2026-09-04T13:00:00.000Z"),
    });
    expect(plan.undo).toEqual([{ action: "deleteRow", model: "reminder", id: NEW_ID }]);
    expect(plan.apply).toEqual([]);
  });

  it("arms a commitment with a due date and NO estimate, firing at the due instant", () => {
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: DUE, estimateMinutes: null, existing: null, newId: NEW_ID,
    });
    expect(plan.create?.nextFireAtUtc).toEqual(DUE);
    expect(plan.create?.offsetMinutes).toBeNull();
  });

  it("does NOT arm an own task, even with a due date", () => {
    const plan = planStartReminder({
      taskId: "t1", kind: "own", dueAtUtc: DUE, estimateMinutes: 120, existing: null, newId: NEW_ID,
    });
    expect(plan).toEqual({ apply: [], undo: [], create: null });
  });

  it("does NOT arm a commitment with no due date", () => {
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: null, estimateMinutes: 120, existing: null, newId: NEW_ID,
    });
    expect(plan.create).toBeNull();
  });
});

describe("planStartReminder — the removal tombstone (on unless you remove it)", () => {
  it("never re-arms a disabled start reminder, whatever the edit", () => {
    const tombstone = armed({ enabled: false, nextFireAtUtc: null });
    // The estimate changed, the due instant is present, the kind is a commitment —
    // everything that would recompute — yet the user removed it, so nothing happens.
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: DUE, estimateMinutes: 30, existing: tombstone, newId: NEW_ID,
    });
    expect(plan).toEqual({ apply: [], undo: [], create: null });
  });
});

describe("planStartReminder — recomputing an enabled row", () => {
  it("moves the fire instant when the estimate changes", () => {
    // Was 2h (fires 13:00); now 30m → fires 14:30. WP12 skipped this recompute for
    // the due instant; WP13 must do it for the safe start.
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: DUE, estimateMinutes: 30, existing: armed(), newId: NEW_ID,
    });
    expect(plan.create).toBeNull();
    expect(plan.apply).toEqual([
      { action: "update", model: "reminder", id: "sr1", data: { offsetMinutes: 30, nextFireAtUtc: new Date("2026-09-04T14:30:00.000Z") } },
    ]);
    expect(plan.undo).toEqual([
      { action: "update", model: "reminder", id: "sr1", data: { offsetMinutes: 120, nextFireAtUtc: new Date("2026-09-04T13:00:00.000Z") } },
    ]);
  });

  it("moves the fire instant when the due instant changes (a zone or due-time move)", () => {
    const laterDue = new Date("2026-09-04T16:00:00.000Z"); // moved an hour later
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: laterDue, estimateMinutes: 120, existing: armed(), newId: NEW_ID,
    });
    // 16:00 − 2h = 14:00.
    expect(plan.apply[0]).toMatchObject({ data: { nextFireAtUtc: new Date("2026-09-04T14:00:00.000Z") } });
  });

  it("does nothing when nothing moved (idempotent recompute — no spurious write)", () => {
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: DUE, estimateMinutes: 120, existing: armed(), newId: NEW_ID,
    });
    expect(plan).toEqual({ apply: [], undo: [], create: null });
  });

  it("suspends (nextFire → null) but stays enabled when the due date is cleared", () => {
    // Not a tombstone — clearing the due date is not the user removing the reminder,
    // so it stays enabled and re-adding a due date re-arms it. It just cannot fire.
    const plan = planStartReminder({
      taskId: "t1", kind: "commitment", dueAtUtc: null, estimateMinutes: 120, existing: armed(), newId: NEW_ID,
    });
    expect(plan.apply).toEqual([
      { action: "update", model: "reminder", id: "sr1", data: { offsetMinutes: 120, nextFireAtUtc: null } },
    ]);
  });
});
