import { fail, handler, ok } from "@/lib/api";
import { readBackup } from "@/lib/backup";
import { logEvent } from "@/lib/log";
import { countCardsInScope } from "@/lib/repo";
import { stageUpload } from "@/lib/staging";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/backup/analyze — multipart `file` (.fcbackup).
 * Reports what's in the file and what you currently have, so the restore
 * screen can show both sides before anything is touched. Writes nothing.
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

  let parsed;
  try {
    parsed = readBackup(buffer);
  } catch (err) {
    return fail(
      400,
      "parse_failed",
      err instanceof Error ? err.message : "Could not read that backup.",
    );
  }

  const stagingId = stageUpload(buffer, "fcbackup");
  const current = countCardsInScope({ kind: "all" });

  logEvent({
    actor: ctx.actor,
    action: "backup.analyze",
    summary: `Read a backup from ${parsed.meta.exportedAt}`,
    meta: parsed.meta.counts,
    ip: ctx.ip,
  });

  return ok({
    stagingId,
    filename: file.name,
    exportedAt: parsed.meta.exportedAt,
    includesHistory: parsed.meta.includesHistory,
    schemaVersion: parsed.meta.schemaVersion,
    sizeBytes: buffer.length,
    incoming: {
      courses: parsed.meta.counts.courses ?? 0,
      chapters: parsed.meta.counts.chapters ?? 0,
      cards: parsed.meta.counts.cards ?? 0,
      mediaFiles: parsed.meta.counts.mediaFiles ?? 0,
      reviews: parsed.meta.counts.review_log ?? 0,
    },
    current: {
      cards: current.total,
    },
  });
});
