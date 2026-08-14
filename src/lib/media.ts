import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MEDIA_DIR, getDb, newId, now } from "./db";
import type { MediaKind, MediaRow } from "./types";

export const MAX_UPLOAD_BYTES =
  Number(process.env.FC_MAX_UPLOAD_MB || 64) * 1024 * 1024;

/**
 * Extension → MIME, used when the uploader doesn't tell us.
 * Browsers set File.type, but agents posting with curl or a bare fetch often
 * don't — and a wrong Content-Type means <img> and <audio> refuse to render.
 */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".opus": "audio/opus",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
};

export function resolveMime(declared: string, filename: string): string {
  const d = (declared || "").toLowerCase().trim();
  if (d && d !== "application/octet-stream" && d !== "binary/octet-stream") {
    return declared;
  }
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function kindFor(mime: string, filename: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";

  // Some browsers send an empty or generic mime; fall back to the extension.
  const ext = path.extname(filename).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"].includes(ext))
    return "image";
  if ([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"].includes(ext))
    return "audio";
  if ([".mp4", ".webm", ".mov", ".mkv", ".m4v"].includes(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  return "file";
}

/** Strip anything that could escape the media directory. */
function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

export interface SaveResult {
  media: MediaRow;
  deduped: boolean;
}

/**
 * Persist an uploaded file. Identical files (same sha256) are stored once and
 * the existing row is reused — importing the same diagram onto 40 cards costs
 * one copy on disk.
 */
export async function saveUpload(file: File): Promise<SaveResult> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is ${(bytes.length / 1048576).toFixed(1)} MB, which exceeds the ${(
        MAX_UPLOAD_BYTES / 1048576
      ).toFixed(0)} MB limit.`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const db = getDb();

  const existing = db
    .prepare("SELECT * FROM media WHERE sha256 = ? LIMIT 1")
    .get(sha256) as MediaRow | undefined;
  if (existing) {
    // Confirm the file is genuinely still on disk before trusting the row.
    try {
      await fs.access(path.join(MEDIA_DIR, existing.filename));
      return { media: existing, deduped: true };
    } catch {
      /* row is stale — fall through and rewrite the bytes */
    }
  }

  const originalName = file.name || "upload";
  const mime = resolveMime(file.type, originalName);
  const kind = kindFor(mime, originalName);
  const id = newId();
  const filename = `${id}${safeExtension(originalName)}`;

  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, filename), bytes);

  const row: MediaRow = {
    id,
    filename,
    original_name: originalName.slice(0, 255),
    mime,
    kind,
    size: bytes.length,
    sha256,
    created_at: now(),
  };

  db.prepare(
    `INSERT INTO media (id, filename, original_name, mime, kind, size, sha256, created_at)
     VALUES (@id, @filename, @original_name, @mime, @kind, @size, @sha256, @created_at)`,
  ).run(row);

  return { media: row, deduped: false };
}

export function getMedia(id: string): MediaRow | undefined {
  return getDb().prepare("SELECT * FROM media WHERE id = ?").get(id) as
    | MediaRow
    | undefined;
}

export function mediaPath(row: MediaRow): string {
  // `filename` is always `<uuid><ext>` that we generated, never user input.
  return path.join(MEDIA_DIR, path.basename(row.filename));
}

/** Delete media rows (and files) that no card references any more. */
export async function collectOrphanedMedia(): Promise<number> {
  const db = getDb();
  const orphans = db
    .prepare(
      `SELECT * FROM media
        WHERE id NOT IN (SELECT media_id FROM card_media)`,
    )
    .all() as MediaRow[];

  let removed = 0;
  for (const m of orphans) {
    try {
      await fs.unlink(mediaPath(m));
    } catch {
      /* already gone */
    }
    db.prepare("DELETE FROM media WHERE id = ?").run(m.id);
    removed++;
  }
  return removed;
}
