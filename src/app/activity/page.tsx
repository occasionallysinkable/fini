/*
  WP9 · the activity page (R9/R10). One reverse-chronological stream grouped by
  day, six filters across the top with the current one underlined. It reads the
  activity rows the write spine (WP1) has been writing all along — the page is
  the read side of invariant 1, not a feature bolted on. Read-only save for the
  inline undo / restore the stream component adds.
*/
import Link from "next/link";
import { auth } from "@/auth";
import { getActivityFirstPage } from "@/lib/queries";
import { ACTIVITY_FILTERS, resolveFilter } from "@/lib/activity";
import { LeftRail } from "../Nav";
import { ActivityStream } from "./ActivityStream";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-muted">
          <Link href="/signin" className="text-accent underline">
            Sign in
          </Link>{" "}
          to use it.
        </p>
      </main>
    );
  }

  const { filter: filterKey } = await searchParams;
  const filter = resolveFilter(filterKey);
  const first = await getActivityFirstPage(filter.kind);

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <LeftRail />
      <main className="mx-auto w-full max-w-2xl p-6 sm:p-8">
        <h1 className="text-lg font-semibold">Activity</h1>

        {/* The six filters (R10): plain words, the current one underlined. */}
        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {ACTIVITY_FILTERS.map((f) => {
            const active = f.key === filter.key;
            return (
              <Link
                key={f.key}
                href={f.key === "everything" ? "/activity" : `/activity?filter=${f.key}`}
                aria-current={active ? "page" : undefined}
                className={active ? "font-semibold text-text underline" : "text-muted hover:text-text"}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>

        <ActivityStream
          key={filter.key}
          initialLines={first.lines}
          initialCursor={first.nextCursor}
          filterKey={filter.key}
        />
      </main>
    </div>
  );
}
