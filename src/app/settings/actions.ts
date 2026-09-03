"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { renderMarkdown, validateImport, type ExportBundle } from "@/lib/export";
import {
  getFullExport,
  recordExportDownload,
  restoreFromExport,
} from "@/lib/export-service";
import { mutate } from "@/lib/mutate";
import { getShift, getUserForShiftWrite } from "@/lib/queries";
import { fmtMinutes } from "@/lib/task-page";
import {
  everyWeekday,
  isValidHhmm,
  onboardHoursToMinutes,
  readWakingHours,
  windowMinutes,
} from "@/lib/shifts";

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

// ---------------------------------------------------------------------------
// WP11 · shifts. Onboarding writes the Day shift (R13); Settings adds more. Both
// go through mutate(), so both are logged and both undo — a mis-added shift is
// reversible from the activity page like every other write (invariants 1, 2).
// ---------------------------------------------------------------------------

export interface OnboardState {
  error?: string;
}

/**
 * R13's one sign-up question, answered. The number of hours of real work becomes
 * the Day shift's capacity; the shift's window is the waking window (R29, whole
 * day by default), which keeps the R15 caption silent until a narrower shift
 * exists. The onboarding flag is set in the same write, so the app never asks
 * again (R14) even if the shift is later removed. Then today is usable.
 */
