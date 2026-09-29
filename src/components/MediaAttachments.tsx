"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { cx } from "@/lib/client";
import { filesFromTransfer, prepareForUpload } from "@/lib/clipboard";
import type { CardMediaRef, MediaKind } from "@/lib/types";
import { Icon, Spinner, useToast } from "./ui";

export interface Attachment {
  id: string;
  side: "front" | "back";
  kind: MediaKind;
  mime: string;
  url: string;
  name: string;
  size: number;
}

export const toAttachments = (media: CardMediaRef[]): Attachment[] =>
  media.map((m) => ({
    id: m.id,
    side: m.side,
    kind: m.kind,
    mime: m.mime,
    url: m.url,
    name: m.original_name,
    size: m.size,
  }));

const ICON_FOR: Record<MediaKind, string> = {
  image: "image",
  audio: "audio",
  video: "video",
  pdf: "file",
  file: "file",
};

const prettySize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * Shared uploader for one side of a card.
 *
 * The current attachment list is read through a ref rather than closed over,
 * because two uploads can be in flight at once — paste a screenshot into the
 * text box while a drag-and-drop is still finishing and a stale closure would
 * quietly drop one of them.
 */
export function useAttachmentUpload({
  attachments,
  onChange,
  side,
}: {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  side: "front" | "back";
}) {
  const [uploading, setUploading] = useState(false);
  const { push } = useToast();

  const latest = useRef(attachments);
  useEffect(() => {
    latest.current = attachments;
  }, [attachments]);

  const upload = useCallback(
    async (files: FileList | File[]): Promise<Attachment[]> => {
      const list = prepareForUpload(Array.from(files));
      if (list.length === 0) return [];

      setUploading(true);
      try {
        const form = new FormData();
        for (const f of list) form.append("file", f);

        const res = await apiFetch("/api/v1/media", { method: "POST", body: form });
        const payload = (await res.json()) as
          | {
              ok: true;
              data: {
                media: (Attachment & { original_name: string; deduped?: boolean })[];
                errors?: { name: string; message: string }[];
              };
            }
          | { ok: false; error: { message: string } };

        if (!payload.ok) {
          push(payload.error.message, "error");
          return [];
        }

        const added: Attachment[] = payload.data.media.map((m) => ({
          id: m.id,
          side,
          kind: m.kind,
          mime: m.mime,
          url: m.url,
          name: m.original_name ?? m.name,
          size: m.size,
        }));

        // Attaching the same file twice to one side is a no-op, not a
        // duplicate chip — the server already de-duplicates by content hash.
        const existing = new Set(
          latest.current.filter((a) => a.side === side).map((a) => a.id),
        );
        const fresh = added.filter((a) => !existing.has(a.id));
        if (fresh.length) onChange([...latest.current, ...fresh]);

        for (const e of payload.data.errors ?? []) {
          push(`${e.name}: ${e.message}`, "error");
        }
        if (fresh.length) {
          push(
            `Attached ${fresh.length} file${fresh.length === 1 ? "" : "s"} to the ${side}`,
            "success",
          );
        } else if (added.length) {
          push("Already attached", "info");
        }
        // Returned so a caller that made the file itself — the mask editor —
        // can go on to do something with the result.
        return fresh;
      } catch (err) {
        push(err instanceof Error ? err.message : "Upload failed", "error");
        return [];
      } finally {
        setUploading(false);
      }
    },
    [onChange, push, side],
  );

  return { upload, uploading };
}

/**
 * Upload + preview strip. Accepts any file type; images, audio and video get
 * an inline preview, everything else becomes a labelled chip.
 */
export function MediaAttachments({
  attachments,
  onChange,
  side,
  compact,
  onEditImage,
  editImageLabel = "Edit",
}: {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  side: "front" | "back";
  compact?: boolean;
  /** Optional action offered on image chips — used for blocking parts out. */
  onEditImage?: (a: Attachment) => void;
  editImageLabel?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useAttachmentUpload({ attachments, onChange, side });

  const mine = attachments.filter((a) => a.side === side);

  // An image the browser can't decode (wrong extension, truncated download)
  // should look like a file, not like a broken page.
  const [undecodable, setUndecodable] = useState<Set<string>>(new Set());
  const markUndecodable = (id: string) =>
    setUndecodable((s) => (s.has(id) ? s : new Set(s).add(id)));

  const remove = (id: string) =>
    onChange(attachments.filter((a) => !(a.id === id && a.side === side)));

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = filesFromTransfer(e.dataTransfer);
        if (files.length) void upload(files);
      }}
      onPaste={(e) => {
        const files = filesFromTransfer(e.clipboardData);
        if (files.length) {
          e.preventDefault();
          void upload(files);
        }
      }}
      className={cx(
        "rounded-[var(--radius)] transition-colors",
        dragging && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]",
      )}
    >
      {mine.length > 0 && (
        <div className={cx("flex flex-wrap gap-2", compact ? "mb-2" : "mb-2.5")}>
          {mine.map((a) => (
            <div
              key={a.id}
              className="relative group rounded-[10px] overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]"
            >
              {a.kind === "image" && !undecodable.has(a.id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.url}
                  alt={a.name}
                  onError={() => markUndecodable(a.id)}
                  className={cx("object-cover", compact ? "h-16 w-16" : "h-24 w-24")}
                />
              ) : a.kind === "audio" ? (
                <div className="p-2 w-52">
                  <audio controls src={a.url} className="w-full h-8" />
                  <p className="text-[10px] text-[var(--text-faint)] truncate mt-1">
                    {a.name}
                  </p>
                </div>
              ) : a.kind === "video" ? (
                <video
                  src={a.url}
                  className={cx("object-cover", compact ? "h-16 w-24" : "h-24 w-36")}
                  muted
                />
              ) : (
                <div className="flex items-center gap-2 px-2.5 py-2 w-[13rem]">
                  <Icon
                    name={ICON_FOR[a.kind]}
                    className="w-4 h-4 shrink-0 text-[var(--text-faint)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs truncate">{a.name}</span>
                    <span className="block text-[10px] text-[var(--text-faint)]">
                      {undecodable.has(a.id)
                        ? "can't preview"
                        : prettySize(a.size)}
                    </span>
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => remove(a.id)}
                aria-label={`Remove ${a.name}`}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/65 text-white grid place-items-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                <Icon name="x" className="w-3 h-3" strokeWidth={2.5} />
              </button>

              {onEditImage && a.kind === "image" && !undecodable.has(a.id) && (
                <button
                  type="button"
                  onClick={() => onEditImage(a)}
                  title={editImageLabel}
                  aria-label={`${editImageLabel} — ${a.name}`}
                  className={cx(
                    "absolute inset-x-0 bottom-0 h-6 bg-black/70 text-white",
                    "text-[10px] font-medium inline-flex items-center justify-center gap-1",
                    // Always legible on touch, where there is no hover to reveal it.
                    "opacity-0 group-hover:opacity-100 focus:opacity-100",
                    "[@media(hover:none)]:opacity-100 transition-opacity",
                  )}
                >
                  <Icon name="edit" className="w-3 h-3" strokeWidth={2.2} />
                  {editImageLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
      >
        {uploading ? <Spinner className="w-3.5 h-3.5" /> : <Icon name="plus" className="w-3.5 h-3.5" />}
        {uploading ? "Uploading…" : "Attach image, audio, video, any file"}
        <span className="text-[var(--text-faint)]">· or drop / paste</span>
      </button>
    </div>
  );
}
