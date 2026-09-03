"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import type { ExportStatus } from "@/lib/export-service";
import {
  downloadJson,
  downloadMarkdown,
  importFromText,
  type DownloadPayload,
  type ImportState,
} from "./actions";

/*
  WP10 · Settings, the durability screen. Two things live here: getting your data
  out (JSON and Markdown, the "way out" from brief.md) and putting it back (restore
  from an export). The screen also shows when the last export ran and whether the
  weekly nudge is currently outstanding.

  The shift editor (R13) and the waking-hours / reminder settings (R29) are also
  meant to live in Settings, but they belong to their own packages (WP11 and the
  reminder settings); this screen is durability's home and names the seam.
*/

function saveFile(payload: DownloadPayload, mime: string) {
  const blob = new Blob([payload.content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = payload.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Settings({ status }: { status: ExportStatus }) {
  const [busy, startDownload] = useTransition();
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const doJson = () =>
    startDownload(async () => {
      const payload = await downloadJson();
      saveFile(payload, "application/json");
      setLastSaved(payload.filename);
    });

  const doMarkdown = () =>
    startDownload(async () => {
      const payload = await downloadMarkdown();
      saveFile(payload, "text/markdown");
      setLastSaved(payload.filename);
    });

  const [importState, runImport, importing] = useActionState<ImportState, FormData>(
    importFromText,
    {}
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // A chosen file's text is read into the textarea, so one action handles both
  // paste and upload and the user sees what will be restored before pressing.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (textRef.current) textRef.current.value = text;
  };

  return (
    <div className="flex flex-col gap-10">
      {/* Export — the way out. */}
      <section>
        <h2 className="text-sm font-semibold">Export</h2>
        <p className="mt-1 text-sm text-muted">
          Everything in one file — every task, project, note, reminder and the whole
          activity log. JSON is the copy you restore from; Markdown is the one you can
          read.
        </p>

        <p className="mt-3 text-sm">
          {status.lastExportAt ? (
            <>
              Last export{" "}
              {status.daysSinceExport === 0
                ? "today"
                : `${status.daysSinceExport} day${status.daysSinceExport === 1 ? "" : "s"} ago`}
              .
            </>
          ) : (
            <>No export taken yet.</>
          )}
          {status.due && (
            <span className="ml-1 text-accent">A weekly export is due.</span>
          )}
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={doJson}
            disabled={busy}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-40"
          >
            {busy ? "preparing…" : "Download JSON"}
          </button>
          <button
            type="button"
            onClick={doMarkdown}
            disabled={busy}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-40"
          >
            Download Markdown
          </button>
        </div>
        {lastSaved && <p className="mt-2 text-xs text-muted">Saved {lastSaved}.</p>}
      </section>

      {/* Import — the way back in. */}
      <section>
        <h2 className="text-sm font-semibold">Restore from an export</h2>
        <p className="mt-1 text-sm text-muted">
          Paste a JSON export or choose the file. Rows are matched by their id and put
          back; nothing already here is deleted. It is one all-or-nothing restore.
        </p>

        <form action={runImport} className="mt-3 flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onFile}
            className="text-sm"
          />
          <textarea
            ref={textRef}
            name="bundle"
            rows={6}
            placeholder="…or paste the JSON here"
            className="w-full rounded border border-line bg-transparent p-2 font-mono text-xs"
          />
          <div>
            <button
              type="submit"
              disabled={importing}
              className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-40"
            >
              {importing ? "restoring…" : "Restore"}
            </button>
          </div>
        </form>

        {importState.error && (
          <p className="mt-2 text-sm text-accent">{importState.error}</p>
        )}
        {importState.ok && importState.message && (
          <p className="mt-2 text-sm text-muted">{importState.message}</p>
        )}
      </section>
    </div>
  );
}
