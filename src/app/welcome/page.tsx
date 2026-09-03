/*
  WP11 · onboarding (R13). Sign-up asks one question, on one screen: how many
  hours of real work does your day hold. Answering it creates one Day shift and
  the app is usable — nothing else is asked, now or ever (R14). This screen only
  exists while that question is unanswered; once a shift exists it redirects to
  today, so it can never nag.
*/
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOnboardingState } from "@/lib/queries";
import { Welcome } from "./Welcome";

export default async function WelcomePage() {
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

  const { needed } = await getOnboardingState();
  if (!needed) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <Welcome />
    </main>
  );
}
