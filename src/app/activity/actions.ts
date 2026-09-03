"use server";

import { auth } from "@/auth";
import { getActivityStream, type ActivityStreamPage } from "@/lib/queries";
import { resolveFilter } from "@/lib/activity";

/*
  WP9 · the activity page's paging. The stream goes back as far as there is data
  and more loads as you scroll (R10); this server action fetches the next page
  from a cursor. It is a read — the page is read-only save for the inline undo /
  restore, which reuse the write spine's undo() through the shared undoActivity
  action (invariant 1). Nothing is pruned (R10).
*/

export async function loadMoreActivity(
  filterKey: string,
  cursor: string
): Promise<ActivityStreamPage> {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  const filter = resolveFilter(filterKey);
  return getActivityStream(filter.kind, cursor);
}
