import { z } from "zod";
import { fail, handler, ok, parseBody } from "@/lib/api";
import { readBackup, restoreBackup } from "@/lib/backup";
import { logEvent } from "@/lib/log";
import { discardStaged, readStaged } from "@/lib/staging";

export const dynamic = "force-dynamic";

const body = z.object({
  stagingId: z.string().uuid(),
  /**
   * replace — this device becomes the backup, exactly. Everything here now is
   *           removed first (a safety copy is written before that happens).
   * merge   — add what's missing, never touch what's already here.
   */
  mode: z.enum(["replace", "merge"]),
  dryRun: z.boolean().optional().default(false),
});

export const POST = handler(async (ctx) => {
  const parsedBody = await parseBody(ctx.req, body);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;

  const staged = readStaged(input.stagingId, "fcbackup");
  if (!staged) {
    return fail(
      404,
      "staging_expired",
      "That upload is no longer staged. Upload the backup again.",
    );
  }

  let parsed;
  try {
    parsed = readBackup(staged);
  } catch (err) {
    return fail(
      400,
      "parse_failed",
      err instanceof Error ? err.message : "Could not re-read the staged backup.",
    );
  }

  if (input.dryRun) {
    return ok({
      dryRun: true,
      mode: input.mode,
      wouldRestore: parsed.meta.counts,
      wouldReplaceEverything: input.mode === "replace",
    });
  }

  const result = restoreBackup(parsed, input.mode);

  logEvent({
    actor: ctx.actor,
    level: "warn",
    action: "backup.restore",
    summary:
      input.mode === "replace"
        ? `Replaced everything from a backup — ${result.inserted.cards ?? 0} card(s)`
        : `Merged a backup — ${result.inserted.cards ?? 0} new card(s)`,
    meta: result as unknown as Record<string, unknown>,
    ip: ctx.ip,
  });

  discardStaged(input.stagingId, "fcbackup");
  return ok(result);
});
