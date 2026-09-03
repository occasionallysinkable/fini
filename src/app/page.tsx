/*
  WP9 · today (R21). The screen you live on during a shift: one thing, large,
  with its due date read flatly, and the three answers (D/L/N) with every branch
  from R1, R2 and R3. No ranking and no reason sentence — that is stage 3 (WP17),
  and nothing about the three answers changes when it lands.

  This replaces the WP1–WP8 scaffold that used to live here. Capture (WP2) stays
  at the top, because today is where you live and a captured line has to have a
  home; the management lists the scaffold carried moved to the board (WP4) and
  the activity page (this package). The notification-setup line (WP7) stays too.
*/
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getTodayData, getUserSettingsRow, buildCaptureContext, getOnboardingState } from "@/lib/queries";
import { readSidebarWidth } from "@/lib/task-page";
import { LeftRail } from "./Nav";
import { CaptureBox } from "./CaptureBox";
import { Today } from "./Today";
import { NotificationSetup } from "./notifications/NotificationSetup";
import { EngagementBeacon } from "./EngagementBeacon";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-lg font-semibold">fini</h1>
        <p className="mt-2 text-muted">
          <Link href="/signin" className="text-accent underline">
            Sign in
          </Link>{" "}
          to use it.
        </p>
      </main>
    );
  }

  // R13: until the one onboarding question is answered, today has no honest
  // shift to stand on. Send the user to the one-screen question first; it
  // redirects straight back here once answered, and never appears again (R14).
  const { needed } = await getOnboardingState();
  if (needed) redirect("/welcome");

  const [data, userSettings, captureContext] = await Promise.all([
    getTodayData(),
    getUserSettingsRow(),
    buildCaptureContext(),
  ]);
  const sidebarWidth = readSidebarWidth(userSettings?.settings);
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <LeftRail />
      <main className="mx-auto w-full max-w-2xl p-6 sm:p-8">
        <header className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">Today</h1>
          <span className="text-xs text-muted">{data.today}</span>
        </header>

        <section className="mt-4">
          <CaptureBox context={captureContext} />
        </section>

        <section className="mt-6">
          <Today data={data} initialSidebarWidth={sidebarWidth} />
        </section>

        <section className="mt-10">
          <NotificationSetup vapidPublicKey={vapidPublicKey} />
        </section>
        <EngagementBeacon />
      </main>
    </div>
  );
}
