/*
  WP14 · the calendar (R8, and the whole calendar section of decisions). Seven
  days from today (not a Mon–Sun week), shift bands, an all-day strip that sets a
  do date, an hour grid that sets a do date and a block, block-overlap charging
  per shift, the tablet for the aware cases and a popup with a queue link for
  over-capacity, and the chain drawn with a magenta edge and the word "deadline".
*/
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCalendarData, getOnboardingState } from "@/lib/queries";
import { clampDayCount, DEFAULT_CALENDAR_DAYS } from "@/lib/calendar";
import { LeftRail } from "../Nav";
import { Calendar } from "./Calendar";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
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

  // The calendar stands on the shifts, so it needs onboarding answered first
  // (R13) — the same gate today uses. It redirects straight back once answered.
  const { needed } = await getOnboardingState();
  if (needed) redirect("/welcome");

  const sp = await searchParams;
  const requested = sp.days ? Number.parseInt(sp.days, 10) : DEFAULT_CALENDAR_DAYS;
  const dayCount = clampDayCount(Number.isFinite(requested) ? requested : DEFAULT_CALENDAR_DAYS);
  const data = await getCalendarData(dayCount);

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <LeftRail />
      <main className="w-full p-4 sm:p-6">
        <Calendar data={data} />
      </main>
    </div>
  );
}
