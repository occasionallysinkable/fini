import { prisma } from "./prisma";
import { todayInZone, weekdayOf, type ParseContext, type ShiftWindow } from "./parse";

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

// ---------------------------------------------------------------------------
// Capture (WP2). The parser is pure and needs a little context: today in the
// user's zone (dates are dates — invariant 10), the names that already exist
// (so the echo can say "(new)"), the default-estimate setting, and the shift
// windows the R15 caption checks a due time against.
// ---------------------------------------------------------------------------

function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Build the parser's context from live data. Shifts come from the shift table
 * once WP11 populates it; until then the app runs on the single implicit "Day"
 * shift across the user's waking hours (R13/R14) — read from the user row, not
 * hard-coded (invariant 12).
 */
export async function buildCaptureContext(): Promise<ParseContext> {
  const [user, projects, persons, shifts] = await Promise.all([
    prisma.user.findFirst(),
    prisma.project.findMany({ select: { name: true } }),
    prisma.person.findMany({ select: { name: true } }),
    prisma.shift.findMany(),
  ]);

  const timezone = user?.timezone ?? "UTC";
  const today = todayInZone(timezone);

  const settings = (user?.settings ?? {}) as {
    defaultEstimate?: { enabled?: boolean };
  };

  let shiftWindows: ShiftWindow[] = shifts.flatMap((sh) => {
    const start = hhmmToMinutes(sh.startTime);
    const end = hhmmToMinutes(sh.endTime);
    if (start == null || end == null) return [];
    return [{ name: sh.name, startMinutes: start, endMinutes: end, weekdays: sh.weekdays }];
  });

  // Fall back to the implicit Day shift when none are configured yet: it stands
  // in for shifts so R15 has something to check against (R29). Waking hours
  // default to the whole day (00:00–00:00), and a full-day window keeps R15
  // silent until real shifts exist. The waking-hours setting is edited in
  // Settings — that UI is not WP2; it belongs with the Settings screen (R19),
  // alongside the shift editor R13 puts there.
  if (shiftWindows.length === 0) {
    const start = hhmmToMinutes(user?.wakingStart) ?? 0;
    const end = hhmmToMinutes(user?.wakingEnd) ?? 0;
    shiftWindows = [
      { name: "Day", startMinutes: start, endMinutes: end, weekdays: [true, true, true, true, true, true, true] },
    ];
  }

  return {
    today,
    todayWeekday: weekdayOf(today),
    knownProjects: projects.map((p) => p.name),
    knownPersons: persons.map((p) => p.name),
    defaultEstimateEnabled: settings.defaultEstimate?.enabled ?? true,
    shifts: shiftWindows,
  };
}

/** Resolve a project path to ids, noting which levels need creating. */
export async function resolveProjectPath(path: string[]): Promise<
  { name: string; id: string; existing: boolean; parentId: string | null }[]
> {
  const out: { name: string; id: string; existing: boolean; parentId: string | null }[] = [];
  let parentId: string | null = null;
  for (const name of path) {
    const found: { id: string } | null = await prisma.project.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, parentId },
      select: { id: true },
    });
    if (found) {
      out.push({ name, id: found.id, existing: true, parentId });
      parentId = found.id;
    } else {
      const id = crypto.randomUUID();
      out.push({ name, id, existing: false, parentId });
      parentId = id;
    }
  }
  return out;
}

/** Resolve a person by name, noting whether they need creating. */
export async function resolvePerson(name: string): Promise<{ id: string; existing: boolean }> {
  const found: { id: string } | null = await prisma.person.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (found) return { id: found.id, existing: true };
  return { id: crypto.randomUUID(), existing: false };
}
