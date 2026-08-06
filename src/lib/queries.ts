import { prisma } from "./prisma";

/*
  The read layer. Components and routes call these instead of importing the
  Prisma client themselves — the ESLint boundary forbids that import in app
  code, so every database touch (read or write) goes through a vetted lib
  module. Writes go through mutate(); reads go through here.
*/

export function getActiveTasks() {
  return prisma.task.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export function getDeletedTasks() {
  return prisma.task.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { modifiedAt: "desc" },
  });
}

export function getRecentActivity() {
  return prisma.activity.findMany({ orderBy: { at: "desc" }, take: 30 });
}

export function getTask(id: string) {
  return prisma.task.findUnique({ where: { id } });
}
