import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  Project delete goes through mutate() as one reversible set (invariants 1 & 2):
  the project, its sub-projects and their live tasks are soft-deleted together,
  and a single undo restores exactly that set. This mocks the write path and the
  reads and pins the shape of the write; the live cascade is verified in dev.
*/

const mutateMock = vi.fn(async (input: unknown) => {
  void input;
  return { activity: { id: "act-1" } };
});
const getProjectByIdMock = vi.fn();
const getProjectDeletionSetMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "a@b.c" } }) }));
vi.mock("@/lib/mutate", () => ({ mutate: (i: unknown) => mutateMock(i), undo: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  getTask: vi.fn(),
  getProjectById: (id: string) => getProjectByIdMock(id),
  getProjectDeletionSet: (id: string) => getProjectDeletionSetMock(id),
  nextTaskPosition: vi.fn(),
  buildCaptureContext: vi.fn(),
  resolveProjectPath: vi.fn(),
  resolvePerson: vi.fn(),
}));

import { deleteProject } from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function fakeTx() {
  return {
    project: { updateMany: vi.fn(async () => ({ count: 0 })) },
    task: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
}

type MutateInput = {
  verb: string;
  filterKind: string;
  summary: string;
  undo: { ops: { action: string; model: string; id: string; data: Record<string, unknown> }[] };
  apply: (tx: ReturnType<typeof fakeTx>) => Promise<unknown>;
};

beforeEach(() => {
  mutateMock.mockClear();
  getProjectByIdMock.mockReset();
  getProjectDeletionSetMock.mockReset();
});

describe("deleteProject · one reversible set", () => {
  it("soft-deletes the project, its sub-projects and their tasks, and reverses the whole set", async () => {
    getProjectByIdMock.mockResolvedValue({ id: "p", name: "Renovation", deletedAt: null });
    getProjectDeletionSetMock.mockResolvedValue({ projectIds: ["p", "child"], taskIds: ["t1", "t2"] });

    await deleteProject(form({ id: "p" }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const input = mutateMock.mock.calls[0][0] as MutateInput;
    expect(input.verb).toBe("project.delete");
    expect(input.filterKind).toBe("deletions");
    expect(input.summary).toBe("Deleted “Renovation” and everything in it — 1 sub-project, 2 tasks");

    // Undo restores every row in the set back to not-deleted (invariant 2).
    expect(input.undo.ops).toEqual([
      { action: "update", model: "project", id: "p", data: { deletedAt: null } },
      { action: "update", model: "project", id: "child", data: { deletedAt: null } },
      { action: "update", model: "task", id: "t1", data: { deletedAt: null } },
      { action: "update", model: "task", id: "t2", data: { deletedAt: null } },
    ]);

    // apply() soft-deletes (sets deleted_at), never a hard delete.
    const tx = fakeTx();
    await input.apply(tx);
    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p", "child"] } },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] } },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("names just the project when it has no sub-projects or tasks", async () => {
    getProjectByIdMock.mockResolvedValue({ id: "p", name: "Empty", deletedAt: null });
    getProjectDeletionSetMock.mockResolvedValue({ projectIds: ["p"], taskIds: [] });

    await deleteProject(form({ id: "p" }));

    const input = mutateMock.mock.calls[0][0] as MutateInput;
    expect(input.summary).toBe("Deleted “Empty”");
    expect(input.undo.ops).toEqual([
      { action: "update", model: "project", id: "p", data: { deletedAt: null } },
    ]);
    // No tasks → task.updateMany is not called.
    const tx = fakeTx();
    await input.apply(tx);
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when the project is already deleted", async () => {
    getProjectByIdMock.mockResolvedValue({ id: "p", name: "x", deletedAt: new Date() });
    await deleteProject(form({ id: "p" }));
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