export async function completeOnboarding(
  _prev: OnboardState,
  formData: FormData
): Promise<OnboardState> {
  await requireUser();
  const hours = Number(String(formData.get("hours") ?? "").trim());
  const capacityMinutes = onboardHoursToMinutes(hours);
  if (capacityMinutes == null) {
    return { error: "Enter a number of hours between 0.5 and 24." };
  }

  const user = await getUserForShiftWrite();
  if (!user) return { error: "No account to set up." };

  const waking = readWakingHours({
    wakingStart: user.wakingStart,
    wakingEnd: user.wakingEnd,
  });
  const shiftId = crypto.randomUUID();
  const prevSettings = (user.settings ?? {}) as Record<string, unknown>;
  const nextSettings = { ...prevSettings, onboardedAt: new Date().toISOString() };

  await mutate({
    actor: { kind: "user" },
    verb: "shift.onboard",
    summary: `Set up your day — ${fmtMinutes(capacityMinutes)} of real work, one Day shift`,
    // capacity_from_window is false here: the number came from your answer, not
    // from the window. The Day shift admits every category (no shift_category
    // rows — invariant 12).
    undo: {
      ops: [
        { action: "deleteRow", model: "shift", id: shiftId },
        { action: "update", model: "user", id: user.id, data: { settings: prevSettings } },
      ],
    },
    apply: async (tx) => {
      await tx.shift.create({
        data: {
          id: shiftId,
          name: "Day",
          startTime: waking.start,
          endTime: waking.end,
          weekdays: everyWeekday(),
          capacityMinutes,
          capacityFromWindow: false,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { settings: nextSettings } });
    },
  });

  redirect("/");
}

export interface ShiftFormState {
  ok?: boolean;
  error?: string;
  message?: string;
}

function parseWeekdays(formData: FormData): boolean[] {
  const on = new Set(formData.getAll("weekdays").map((v) => Number(v)));
  return Array.from({ length: 7 }, (_, i) => on.has(i));
}

/**
 * Add a shift from the Settings table (R13). Name, window, days, categories and
 * capacity. Capacity arrives already computed (pre-filled from the window on the
 * client, editable); we record whether it still matches the window in
 * capacity_from_window, so "pre-filled" versus "overridden" is a fact on the row.
 */
export async function addShift(
  _prev: ShiftFormState,
  formData: FormData
): Promise<ShiftFormState> {
  await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const startTime = String(formData.get("startTime") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim();
  const weekdays = parseWeekdays(formData);
  const categoryIds = formData.getAll("categoryIds").map((v) => String(v));
  const capacityHours = Number(String(formData.get("capacityHours") ?? "").trim());

  if (!name) return { error: "Give the shift a name." };
  if (!isValidHhmm(startTime) || !isValidHhmm(endTime)) {
    return { error: "Enter a start and end time as HH:MM." };
  }
  if (!weekdays.some(Boolean)) return { error: "Pick at least one day." };
  if (!Number.isFinite(capacityHours) || capacityHours <= 0 || capacityHours > 24) {
    return { error: "Enter a capacity between 0 and 24 hours." };
  }
  const capacityMinutes = Math.round(capacityHours * 60);
  // The row remembers whether the capacity is still the window's own length.
  const capacityFromWindow = capacityMinutes === windowMinutes(startTime, endTime);

  const shiftId = crypto.randomUUID();

  await mutate({
    actor: { kind: "user" },
    verb: "shift.add",
    summary: `Added the shift "${name}" — ${fmtMinutes(capacityMinutes)} capacity`,
    undo: {
      ops: [
        // Remove the join rows before the shift they point at (FK order).
        { action: "deleteWhere", model: "shiftCategory", where: { shiftId } },
        { action: "deleteRow", model: "shift", id: shiftId },
      ],
    },
    apply: async (tx) => {
      await tx.shift.create({
        data: {
          id: shiftId,
          name,
          startTime,
          endTime,
          weekdays,
          capacityMinutes,
          capacityFromWindow,
        },
      });
      for (const categoryId of categoryIds) {
        await tx.shiftCategory.create({ data: { shiftId, categoryId } });
      }
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: `Added "${name}".` };
}

/**
 * Edit a shift's capacity in place (the number the two-week nudge corrects, R14).
 * Editing capacity by hand means it is no longer the window's own length, so
 * capacity_from_window becomes false.
 */
export async function editShiftCapacity(
  _prev: ShiftFormState,
  formData: FormData
): Promise<ShiftFormState> {
  await requireUser();
  const shiftId = String(formData.get("shiftId") ?? "");
  const capacityHours = Number(String(formData.get("capacityHours") ?? "").trim());
  if (!Number.isFinite(capacityHours) || capacityHours <= 0 || capacityHours > 24) {
    return { error: "Enter a capacity between 0 and 24 hours." };
  }
  const capacityMinutes = Math.round(capacityHours * 60);

  const shift = await getShift(shiftId);
  if (!shift) return { error: "That shift is gone." };
  const capacityFromWindow =
    capacityMinutes === windowMinutes(shift.startTime, shift.endTime);

  await mutate({
    actor: { kind: "user" },
    verb: "shift.capacity",
    summary: `Set "${shift.name}" capacity to ${fmtMinutes(capacityMinutes)}`,
    undo: {
      ops: [
        {
          action: "update",
          model: "shift",
          id: shiftId,
          data: {
            capacityMinutes: shift.capacityMinutes,
            capacityFromWindow: shift.capacityFromWindow,
          },
        },
      ],
    },
    apply: (tx) =>
      tx.shift.update({ where: { id: shiftId }, data: { capacityMinutes, capacityFromWindow } }),
  });

  revalidatePath("/settings");
  return { ok: true, message: `Updated "${shift.name}".` };
}

/**
 * Waking hours (R29). One editable window, default 00:00–00:00 (the whole day),
 * and it may cross midnight. It stands in for shifts where the R15 caption is
 * concerned until real shifts exist, so a full-day window keeps that caption
 * silent.
 */
export async function updateWakingHours(
  _prev: ShiftFormState,
  formData: FormData
): Promise<ShiftFormState> {
  await requireUser();
  const start = String(formData.get("wakingStart") ?? "").trim();
  const end = String(formData.get("wakingEnd") ?? "").trim();
  if (!isValidHhmm(start) || !isValidHhmm(end)) {
    return { error: "Enter waking hours as HH:MM." };
  }
  const user = await getUserForShiftWrite();
  if (!user) return { error: "No account." };

  await mutate({
    actor: { kind: "user" },
    verb: "settings.waking",
    summary: `Waking hours ${start}–${end}`,
    undo: {
      ops: [
        {
          action: "update",
          model: "user",
          id: user.id,
          data: { wakingStart: user.wakingStart, wakingEnd: user.wakingEnd },
        },
      ],
    },
    apply: (tx) =>
      tx.user.update({ where: { id: user.id }, data: { wakingStart: start, wakingEnd: end } }),
  });

  revalidatePath("/settings");
  return { ok: true, message: `Waking hours set to ${start}–${end}.` };
}
