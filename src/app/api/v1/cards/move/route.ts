import { fail, handler, ok, parseBody } from "@/lib/api";
import { moveCards } from "@/lib/repo";
import { cardsMove } from "@/lib/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/cards/move — file a set of cards under a different chapter.
 *
 * One request rather than one per card, so the move is atomic and leaves a
 * single line in the activity log instead of a wall of them.
 */
export const POST = handler(async (ctx) => {
  const body = await parseBody(ctx.req, cardsMove);
  if (!body.ok) return body.response;

  try {
    const { moved, chapter } = moveCards(body.data.ids, body.data.chapterId, ctx.actor);
    return ok({ moved, chapterId: chapter.id, chapterName: chapter.name });
  } catch {
    return fail(404, "not_found", "No chapter with that id.");
  }
});
