import { STAGING_DIR } from "./db-node";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";


/**
 * Two-step imports (preview, then commit) need the uploaded file to survive
 * between requests. Keeping it on disk beats re-uploading a deck that can
 * easily be hundreds of megabytes.
 */

const MAX_AGE_MS = 3_600_000;

/** Drop anything left over from an abandoned preview. */
export function sweepStaging(): void {
  try {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const name of fs.readdirSync(STAGING_DIR)) {
      const p = path.join(STAGING_DIR, name);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch {
    /* housekeeping only — never worth failing an import over */
  }
}

export function stageUpload(buffer: Buffer, extension: string): string {
  sweepStaging();
  const id = randomUUID();
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  fs.writeFileSync(stagedPath(id, extension), buffer);
  return id;
}

export function stagedPath(id: string, extension: string): string {
  // `id` is always a UUID we generated, never user input.
  return path.join(STAGING_DIR, `${id}.${extension}`);
}

export function readStaged(id: string, extension: string): Buffer | null {
  try {
    return fs.readFileSync(stagedPath(id, extension));
  } catch {
    return null;
  }
}

export function discardStaged(id: string, extension: string): void {
  try {
    fs.rmSync(stagedPath(id, extension), { force: true });
  } catch {
    /* the sweeper will get it */
  }
}
