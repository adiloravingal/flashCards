import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fail, handler, ok } from "@/lib/api";
import { readApkg } from "@/lib/anki";
import { DATA_DIR } from "@/lib/db-node";
import { logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

export const STAGING_DIR = path.join(DATA_DIR, "staging");

/** Drop staged uploads older than an hour — an abandoned preview shouldn't leak. */
function sweepStaging() {
  try {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    const cutoff = Date.now() - 3_600_000;
    for (const name of fs.readdirSync(STAGING_DIR)) {
      const p = path.join(STAGING_DIR, name);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch {
    /* housekeeping only */
  }
}

/**
 * POST /api/v1/import/anki/analyze — multipart `file` (.apkg).
 *
 * Reads the package and reports its decks. The upload is staged on disk and
 * referenced by `stagingId` so the commit step doesn't require re-uploading a
 * file that can easily be hundreds of megabytes.
 */
export const POST = handler(async (ctx) => {
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    return fail(400, "invalid_form", "Send multipart/form-data with a `file` field.");
  }

  const file = form.get("file");
  if (!(file instanceof File))
    return fail(400, "no_file", "No file found under the `file` field.");

  const buffer = Buffer.from(await file.arrayBuffer());

  let pkg;
  try {
    pkg = readApkg(buffer);
  } catch (err) {
    return fail(
      400,
      "parse_failed",
      err instanceof Error ? err.message : "Could not read that .apkg file.",
    );
  }

  if (pkg.totalNotes === 0)
    return fail(400, "empty_package", "That deck has no notes in it.");

  sweepStaging();
  const stagingId = randomUUID();
  fs.writeFileSync(path.join(STAGING_DIR, `${stagingId}.apkg`), buffer);

  logEvent({
    actor: ctx.actor,
    action: "import.anki_analyze",
    summary: `Read “${file.name}” — ${pkg.totalNotes} notes in ${pkg.decks.length} deck(s)`,
    meta: { schema: pkg.schema, decks: pkg.decks.map((d) => d.name) },
    ip: ctx.ip,
  });

  return ok({
    stagingId,
    filename: file.name,
    schema: pkg.schema,
    totalNotes: pkg.totalNotes,
    skipped: pkg.skipped,
    mediaCount: pkg.media.size,
    decks: pkg.decks,
  });
});
