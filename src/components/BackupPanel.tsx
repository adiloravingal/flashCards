"use client";

import { useRef, useState } from "react";
import { api, cx } from "@/lib/client";
import { Button, Icon, Modal, useToast } from "./ui";

interface Analysis {
  stagingId: string;
  filename: string;
  exportedAt: string;
  includesHistory: boolean;
  sizeBytes: number;
  incoming: {
    courses: number;
    chapters: number;
    cards: number;
    mediaFiles: number;
    reviews: number;
  };
  current: { cards: number };
}

type Mode = "replace" | "merge";

const prettySize = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * Move a whole collection between devices.
 *
 * Distinct from deck sharing on purpose: a backup carries scheduling and
 * history, so restoring it makes this device *be* the other one. That is a
 * destructive act, so it's previewed, it states plainly what will happen, and
 * a safety copy is written before anything is removed.
 */
export function BackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [preview, setPreview] = useState<Analysis | null>(null);
  const [mode, setMode] = useState<Mode>("replace");
  const inputRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();

  const exportBackup = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/v1/backup");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        push(payload?.error?.message ?? "Could not build the backup.", "error");
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const name =
        /filename="([^"]+)"/.exec(disposition)?.[1] ?? "flashcards.fcbackup";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = decodeURIComponent(name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      push(`Backup saved · ${prettySize(blob.size)}`, "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  };

  const analyse = async (file: File) => {
    setAnalysing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/backup/analyze", {
        method: "POST",
        body: form,
      });
      const payload = (await res.json()) as
        | { ok: true; data: Analysis }
        | { ok: false; error: { message: string } };
      if (!payload.ok) {
        push(payload.error.message, "error");
        return;
      }
      // Default to merge when this device already has cards: the safe choice
      // should be the one that's pre-selected.
      setMode(payload.data.current.cards > 0 ? "merge" : "replace");
      setPreview(payload.data);
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not read that file", "error");
    } finally {
      setAnalysing(false);
    }
  };

  const restore = async () => {
    if (!preview) return;
    setRestoring(true);
    try {
      const result = await api<{
        inserted: Record<string, number>;
        mediaRestored: number;
        safetyBackup: string | null;
      }>("/backup/restore", {
        method: "POST",
        json: { stagingId: preview.stagingId, mode },
      });
      push(
        `Restored ${result.inserted.cards ?? 0} cards` +
          (result.mediaRestored ? ` and ${result.mediaRestored} files` : ""),
        "success",
      );
      setPreview(null);
      // Everything changed underneath the app — settings, cards, history.
      // Reloading is honest rather than trying to patch state in place.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      push(err instanceof Error ? err.message : "Restore failed", "error");
      setRestoring(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 py-3">
        <Button onClick={exportBackup} loading={exporting}>
          <Icon name="download" className="w-4 h-4" />
          Export everything
        </Button>
        <Button onClick={() => inputRef.current?.click()} loading={analysing}>
          <Icon name="upload" className="w-4 h-4" />
          Restore from a backup
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".fcbackup"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void analyse(f);
          }}
        />
      </div>

      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        A <code className="text-[var(--accent)]">.fcbackup</code> holds every
        card, file, setting and your whole review history. Put it on another
        device and restore it there to carry on exactly where you left off.
        Your API key is deliberately left out, so the file is safe to move
        around.
      </p>

      <Modal
        open={!!preview}
        onClose={() => !restoring && setPreview(null)}
        title="Restore a backup"
        wide
        footer={
          <>
            <Button onClick={() => setPreview(null)} disabled={restoring}>
              Cancel
            </Button>
            <Button
              variant={mode === "replace" ? "danger" : "primary"}
              onClick={restore}
              loading={restoring}
            >
              {mode === "replace" ? "Replace everything" : "Add what's missing"}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium truncate">{preview.filename}</p>
              <p className="text-xs text-[var(--text-faint)] mt-0.5">
                Made {new Date(preview.exportedAt).toLocaleString()} ·{" "}
                {prettySize(preview.sizeBytes)}
                {preview.includesHistory
                  ? " · includes review history"
                  : " · content only"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="In this file" value={preview.incoming.cards} unit="cards" />
              <Stat label="On this device" value={preview.current.cards} unit="cards" />
            </div>
            <p className="text-xs text-[var(--text-faint)]">
              {preview.incoming.courses} courses · {preview.incoming.chapters}{" "}
              chapters · {preview.incoming.mediaFiles} files ·{" "}
              {preview.incoming.reviews.toLocaleString()} reviews
            </p>

            <div className="space-y-2">
              <ModeOption
                selected={mode === "merge"}
                onSelect={() => setMode("merge")}
                title="Add what's missing"
                body="Brings in anything this device doesn't already have. Cards you already study keep their own schedule — nothing here is overwritten."
              />
              <ModeOption
                selected={mode === "replace"}
                onSelect={() => setMode("replace")}
                danger
                title="Replace everything"
                body="This device becomes an exact copy of the backup. Anything here that isn't in the file is removed first — including any progress made since it was taken."
              />
            </div>

            {mode === "replace" && (
              <p className="text-xs text-[var(--hard)] bg-[var(--hard-soft)] rounded-[var(--radius)] px-3 py-2 leading-relaxed anim-fade">
                A copy of the current state is saved into your{" "}
                <code>data/</code> folder first, so this is undoable if you pick
                the wrong file.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="rounded-[var(--radius)] bg-[var(--surface-2)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p className="text-[17px] font-semibold tabular-nums leading-tight mt-0.5">
        {value.toLocaleString()}{" "}
        <span className="text-[12px] font-normal text-[var(--text-muted)]">
          {unit}
        </span>
      </p>
    </div>
  );
}

function ModeOption({
  selected,
  onSelect,
  title,
  body,
  danger,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        "w-full text-left rounded-[var(--radius)] border p-3 transition-colors",
        selected
          ? danger
            ? "border-[var(--again)] bg-[var(--again-soft)]"
            : "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] hover:bg-[var(--surface-2)]",
      )}
    >
      <span className="flex items-start gap-2.5">
        <span
          className={cx(
            "w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 grid place-items-center",
            selected
              ? danger
                ? "border-[var(--again)]"
                : "border-[var(--accent)]"
              : "border-[var(--border)]",
          )}
        >
          {selected && (
            <span
              className={cx(
                "w-2 h-2 rounded-full",
                danger ? "bg-[var(--again)]" : "bg-[var(--accent)]",
              )}
            />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{title}</span>
          <span className="block text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
            {body}
          </span>
        </span>
      </span>
    </button>
  );
}
