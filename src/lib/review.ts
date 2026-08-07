/*
  Review cadence (decisions line 311–313). A project carries a review interval;
  the app works out when the review comes due so the user never tracks the date.
  The review screen shows only the projects actually due — this pure function is
  what "due" means, kept out of the query so it unit-tests without a database.
*/

/** The project fields the review cadence reads. */
export interface ReviewView {
  /** How often this project is reviewed, in days. Null means no cadence set. */
  reviewIntervalDays: number | null;
  /** When it was last reviewed, or null if never. A timestamp. */
  lastReviewedAt: Date | null;
}

/** "YYYY-MM-DD" plus n whole days, by calendar (invariant 10). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * True when the project is due for review on `today` ("YYYY-MM-DD").
 *
 * A project with no interval is never due — it is not on a cadence. One with a
 * cadence but never reviewed is due now. Otherwise it is due once the interval
 * has elapsed since the last review.
 */
export function isReviewDue(project: ReviewView, today: string): boolean {
  if (project.reviewIntervalDays == null) return false;
  if (project.lastReviewedAt == null) return true;

  const lastYmd = project.lastReviewedAt.toISOString().slice(0, 10);
  const nextDue = addDays(lastYmd, project.reviewIntervalDays);
  return nextDue <= today;
}
