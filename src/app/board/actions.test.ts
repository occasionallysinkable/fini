import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  WP4 · the bulk action bar goes through mutate() with a reversible payload
  (invariant 1/2). This mocks the write path and the reads, then asserts that a
  multi-select action builds one activity with a per-task undo — the thing a
  silent bug would break. The DB round-trip itself is verified in the running
  app; here we pin the shape of the write.
*/

const mutateMock = vi.fn(async (_input: unknown) => ({ activity: { id: "act-1" } }));
const getTasksByIdsMock = vi.fn();
const getProjectByIdMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "a@b.c" } }) }));
vi.mock("@/lib/mutate", () => ({ mutate: (input: unknown) => mutateMock(input) }));
vi.mock("@/lib/queries", () => ({
  getTasksByIds: (ids: string[]) => getTasksByIdsMock(ids),
  getProjectById: (id: string) => getProjectByIdMock(id),
  getTask: vi.fn(),
  nextTaskPosition: vi.fn(),
  nextSavedViewPosition: vi.fn(),
}));

import { bulkAction } from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// A fake transaction that records what apply() does to it.
function fakeTx() {
  return {
    task: {
      updateMany: vi.fn(async () => ({ count: 2 })),
      update: vi.fn(async () => ({})),
    },
  };
}

beforeEach(() => {
  mutateMock.mockClear();
  getTasksByIdsMock.mockReset();
  getProjectByIdMock.mockReset();
});

describe("bulkAction · through mutate() with undo", () => {
  it("kill soft-deletes many and reverses each to deletedAt: null", async () => {
    getTasksByIdsMock.mockResolvedValue([
      { id: "t1", kind: "own", kindIsExplicit: false, projectId: null, estimateMinutes: null, pushCount: 0 },
      { id: "t2", kind: "own", kindIsExplicit: false, projectId: null, estimateMinutes: null, pushCount: 0 },
    ]);

    const res = await bulkAction({}, form({ ids: JSON.stringify(["t1", "t2"]), action: "kill" }));

    expect(res.summary).toBe("Killed 2 tasks");
    expect(res.activityId).toBe("act-1");
    expect(mutateMock).toHaveBeenCalledTimes(1);

    const input = mutateMock.mock.calls[0][0] as {
      filterKind: string;
      undo: { ops: { action: string; model: string; id: string; data: Record<string, unknown> }[] };
      apply: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>;
    };
    expect(input.filterKind).toBe("deletions");
    // One reversal op per task, each restoring deletedAt: null (invariant 2).
    expect(input.undo.ops).toEqual([
      { action: "update", model: "task", id: "t1", data: { deletedAt: null } },
      { action: "update", model: "task", id: "t2", data: { deletedAt: null } },
    ]);
    // apply() soft-deletes (sets deletedAt), never a hard delete.
    const tx = fakeTx();
    await input.apply(tx);
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
  });

  it("kind sets an explicit kind and reverses to each prior kind", async () => {
    getTasksByIdsMock.mockResolvedValue([
      { id: "t1", kind: "unassigned", kindIsExplicit: false, projectId: null, estimateMinutes: null, pushCount: 0 },
    ]);

    await bulkAction({}, form({ ids: JSON.stringify(["t1"]), action: "kind", value: "commitment" }));

    const input = mutateMock.mock.calls[0][0] as {
      summary: string;
      undo: { ops: { data: Record<string, unknown> }[] };
      apply: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>;
    };
    expect(input.summary).toBe("Set 1 task to commitment");
    expect(input.undo.ops[0].data).toEqual({ kind: "unassigned", kindIsExplicit: false });
    const tx = fakeTx();
    await input.apply(tx);
    expect(tx.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { kind: "commitment", kindIsExplicit: true } })
    );
  });

  it("push increments each count and reverses to the prior count", async () => {
    getTasksByIdsMock.mockResolvedValue([
      { id: "t1", kind: "own", kindIsExplicit: false, projectId: null, estimateMinutes: null, pushCount: 4 },
    ]);

    await bulkAction({}, form({ ids: JSON.stringify(["t1"]), action: "push" }));

    const input = mutateMock.mock.calls[0][0] as {
      undo: { ops: { data: Record<string, unknown> }[] };
      apply: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>;
    };
    expect(input.undo.ops[0].data).toEqual({ pushCount: 4 });
    const tx = fakeTx();
    await input.apply(tx);
    expect(tx.task.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { pushCount: 5 } });
  });

  it("refuses an empty selection and never writes", async () => {
    const res = await bulkAction({}, form({ ids: "[]", action: "kill" }));
    expect(res.error).toBeTruthy();
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
