"use client";

import { useActionState } from "react";
import { completeOnboarding, type OnboardState } from "../settings/actions";

/*
  The one onboarding question (R13). One field, focused, with a worked example
  already in the label. The answer becomes the Day shift's capacity; on success
  the action redirects to today, so there is no "done" screen — the app is just
  usable. On a bad answer it says one sentence and stays.
*/
export function Welcome() {
  const [state, run] = useActionState<OnboardState, FormData>(completeOnboarding, {});

  return (
    <div>
      <h1 className="text-xl font-semibold">How many hours of real work does your day hold?</h1>
      <p className="mt-2 text-sm text-muted">
        Not the hours you are awake — the hours you actually get things done. A common
        answer is six. You can change it later, and add more shifts, in Settings.
      </p>

      <form action={run} className="mt-6 flex flex-col gap-3">
        <label className="flex items-baseline gap-3">
          <input
            name="hours"
            type="number"
            step="0.5"
            min="0.5"
            max="24"
            defaultValue="6"
            autoFocus
            required
            className="w-24 rounded border border-line bg-transparent px-3 py-2 text-lg"
          />
          <span className="text-sm text-muted">hours</span>
        </label>

        <div>
          <button
            type="submit"
            className="rounded border border-line px-4 py-2 text-sm hover:bg-surface"
          >
            Start
          </button>
        </div>
      </form>

      {state.error && <p className="mt-3 text-sm text-accent">{state.error}</p>}
    </div>
  );
}
