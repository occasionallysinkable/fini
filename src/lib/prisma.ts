import { PrismaClient } from "@prisma/client";
import { isInWrite } from "./write-context";

/*
  Two clients, one database.

  - prismaBase: the raw client. Used ONLY by the Auth.js adapter, which must
    write its own session/account/verification rows during sign-in. Nothing
    else imports it.
  - prisma: the guarded client. Every create/update/delete made through it
    that is not inside mutate()'s write context throws. This is invariant 1
    enforced at runtime, not by convention. Reads are always allowed.
*/

const WRITE_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

// Exported so the guard decision can be unit-tested without a database.
export function guardWrite(operation: string, model: string | undefined): void {
  if (WRITE_OPS.has(operation) && !isInWrite()) {
    throw new Error(
      `Direct ${operation} on ${model ?? "a model"} is blocked: every write must go ` +
        `through mutate() so it is logged and reversible (invariant 1).`
    );
  }
}

function makeGuarded(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          guardWrite(operation, model);
          return query(args);
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prismaBase?: PrismaClient;
  prisma?: ReturnType<typeof makeGuarded>;
};

export const prismaBase = globalForPrisma.prismaBase ?? new PrismaClient();

export const prisma = globalForPrisma.prisma ?? makeGuarded(prismaBase);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = prismaBase;
  globalForPrisma.prisma = prisma;
}
