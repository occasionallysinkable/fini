import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { mutate } from "./mutate";
import { inWrite } from "./write-context";
import {
  EXPORT_TABLES,
  buildExportBundle,
  reviveRowDates,
  totalRows,
  type ExportBundle,
  type ExportTable,
  type Row,
  type Tables,
} from "./export";

/*
  WP10 · durability, the database half. The pure shape, Markdown and validation
  live in @/lib/export. Here is what touches Prisma:

    - getFullExport()             reads every domain table into a bundle
    - restoreFromExport(bundle)   puts a bundle back, row by row, in one transaction
    - recordExportDownload()      logs that an export was taken (the "way out" ran)
    - recordWeeklyExportDueIfNeeded() the scheduled weekly nudge (from /api/tick)
    - getExportStatus()           when the last export was, and whether one is due

  The weekly cadence — the seam. brief.md wants a weekly export "written
  automatically". There is no external blob store here (single user, Neon + Vercel),
  and a serverless function has nowhere durable to write a file. So the automatic
  weekly step is a nudge, not a push: once a week the tick records that an export is
  due, the Settings screen surfaces it, and downloading one clears it. The bytes are
  generated on demand and leave in the browser's download — that download is the way
  out. Provisioning a blob store is the later move, and this is where it slots in.
*/

// ---------------------------------------------------------------------------
// Reading every table into a bundle.
// ---------------------------------------------------------------------------

// A minimal shape for the per-table Prisma delegates the export uses. The client
// may be the top-level guarded client (for reads) or a transaction client (for the
// restore), so it is typed structurally rather than to one of them.
type Delegate = {
  findMany: (args?: unknown) => Promise<Row[]>;
  upsert: (args: { where: Record<string, unknown>; create: Row; update: Row }) => Promise<unknown>;
};
type ClientLike = Record<string, unknown>;

/** The delegate for each exported table on a given client, in the same key set as
 *  EXPORT_TABLES. Auth tables are deliberately absent (see @/lib/export). */
function delegates(client: ClientLike): Record<ExportTable, Delegate> {
  const c = client as Record<ExportTable, Delegate>;
  const out = {} as Record<ExportTable, Delegate>;
  for (const name of EXPORT_TABLES) out[name] = c[name];
  return out;
}

/** Read every domain table, whole — including soft-deleted rows, because a backup
 *  that dropped your deleted-but-recoverable work would be a backup that quietly
 *  loses data. */
export async function getFullExport(): Promise<ExportBundle> {
  const d = delegates(prisma as unknown as ClientLike);
  const tables = {} as Tables;
  for (const name of EXPORT_TABLES) {
    tables[name] = await d[name].findMany();
  }
  return buildExportBundle(tables);
}

// ---------------------------------------------------------------------------
// Restoring a bundle. Each row is upserted by its key, so importing into a
// populated database MERGES rather than duplicating, and importing after a wipe
// re-creates. It is additive: rows the export does not mention are left alone,
// never deleted — a restore brings data back, it does not mirror-and-destroy.
// ---------------------------------------------------------------------------

/** Order project rows so a parent is always restored before its children — the
 *  only self-referential FK in the model. Rows with a parent outside the set keep
 *  their place. */
function projectsParentsFirst(rows: Row[]): Row[] {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const out: Row[] = [];
  const seen = new Set<string>();
  const visit = (r: Row) => {
    const id = r.id as string;
    if (seen.has(id)) return;
    const parentId = r.parentId as string | null;
    if (parentId && byId.has(parentId)) visit(byId.get(parentId)!);
    seen.add(id);
    out.push(r);
  };
  for (const r of rows) visit(r);
  return out;
}

/** The unique `where` that identifies a row for upsert. Most tables are `id`;
 *  the three composite-key link tables use their compound unique. */
function whereFor(table: ExportTable, row: Row): Record<string, unknown> {
  switch (table) {
    case "taskPerson":
      return {
        taskId_personId_role: {
          taskId: row.taskId,
          personId: row.personId,
          role: row.role,
        },
      };
    case "shiftCategory":
      return { shiftId_categoryId: { shiftId: row.shiftId, categoryId: row.categoryId } };
    case "taskDependency":
      return {
        taskId_blockedByTaskId: { taskId: row.taskId, blockedByTaskId: row.blockedByTaskId },
      };
    default:
      return { id: row.id };
  }
}

/*
  The Json columns per table. JSON has one null; Prisma has two (a JSON `null`
  value and a SQL NULL), and it refuses a plain `null` on a Json field on write,
  asking which was meant. An export cannot tell them apart — the database returned
  JS null for both — so on the way back in, a null Json column becomes Prisma.DbNull
  (SQL NULL). For undo_payload the distinction is cosmetic (both mean "nothing to
  undo"); for the nullable settings/grouping/sort it is the absence of a value,
  which DbNull is exactly.
*/
const JSON_COLUMNS: Partial<Record<ExportTable, string[]>> = {
  user: ["settings"],
  recurrenceRule: ["template"],
  planningSession: ["droppedTaskIds"],
  activity: ["undoPayload"],
  device: ["keys"],
  savedView: ["filter", "columns", "grouping", "sort"],
};

/** Prepare one row for Prisma: revive its ISO instants to Dates, then turn any
 *  null Json column into Prisma.DbNull so the write is accepted. */
