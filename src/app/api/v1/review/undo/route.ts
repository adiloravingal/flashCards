import { fail, handler, ok } from "@/lib/api";
import { undoLastReview } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const POST = handler(async (ctx) => {
  let sessionId: string | undefined;
  try {
    const body = (await ctx.req.json()) as { sessionId?: string };
    sessionId = body?.sessionId;
  } catch {
    /* body is optional — undo the globally-latest review */
  }

  const card = undoLastReview(sessionId, ctx.actor);
  if (!card)
    return fail(404, "nothing_to_undo", "There is no recent answer to undo.");
  return ok(card);
});
