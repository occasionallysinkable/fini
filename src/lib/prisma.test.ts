import { describe, it, expect } from "vitest";
import { prisma, guardWrite } from "./prisma";
import { inWrite } from "./write-context";

/*
  Proves the runtime enforcement of invariant 1: a create/update/delete on the
  guarded client that is not inside mutate()'s write context throws before it
  ever reaches the database. No DB connection is needed — the guard fires first.
*/

describe("the write guard", () => {
  it("throws on a direct write not made through mutate()", async () => {
    await expect(prisma.person.create({ data: { name: "should not persist" } })).rejects.toThrow(
      /must go through mutate/
    );
  });

  it("never blocks reads", () => {
    expect(() => guardWrite("findMany", "Task")).not.toThrow();
    expect(() => guardWrite("findUnique", "Task")).not.toThrow();
  });

  it("permits writes inside mutate's write context", async () => {
    await inWrite(async () => {
      expect(() => guardWrite("create", "Task")).not.toThrow();
      expect(() => guardWrite("delete", "Task")).not.toThrow();
    });
  });

  it("blocks every write operation outside the context", () => {
    for (const op of ["create", "update", "delete", "upsert", "deleteMany", "updateMany"]) {
      expect(() => guardWrite(op, "Task")).toThrow(/invariant 1/);
    }
  });
});
