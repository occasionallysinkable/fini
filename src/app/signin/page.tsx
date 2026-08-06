import { signIn } from "@/auth";

// Magic-link sign-in. One field. The allowlist decides whether a link is sent.
export default function SignInPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-2 text-muted">
        Enter the one allowed address. A sign-in link will be emailed to it.
      </p>
      <form
        className="mt-6 flex flex-col gap-3"
        action={async (formData) => {
          "use server";
          await signIn("resend", {
            email: String(formData.get("email") ?? ""),
            redirectTo: "/",
          });
        }}
      >
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          autoFocus
          className="rounded border border-line bg-surface px-3 py-2 text-text outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded border border-line bg-surface px-3 py-2 text-left hover:border-accent"
        >
          Email me a link
        </button>
      </form>
    </main>
  );
}
