import { describe, it, expect } from "vitest";
import {
  EXPORT_TABLES,
  EXPORT_VERSION,
  buildExportBundle,
  renderMarkdown,
  reviveRowDates,
  totalRows,
  validateImport,
  type Tables,
} from "./export";

/*
  WP10 · the export's pure half. The shape, the Markdown, the import validation and
  the date reviver are all here so a silent bug in "the way out" is caught without a
  database — this is what a restore-from-export depends on being right.
*/

function emptyTables(): Tables {
  const t = {} as Tables;
  for (const name of EXPORT_TABLES) t[name] = [];
  return t;
}

describe("buildExportBundle", () => {
  it("tags the bundle and counts every table", () => {
    const tables = emptyTables();
    tables.task = [{ id: "t1", title: "A" }, { id: "t2", title: "B" }];
    tables.project = [{ id: "p1", name: "Home" }];
    const bundle = buildExportBundle(tables, new Date("2026-09-03T10:00:00.000Z"));

    expect(bundle.app).toBe("fini");
    expect(bundle.version).toBe(EXPORT_VERSION);
    expect(bundle.exportedAt).toBe("2026-09-03T10:00:00.000Z");
    expect(bundle.counts.task).toBe(2);
    expect(bundle.counts.project).toBe(1);
    expect(bundle.counts.note).toBe(0);
    expect(totalRows(bundle)).toBe(3);
  });

  it("excludes the auth tables from the known set", () => {
    // The tables list is the whole surface of the export; auth plumbing must not
    // be in it (session tokens do not belong in a backup).
    expect(EXPORT_TABLES).not.toContain("account" as never);
    expect(EXPORT_TABLES).not.toContain("session" as never);
    expect(EXPORT_TABLES).not.toContain("verificationToken" as never);
  });
});

describe("renderMarkdown", () => {
  it("lists tasks, projects and notes in readable lines", () => {
    const tables = emptyTables();
    tables.project = [{ id: "p1", name: "Renovation", isSequence: true, onHold: false }];
    tables.task = [
      { id: "t1", title: "Call the bank", status: "active", dueDate: "2026-09-04", dueTime: "09:00" },
      { id: "t2", title: "Old thing", status: "done", deletedAt: "2026-08-01T00:00:00.000Z" },
    ];
    tables.note = [{ id: "n1", body: "a standalone thought" }];
    const md = renderMarkdown(buildExportBundle(tables));

    expect(md).toContain("# fini export");
    expect(md).toContain("Renovation");
    expect(md).toContain("sequence");
    expect(md).toContain("Call the bank");
    expect(md).toContain("due 2026-09-04 09:00");
    expect(md).toContain("Old thing");
    expect(md).toContain("a standalone thought");
  });

  it("escapes a pipe so the table stays valid", () => {
    const tables = emptyTables();
    tables.task = [{ id: "t1", title: "a | b", status: "active" }];
    const md = renderMarkdown(buildExportBundle(tables));
    expect(md).toContain("a \\| b");
  });
});

describe("validateImport", () => {
  const good = () =>
    JSON.stringify(buildExportBundle((() => {
      const t = emptyTables();
      t.task = [{ id: "t1", title: "A" }];
      return t;
    })()));

  it("accepts a well-formed export and fills omitted tables", () => {
    const res = validateImport(good());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bundle.tables.task).toHaveLength(1);
      expect(res.bundle.tables.note).toEqual([]);
    }
  });

  it("rejects non-JSON", () => {
    const res = validateImport("not json {");
    expect(res).toEqual({ ok: false, error: expect.stringContaining("valid JSON") });
  });

  it("rejects a file without the fini tag", () => {
    const res = validateImport(JSON.stringify({ version: 1, tables: {} }));
    expect(res.ok).toBe(false);
  });

  it("refuses an export from a newer version", () => {
    const res = validateImport(JSON.stringify({ app: "fini", version: EXPORT_VERSION + 1, tables: {} }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("newer version");
  });

  it("rejects an unknown table name", () => {
    const res = validateImport(
      JSON.stringify({ app: "fini", version: 1, tables: { spaceships: [] } })
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a table that is not a list", () => {
    const res = validateImport(
      JSON.stringify({ app: "fini", version: 1, tables: { task: { id: "t1" } } })
    );
    expect(res.ok).toBe(false);
  });
});

describe("reviveRowDates", () => {
  it("turns a top-level ISO instant into a Date", () => {
    const row = reviveRowDates({ id: "a", createdAt: "2026-09-03T11:24:29.306Z" });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect((row.createdAt as Date).toISOString()).toBe("2026-09-03T11:24:29.306Z");
  });

  it("leaves a bare calendar date as a string (Prisma takes a string for @db.Date)", () => {
    const row = reviveRowDates({ id: "a", dueDate: "2026-09-03" });
    expect(row.dueDate).toBe("2026-09-03");
  });

  it("leaves ordinary strings and Json objects untouched", () => {
    const settings = { defaultReminder: { enabled: true } };
    const row = reviveRowDates({ id: "a", title: "2026 review", settings });
    expect(row.title).toBe("2026 review");
    expect(row.settings).toBe(settings); // not recursed into, not rebuilt
  });

  it("leaves null alone", () => {
    const row = reviveRowDates({ id: "a", completedAt: null });
    expect(row.completedAt).toBeNull();
  });
});
