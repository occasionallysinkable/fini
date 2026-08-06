import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { prismaBase } from "@/lib/prisma";

/*
  Single-user auth. Email magic link, and an allowlist of exactly one address.
  Nothing about accounts is built; the one row this creates is the app's user.

  The allowlist is one env var, ALLOWED_EMAIL. The signIn callback runs both
  when the link is requested and when it is followed, so a link is never even
  sent to any address other than the one allowed one.
*/

const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The adapter uses the unguarded client: sign-in must write its own
  // session/account/verification rows, which are auth plumbing, not domain
  // mutations. Every domain write still goes through the guarded client.
  adapter: PrismaAdapter(prismaBase),
  // Database sessions — the canonical magic-link setup, and we have the table.
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: "onboarding@resend.dev",
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    // The allowlist of one. No matching address, no sign-in — and no email.
    signIn({ user }) {
      const address = (user?.email ?? "").trim().toLowerCase();
      return allowed.length > 0 && address === allowed;
    },
  },
});
