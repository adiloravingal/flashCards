import { fail, handler } from "@/lib/api";
import { backupFilename, buildBackup } from "@/lib/backup";
import { logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/backup[?history=0]
 *
 * A complete `.fcbackup` of this device: every course, chapter, card, media
 * file, setting, and — unless you opt out — your full review history.
 * Restore it on another device and that device becomes this one.
 */
export const GET = handler(async (ctx) => {
  const sp = new URL(ctx.req.url).searchParams;
  const includeHistory = sp.get("history") !== "0";

  let built;
  try {
    built = buildBackup(includeHistory);
  } catch (err) {
    return fail(
      500,
      "backup_failed",
      err instanceof Error ? err.message : "Could not build the backup.",
    );
  }

  const { bytes, meta } = built;
  logEvent({
    actor: ctx.actor,
    action: "backup.export",
    summary:
      `Exported a full backup — ${meta.counts.cards ?? 0} card(s), ` +
      `${meta.counts.mediaFiles ?? 0} file(s)` +
      (includeHistory ? ", with history" : ", without history"),
    meta: meta.counts,
    ip: ctx.ip,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${backupFilename()}"`,
    },
  });
});
