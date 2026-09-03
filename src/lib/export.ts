/*
  WP10 · durability. The export is "the way out" (brief.md): a single snapshot of
  every domain table, downloadable as JSON and as Markdown, and an importer that
  puts it back. This module is the PURE half — the shape, the Markdown rendering,
  the import validation and the date reviver — so all of it is unit-tested without
  a database. The DB reads/writes live in @/lib/export-service.

  What is in the snapshot: every domain table. What is NOT: the Auth.js plumbing
  (account, session, verification_token). Those hold live session tokens, they are
  not the user's data, and a backup that carries credentials is a backup you cannot
  safely hand anyone. The task schema is what the export is for.
*/

/** Bumped only when the bundle's SHAPE changes in a way an old importer can't read. */
export const EXPORT_VERSION = 1;

/*
  Every domain table, in an order safe to restore in one pass: a row is only
  written after the rows it points at. user/category/person/recurrence_rule have
  no domain FKs; project references itself (restored parents-before-children in
  the service); task references project/category/recurrence_rule; the link and
  detail tables reference task/person; reminder_event references reminder; and
  activity references task/person, so it comes last. Reading uses the same list;
  the order only matters on the way back in.
*/
export const EXPORT_TABLES = [
  "user",
  "category",
  "person",
  "recurrenceRule",
  "project",
  "task",
  "taskPerson",
  "blocker",
  "taskDependency",
  "reminder",
  "reminderEvent",
  "shift",
  "shiftCategory",
  "note",
  "override",
  "planningSession",
  "device",
  "savedView",
  "engagementEvent",
  "activity",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

export type Row = Record<string, unknown>;
export type Tables = Record<ExportTable, Row[]>;

export interface ExportBundle {
  app: "fini";
  version: number;
  exportedAt: string; // ISO instant
  counts: Record<string, number>;
  tables: Tables;
}

/** Package already-read table rows into a bundle, computing the per-table counts
 *  the Markdown and the restore both read. Pure: the caller supplies the rows. */
export function buildExportBundle(tables: Tables, exportedAt: Date = new Date()): ExportBundle {
  const counts: Record<string, number> = {};
  for (const name of EXPORT_TABLES) counts[name] = tables[name]?.length ?? 0;
  return {
    app: "fini",
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    counts,
    tables,
  };
}

/** The total row count across every table — the one number that says "how much
 *  is in here". */
export function totalRows(bundle: ExportBundle): number {
  return Object.values(bundle.counts).reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Markdown rendering. brief.md asks for JSON and Markdown both: the JSON is the
// machine's way back in, the Markdown is the one you can read. It is a summary,
// not a second copy of every column — the counts, then the tasks, projects and
// notes in plain lines, because those are what a person scanning a backup wants
// to confirm is actually in it.
// ---------------------------------------------------------------------------

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function renderMarkdown(bundle: ExportBundle): string {
  const lines: string[] = [];
  lines.push(`# fini export`);
  lines.push("");
  lines.push(`Taken ${bundle.exportedAt} · ${totalRows(bundle)} rows across ${EXPORT_TABLES.length} tables.`);
  lines.push("");

  lines.push(`## What is in here`);
  lines.push("");
  lines.push(`| Table | Rows |`);
  lines.push(`| --- | ---: |`);
  for (const name of EXPORT_TABLES) {
    lines.push(`| ${name} | ${bundle.counts[name] ?? 0} |`);
  }
  lines.push("");

  const projects = bundle.tables.project ?? [];
  if (projects.length) {
    lines.push(`## Projects`);
    lines.push("");
    for (const p of projects) {
      const held = p.onHold ? " · on hold" : "";
      const seq = p.isSequence ? " · sequence" : "";
      const del = p.deletedAt ? " · deleted" : "";
      lines.push(`- ${mdEscape(asString(p.name))}${seq}${held}${del}`);
    }
    lines.push("");
  }

  const tasks = bundle.tables.task ?? [];
  if (tasks.length) {
    lines.push(`## Tasks`);
    lines.push("");
    for (const t of tasks) {
      const bits: string[] = [];
      if (t.status && t.status !== "active") bits.push(String(t.status));
      if (t.dueDate) bits.push(`due ${asString(t.dueDate)}${t.dueTime ? ` ${asString(t.dueTime)}` : ""}`);
      if (t.doDate) bits.push(`do ${asString(t.doDate)}`);
      if (t.deletedAt) bits.push("deleted");
      const tail = bits.length ? ` — ${bits.join(", ")}` : "";
      lines.push(`- ${mdEscape(asString(t.title))}${tail}`);
    }
    lines.push("");
  }

  const notes = bundle.tables.note ?? [];
  if (notes.length) {
    lines.push(`## Notes`);
    lines.push("");
    for (const n of notes) {
      lines.push(`- ${mdEscape(asString(n.body))}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Import validation. Before a single row is written, the file has to look like
// one of ours: the right app tag, a version this build can read, and a tables
// object whose keys are all tables we know. A backup that fails this is refused
// with a sentence, never half-applied.
// ---------------------------------------------------------------------------

export type ValidateResult =
  | { ok: true; bundle: ExportBundle }
  | { ok: false; error: string };

export function validateImport(text: string): ValidateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "The file is not a fini export." };
  }
  const b = parsed as Record<string, unknown>;
  if (b.app !== "fini") {
    return { ok: false, error: "The file is not a fini export (its app tag is missing)." };
  }
  if (typeof b.version !== "number") {
    return { ok: false, error: "The export has no version and cannot be read safely." };
  }
  if (b.version > EXPORT_VERSION) {
    return {
      ok: false,
      error: `This export was written by a newer version (v${b.version}); this build reads up to v${EXPORT_VERSION}.`,
    };
  }
  if (typeof b.tables !== "object" || b.tables === null) {
    return { ok: false, error: "The export has no tables." };
  }
  const tables = b.tables as Record<string, unknown>;
  const known = new Set<string>(EXPORT_TABLES);
  for (const key of Object.keys(tables)) {
    if (!known.has(key)) {
      return { ok: false, error: `The export names an unknown table: ${key}.` };
    }
    if (!Array.isArray(tables[key])) {
      return { ok: false, error: `Table ${key} is not a list of rows.` };
    }
  }
  // Fill any table the export omitted with an empty list, so the restore can
  // walk EXPORT_TABLES without a missing-key check.
  const full = {} as Tables;
  for (const name of EXPORT_TABLES) {
    full[name] = (tables[name] as Row[] | undefined) ?? [];
  }
  return {
    ok: true,
    bundle: {
      app: "fini",
      version: b.version,
      exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : new Date(0).toISOString(),
      counts: (b.counts as Record<string, number>) ?? {},
      tables: full,
    },
  };
}

// ---------------------------------------------------------------------------
// The date reviver. JSON has no date type, so every DateTime came out as an ISO
// string. Prisma wants Date objects back. Only TOP-LEVEL string fields are
// revived — the Json columns (settings, template, undo_payload, keys, filter…)
// are objects and are left exactly as they are, so nothing inside a payload is
// second-guessed.
// ---------------------------------------------------------------------------

// A full ISO-8601 instant, e.g. 2026-09-03T11:24:29.306Z. Deliberately strict:
// a bare "2026-09-03" stays a string (Prisma takes a string for a @db.Date), and
// an ordinary word can never match.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function reviveRowDates(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "string" && ISO_INSTANT.test(value) ? new Date(value) : value;
  }
  return out;
}
