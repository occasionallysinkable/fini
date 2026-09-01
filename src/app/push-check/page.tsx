/*
  WP7 push-proof harness page (temporary).

  Unauthenticated on purpose: the point is to prove the push pipeline in
  isolation on a real iOS home-screen app, without magic-link sign-in — which
  behaves badly inside a standalone PWA — confounding the result. This route and
  its actions are removed once push is proven, replaced by the session-tied
  subscribe flow in the full WP7 build.

  The manifest + appleWebApp metadata make "Add to Home Screen" launch this
  standalone, which is the state iOS requires before it will deliver push.
*/
import type { Metadata } from "next";
import { PushCheck } from "./PushCheck";

export const metadata: Metadata = {
  title: "fini · push check",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "fini", statusBarStyle: "default" },
};

export default function PushCheckPage() {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-lg font-semibold">Push check</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Proving WP7 push delivery before anything is built on top of it.
      </p>
      <PushCheck vapidPublicKey={vapidPublicKey} />
    </main>
  );
}
