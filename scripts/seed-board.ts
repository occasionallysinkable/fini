import { PrismaClient } from "@prisma/client";

/*
  Dev-only demo data for eyeballing the WP4 board in the browser. Additive and
  idempotent: every row has a fixed id and is upserted, so re-running neither
  duplicates nor disturbs anything else. Not part of the app; delete freely.
*/

const prisma = new PrismaClient();

const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

async function project(id: string, name: string) {
  await prisma.project.upsert({
    where: { id },
    update: { name },
    create: { id, name },
  });
}

type T = {
  id: string;
  title: string;
  projectId: string | null;
  kind: "commitment" | "own" | "habit" | "unassigned";
  status?: "active" | "done" | "cancelled";
  dueDate?: string | null;
  dueTime?: string | null;
  estimateMinutes?: number | null;
  deferUntil?: string | null;
};

async function task(t: T, position: number) {
  const data = {
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    kind: t.kind,
    status: t.status ?? "active",
    dueDate: t.dueDate ? D(t.dueDate) : null,
    dueTime: t.dueTime ?? null,
    estimateMinutes: t.estimateMinutes ?? null,
    deferUntil: t.deferUntil ? D(t.deferUntil) : null,
    position,
    source: "typed" as const,
  };
  await prisma.task.upsert({ where: { id: t.id }, update: data, create: data });
}

async function note(id: string, body: string) {
  await prisma.note.upsert({ where: { id }, update: { body }, create: { id, body } });
}

async function main() {
  await project("demo-work", "Work");
  await project("demo-home", "Home");
  await project("demo-reno", "Renovation");

  const tasks: T[] = [
    { id: "demo-t01", title: "Send Priya the Q3 figures", projectId: "demo-work", kind: "commitment", dueDate: "2026-08-08", dueTime: "17:00", estimateMinutes: 90 },
    { id: "demo-t02", title: "Invoice backlog", projectId: "demo-work", kind: "own", dueDate: "2026-08-12", estimateMinutes: 120 },
    { id: "demo-t03", title: "Payroll submission", projectId: "demo-work", kind: "commitment", dueDate: "2026-08-07", dueTime: "09:00", estimateMinutes: 30 },
    { id: "demo-t04", title: "Draft the retainer note", projectId: "demo-work", kind: "unassigned", dueDate: "2026-08-20", estimateMinutes: 45 },
    { id: "demo-t05", title: "Review the site plan", projectId: "demo-work", kind: "commitment", estimateMinutes: 60 },
    { id: "demo-t06", title: "Annual report", projectId: "demo-work", kind: "own", dueDate: "2026-09-01", estimateMinutes: 360 },
    { id: "demo-t07", title: "Deep-clean the kitchen", projectId: "demo-home", kind: "own", estimateMinutes: 180 },
    { id: "demo-t08", title: "Book the flu jab", projectId: "demo-home", kind: "unassigned", deferUntil: "2026-10-01" },
    { id: "demo-t09", title: "Renew the domain", projectId: "demo-home", kind: "own", dueDate: "2026-08-15", estimateMinutes: 15 },
    { id: "demo-t10", title: "Water the plants", projectId: "demo-home", kind: "habit" },
    { id: "demo-t11", title: "Choose the bathroom tiles", projectId: "demo-reno", kind: "own", dueDate: "2026-08-10", estimateMinutes: 40 },
    { id: "demo-t12", title: "Get quotes from three plumbers", projectId: "demo-reno", kind: "unassigned", dueDate: "2026-08-25" },
    { id: "demo-t13", title: "Call the bank about the mortgage", projectId: null, kind: "commitment", dueDate: "2026-08-09", dueTime: "10:00", estimateMinutes: 20 },
    { id: "demo-t14", title: "Read the new privacy policy", projectId: null, kind: "unassigned" },
    { id: "demo-t15", title: "File the Q2 taxes", projectId: "demo-work", kind: "own", status: "done", dueDate: "2026-07-31" },
    { id: "demo-t16", title: "Cancel the old subscription", projectId: "demo-home", kind: "own", status: "cancelled" },
  ];
  for (let i = 0; i < tasks.length; i++) await task(tasks[i], i);

  await note("demo-n1", "invoice numbers came from the client on the 3rd");
  await note("demo-n2", "the plumber said tiles must be chosen before the quote");

  process.stdout.write("seeded board demo data\n");
}

main()
  .catch((e) => {
    process.stdout.write("SEED ERROR " + (e as Error).message + "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
