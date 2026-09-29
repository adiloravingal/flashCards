import { IS_DEVICE_BUILD } from "./apiFetch";

/**
 * Hand a generated file to the user.
 *
 * In a browser that means a download. Inside the Android WebView it does not:
 * there is no download manager wired up, so clicking an <a download> on a blob
 * quietly does nothing. On device the bytes are written to app storage and
 * handed to the system share sheet instead, which is also just nicer — you
 * pick "send to a friend" or "save to Drive" directly.
 */
export async function saveFile(
  blob: Blob,
  filename: string,
): Promise<"downloaded" | "shared"> {
  if (IS_DEVICE_BUILD) {
    const shared = await shareOnDevice(blob, filename);
    if (shared) return "shared";
    // Fall through: better a download that might work than no file at all.
  }
  download(blob, filename);
  return "downloaded";
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareOnDevice(blob: Blob, filename: string): Promise<boolean> {
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);

    // Cache, not Documents: these are hand-offs, and the OS can reclaim them.
    const written = await Filesystem.writeFile({
      path: filename,
      data: await toBase64(blob),
      directory: Directory.Cache,
    });

    await Share.share({
      title: filename,
      files: [written.uri],
      dialogTitle: "Send your cards",
    });
    return true;
  } catch (err) {
    // A cancelled share throws too. Treating that as failure would trigger a
    // surprise download, so only a genuinely broken plugin falls back.
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (message.includes("cancel") || message.includes("abort")) return true;
    console.error("[flashcards] share failed, falling back to download", err);
    return false;
  }
}

/** Capacitor's Filesystem takes base64, not bytes. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}
