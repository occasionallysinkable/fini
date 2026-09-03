/*
  WP10 · the Settings screen (R19's fifth rail word, wired here for the first
  time). Its home in stage 1 is durability: export your data out and restore it
  back. Later packages hang their settings here too — the shift editor (R13, WP11)
  and the waking-hours / reminder settings (R29) — and the screen is laid out to
  take them.
*/
import Link from "next/link";
import { auth } from "@/auth";
import { getExportStatus } from "@/lib/export-service";
import { LeftRail } from "../Nav";
import { Settings } from "./Settings";

export default async function SettingsPage() {
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

  const status = await getExportStatus();

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <LeftRail />
      <main className="mx-auto w-full max-w-2xl p-6 sm:p-8">
        <h1 className="text-lg font-semibold">Settings</h1>
        <div className="mt-6">
          <Settings status={status} />
        </div>
      </main>
    </div>
  );
}
