"use client";

import { apiFetch } from "@/lib/apiFetch";

import { useState } from "react";
import { Button, Icon, useToast } from "./ui";

/**
 * Downloads a `.fcdeck` for a course or a chapter.
 *
 * Fetched as a blob rather than pointed at with a plain download link: a link
 * would happily "download" a JSON error body as a broken file, and the one
 * moment you need a clear message is when the export didn't work.
 */
export function ExportDeckButton({
  courseId,
  chapterId,
  label = "Export",
  size = "sm",
  variant = "ghost",
}: {
  courseId?: string;
  chapterId?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "primary" | "secondary" | "danger";
}) {
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const run = async () => {
    setBusy(true);
    try {
      const query = chapterId
        ? `chapterId=${encodeURIComponent(chapterId)}`
        : `courseId=${encodeURIComponent(courseId ?? "")}`;
      const res = await apiFetch(`/api/v1/export/deck?${query}`);

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        push(payload?.error?.message ?? "Could not export that.", "error");
        return;
      }

      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "deck.fcdeck";
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = decodeURIComponent(filename);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoke on the next tick so the download has definitely started.
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      push("Deck saved — share the .fcdeck file", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size={size} variant={variant} onClick={run} loading={busy}>
      <Icon name="download" className="w-3.5 h-3.5" />
      {label}
    </Button>
  );
}
