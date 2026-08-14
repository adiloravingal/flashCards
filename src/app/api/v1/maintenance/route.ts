import { fail, handler, ok } from "@/lib/api";
import { getAgentKey, getDb, rotateAgentKey } from "@/lib/db";
import { logEvent, pruneLogs } from "@/lib/log";
import { collectOrphanedMedia } from "@/lib/media";
import { parseScope, resetProgress } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** POST /api/v1/maintenance { action: "..." } — the destructive-ish toolbox. */
export const POST = handler(async (ctx) => {
  let body: { action?: string; days?: number } = {};
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    /* empty body is fine for some actions */
  }

  const sp = new URL(ctx.req.url).searchParams;

  switch (body.action) {
    case "vacuum": {
      getDb().exec("VACUUM");
      logEvent({ actor: ctx.actor, action: "maintenance.vacuum", summary: "Compacted the database" });
      return ok({ done: "vacuum" });
    }

    case "prune-logs": {
      const days = Math.max(1, Math.min(body.days ?? 90, 3650));
      const removed = pruneLogs(days);
      logEvent({
        actor: ctx.actor,
        action: "maintenance.prune_logs",
        summary: `Removed ${removed} log entries older than ${days} days`,
      });
      return ok({ removed });
    }

    case "collect-media": {
      const removed = await collectOrphanedMedia();
      logEvent({
        actor: ctx.actor,
        action: "maintenance.collect_media",
        summary: `Removed ${removed} unused media file(s)`,
      });
      return ok({ removed });
    }

    case "reset-progress": {
      const scope = parseScope(sp);
      const changed = resetProgress(scope, ctx.actor);
      return ok({ reset: changed, scope });
    }

    case "reveal-key": {
      // Deliberately a POST: the key never rides along in a page load or a
      // GET that could end up in browser history.
      logEvent({
        actor: ctx.actor,
        action: "maintenance.reveal_key",
        summary: "Displayed the agent API key",
      });
      return ok({ key: getAgentKey() });
    }

    case "rotate-key": {
      const key = rotateAgentKey();
      logEvent({
        actor: ctx.actor,
        level: "warn",
        action: "maintenance.rotate_key",
        summary: "Rotated the agent API key",
      });
      return ok({ key });
    }

    default:
      return fail(
        400,
        "unknown_action",
        "action must be one of: vacuum, prune-logs, collect-media, reset-progress, rotate-key",
      );
  }
});
