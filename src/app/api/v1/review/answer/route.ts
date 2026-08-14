import { fail, handler, ok, parseBody } from "@/lib/api";
import { answerCard } from "@/lib/repo";
import { humanInterval } from "@/lib/scheduler";
import { answerBody } from "@/lib/validators";

export const dynamic = "force-dynamic";

export const POST = handler(async (ctx) => {
  const body = await parseBody(ctx.req, answerBody);
  if (!body.ok) return body.response;

  const { cardId, rating, durationMs, sessionId, cram } = body.data;
  const result = answerCard(
    cardId,
    rating,
    { durationMs, sessionId, cram },
    ctx.actor,
  );
  if (!result) return fail(404, "not_found", "No card with that id.");

  return ok({
    reviewId: result.reviewId,
    nextDue: result.nextDue,
    interval: humanInterval(result.intervalMs),
    card: result.card,
  });
});
