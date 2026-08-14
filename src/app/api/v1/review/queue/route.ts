import { handler, intParam, ok } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { buildQueue, countCardsInScope, parseScope } from "@/lib/repo";
import { humanInterval, previewIntervals, stateFromRow } from "@/lib/scheduler";
import type { ReviewMode } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/review/queue?courseId=&chapterId=&mode=due|cram|new&limit=
 *
 * Returns the cards to study plus, for each one, what each answer button
 * would schedule. Precomputing that here keeps the review screen instant —
 * no round-trip between flipping a card and seeing the buttons.
 */
export const GET = handler(async (ctx) => {
  const sp = new URL(ctx.req.url).searchParams;
  const scope = parseScope(sp);
  const modeParam = sp.get("mode");
  const mode: ReviewMode =
    modeParam === "cram" || modeParam === "new" ? modeParam : "due";
  const limit = sp.get("limit") ? intParam(sp, "limit", 20, 1, 500) : undefined;

  const settings = getSettings();
  const cards = buildQueue(scope, mode, limit);
  const at = Date.now();

  const withPreview = cards.map((card) => {
    const intervals = previewIntervals(
      stateFromRow(card),
      at,
      settings.targetRetention,
    );
    return {
      ...card,
      preview: {
        1: humanInterval(intervals[1]),
        2: humanInterval(intervals[2]),
        3: humanInterval(intervals[3]),
        4: humanInterval(intervals[4]),
      },
    };
  });

  return ok({
    mode,
    scope,
    counts: countCardsInScope(scope),
    sessionId: `${mode}-${at}-${Math.random().toString(36).slice(2, 8)}`,
    cards: withPreview,
  });
});