function toPrismaData(table: ExportTable, row: Row): Row {
  const data = reviveRowDates(row);
  for (const col of JSON_COLUMNS[table] ?? []) {
    if (data[col] === null) data[col] = Prisma.DbNull;
  }
  return data;
}

export interface RestoreResult {
  restored: number;
  perTable: Record<string, number>;
}

/**
 * Restore a validated bundle. One transaction, so it is all-or-nothing: a bad row
 * rolls the whole import back rather than leaving a half-restored database. It runs
 * inside inWrite (the write guard's sanctioned path) and logs ONE activity row for
 * the record.
 *
 * The activity row is not a mutate() call and carries no undo payload, and the
 * reason is the same one that keeps a full restore honest: a recovery that rewrote
 * the entire database is not a single reversible edit. The way to reverse a restore
 * is to restore the previous export — not to press undo — so the ledger records
 * that it happened without pretending it unwinds in one step.
 */
export async function restoreFromExport(bundle: ExportBundle): Promise<RestoreResult> {
  const perTable: Record<string, number> = {};
  let restored = 0;

  await inWrite(() =>
    prisma.$transaction(
      async (tx) => {
        // Every write in the restore runs on the transaction client, so a failure
        // anywhere rolls the whole import back.
        const d = delegates(tx as unknown as ClientLike);
        for (const name of EXPORT_TABLES) {
          const raw = bundle.tables[name] ?? [];
          const rows = name === "project" ? projectsParentsFirst(raw) : raw;
          let n = 0;
          for (const r of rows) {
            const data = toPrismaData(name, r);
            await d[name].upsert({ where: whereFor(name, r), create: data, update: data });
            n += 1;
          }
          perTable[name] = n;
          restored += n;
        }

        // The record of the recovery (see the note above): one activity row, no
        // undo, in the same transaction.
        await tx.activity.create({
          data: {
            actor: "app",
            verb: "export.import",
            summary: `Restored from an export · ${restored} rows across ${EXPORT_TABLES.length} tables`,
            undoPayload: Prisma.JsonNull,
            undoExpiresAt: null,
          },
        });
      },
      { timeout: 120_000 }
    )
  );

  return { restored, perTable };
}

// ---------------------------------------------------------------------------
// The download record and the weekly nudge — both read from the activity log, so
// no new column or setting is needed to know when the last export was.
// ---------------------------------------------------------------------------

/** Log that an export was taken. A download changes no domain state, so its undo
 *  payload is empty; the row exists so "when did I last get my data out" has an
 *  answer, and so the weekly nudge can see it. */
export async function recordExportDownload(format: "json" | "markdown"): Promise<void> {
  await mutate({
    actor: { kind: "user" },
    verb: "export.download",
    summary: `Downloaded a full export (${format === "json" ? "JSON" : "Markdown"}).`,
    undo: { ops: [] },
    // The row IS the write — a download changes no domain state, so apply is a
    // no-op and the activity row is the whole point (it is what the weekly nudge
    // reads to know the last export).
    apply: async () => {},
  });
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The scheduled weekly nudge (from /api/tick). If no "export is due" note has been
 * written in the last seven days, write one — actor app, no undo. Idempotent by
 * reading the log, so the every-minute tick records it at most once a week. Returns
 * whether it wrote one this call.
 */
export async function recordWeeklyExportDueIfNeeded(now: Date = new Date()): Promise<boolean> {
  const lastDue = await prisma.activity.findFirst({
    where: { verb: "export.due" },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  if (lastDue && now.getTime() - lastDue.at.getTime() < WEEK_MS) return false;

  await mutate({
    actor: { kind: "app" },
    verb: "export.due",
    summary: "A weekly export is due — download one from Settings to keep your backup current.",
    undo: { ops: [] },
    apply: async () => {},
  });
  return true;
}

export interface ExportStatus {
  lastExportAt: string | null; // ISO, from the last download
  lastDueAt: string | null; // ISO, from the last weekly nudge
  due: boolean; // a nudge is outstanding (newer than the last download)
  daysSinceExport: number | null;
}

/** When the last export ran and whether one is currently due — both derived from
 *  the activity log, so the nudge needs no stored flag. */
export async function getExportStatus(now: Date = new Date()): Promise<ExportStatus> {
  const [lastDownload, lastDue] = await Promise.all([
    prisma.activity.findFirst({
      where: { verb: "export.download" },
      orderBy: { at: "desc" },
      select: { at: true },
    }),
    prisma.activity.findFirst({
      where: { verb: "export.due" },
      orderBy: { at: "desc" },
      select: { at: true },
    }),
  ]);

  const lastExportAt = lastDownload?.at ?? null;
  const lastDueAt = lastDue?.at ?? null;
  // Due when the scheduler has raised a nudge that no download has answered yet.
  const due = !!lastDueAt && (!lastExportAt || lastExportAt.getTime() < lastDueAt.getTime());
  const daysSinceExport = lastExportAt
    ? Math.floor((now.getTime() - lastExportAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    lastExportAt: lastExportAt ? lastExportAt.toISOString() : null,
    lastDueAt: lastDueAt ? lastDueAt.toISOString() : null,
    due,
    daysSinceExport,
  };
}

/** A one-line human summary for the Settings screen and the round-trip script. */
export function describeBundle(bundle: ExportBundle): string {
  return `${totalRows(bundle)} rows · taken ${bundle.exportedAt}`;
}
