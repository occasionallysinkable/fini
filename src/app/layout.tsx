import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "fini",
  description: "One thing, large, and why it won.",
  // The manifest makes the app installable, so push reminders (WP7) work from an
  // installed app on Windows and Android. Scope is "/".
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
