"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { renderMarkdown, validateImport, type ExportBundle } from "@/lib/export";
import {
  getFullExport,
  recordExportDownload,
  restoreFromExport,
} from "@/lib/export-service";

/*
  WP10 · the Settings screen's write side. Everything the database needs is in
  @/lib/export-service; these actions are the thin seam the client calls. No Prisma
  here — app code reads through queries and the lib layer and writes through the
  vetted functions (the ESLint boundary).
*/

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  return session.user;
}

function stamp(): string {
  // A filename-safe timestamp: 2026-09-03T11-24-29.
  return new Date().toISOString().replace(/:/g, "-").slice(0, 19);
}

export interface DownloadPayload {
  filename: string;
  content: string;
}

/** Build a full JSON export, record that the way-out ran, and hand the bytes back
 *  for the browser to save. */
export async function downloadJson(): Promise<DownloadPayload> {
  await requireUser();
  const bundle = await getFullExport();
  await recordExportDownload("json");
  revalidatePath("/settings");
  return {
    filename: `fini-export-${stamp()}.json`,
    content: JSON.stringify(bundle, null, 2),
  };
}

/** The same snapshot as readable Markdown (brief.md: JSON and Markdown both). */
export async function downloadMarkdown(): Promise<DownloadPayload> {
  await requireUser();
  const bundle = await getFullExport();
  await recordExportDownload("markdown");
  revalidatePath("/settings");
  return {
    filename: `fini-export-${stamp()}.md`,
    content: renderMarkdown(bundle),
  };
}

export interface ImportState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/**
 * Restore from a pasted or uploaded export. The file is validated first (the whole
 * thing is refused with a sentence rather than half-applied), then restored in one
 * transaction. Every screen that reads the database is revalidated, because a
 * restore can change all of them at once.
 */
export async function importFromText(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  await requireUser();
  const text = String(formData.get("bundle") ?? "").trim();
  if (!text) return { error: "Paste an export, or choose a file." };

  const result = validateImport(text);
  if (!result.ok) return { error: result.error };

  const bundle: ExportBundle = result.bundle;
  const { restored } = await restoreFromExport(bundle);

  revalidatePath("/");
  revalidatePath("/board");
  revalidatePath("/projects");
  revalidatePath("/review");
  revalidatePath("/activity");
  revalidatePath("/settings");

  return { ok: true, message: `Restored ${restored} rows from the export.` };
}
