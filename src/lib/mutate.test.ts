import { describe, it, expect } from "vitest";
import { applyUndoOps, type Tx, type UndoOp } from "./mutate";

/*
  Unit test for the reversal dispatch — the core of "undo restores". It runs
  the undo ops against a stub transaction that records the Prisma calls, so we
  can assert each op maps to the right table and the right operation without a
  live database. (The full round-trip against Postgres is exercised by
  `npm run db:roundtrip` once DATABASE_URL points at a real database.)
*/

type Call = { model: string; method: "update" | "delete"; args: unknown };

function stubTx() {
  const calls: Call[] = [];
  const make = (model: string) => ({
    update: (args: unknown) => {
      calls.push({ model, method: "update", args });
      return Promise.resolve({});
    },
    delete: (args: unknown) => {
      calls.push({ model, method: "delete", args });
      return Promise.resolve({});
    },
  });
  const tx = new Proxy({}, { get: (_t, key) => make(String(key)) }) as unknown as Tx;
  return { tx, calls };
}

describe("applyUndoOps", () => {
  it("reverses an update by writing the prior fields back to the same row", async () => {
    const { tx, calls } = stubTx();
    const ops: UndoOp[] = [
      { action: "update", model: "task", id: "t1", data: { title: "old title" } },
    ];
    await applyUndoOps(tx, ops);
    expect(calls).toEqual([
      { model: "task", method: "update", args: { where: { id: "t1" }, data: { title: "old title" } } },
    ]);
  });

  it("reverses a soft-delete by clearing deletedAt", async () => {
    const { tx, calls } = stubTx();
    await applyUndoOps(tx, [
      { action: "update", model: "task", id: "t1", data: { deletedAt: null } },
    ]);
    expect(calls[0]).toEqual({
      model: "task",
      method: "update",
      args: { where: { id: "t1" }, data: { deletedAt: null } },
    });
  });

  it("reverses a create by deleting the row it added", async () => {
    const { tx, calls } = stubTx();
    await applyUndoOps(tx, [{ action: "deleteRow", model: "person", id: "p1" }]);
    expect(calls).toEqual([
      { model: "person", method: "delete", args: { where: { id: "p1" } } },
    ]);
  });

  it("applies multiple ops in order", async () => {
    const { tx, calls } = stubTx();
    await applyUndoOps(tx, [
      { action: "update", model: "task", id: "t1", data: { title: "a" } },
      { action: "deleteRow", model: "note", id: "n1" },
    ]);
    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual(["task.update", "note.delete"]);
  });
});
