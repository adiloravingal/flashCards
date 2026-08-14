/**
 * Pulling files out of a paste or a drop.
 *
 * Browsers are inconsistent here: some populate `DataTransfer.files`, some only
 * populate `DataTransfer.items`, and screenshots pasted from the OS often land
 * in one but not the other. Reading both and de-duplicating is the only way to
 * catch every case.
 */

export function filesFromTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];

  const out: File[] = [];
  const seen = new Set<string>();

  const add = (file: File | null | undefined) => {
    if (!file) return;
    // A zero-byte entry is usually a directory or a placeholder, not a file.
    if (file.size === 0) return;
    const key = `${file.name}:${file.size}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };

  for (const f of Array.from(dt.files ?? [])) add(f);

  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file") add(item.getAsFile());
  }

  return out;
}

/** Extension to use when the clipboard gives us bytes but no usable filename. */
const EXT_FOR_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/heic": "heic",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

/**
 * Clipboard images arrive as "image.png" (Chrome) or with no name at all
 * (Safari, Firefox). Left alone, a media library fills up with forty identical
 * "image.png" entries. A timestamped name keeps them tellable apart.
 */
export function nameClipboardFile(file: File, now = new Date()): File {
  const generic = !file.name || /^(image|file)\.\w+$/i.test(file.name);
  if (!generic) return file;

  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    ` ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;

  const ext =
    EXT_FOR_MIME[file.type?.toLowerCase()] ??
    file.name.split(".").pop() ??
    "bin";

  const label = file.type?.startsWith("image/")
    ? "Pasted image"
    : file.type?.startsWith("audio/")
      ? "Pasted audio"
      : file.type?.startsWith("video/")
        ? "Pasted video"
        : "Pasted file";

  return new File([file], `${label} ${stamp}.${ext}`, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
}

/** Does this paste carry text worth letting the browser insert normally? */
export function hasPlainText(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  try {
    return dt.getData("text/plain").trim().length > 0;
  } catch {
    return false;
  }
}

export const prepareForUpload = (files: File[]): File[] =>
  files.map((f) => nameClipboardFile(f));
