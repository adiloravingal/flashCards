import { fail, handler, ok, parseBody } from "@/lib/api";
import { deleteCard, getCard, updateCard } from "@/lib/repo";
import { cardUpdate } from "@/lib/validators";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_ctx, { params }: Params) => {
  const { id } = await params;
  const card = getCard(id);
  if (!card) return fail(404, "not_found", "No card with that id.");
  return ok(card);
});

export const PATCH = handler(async (ctx, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(ctx.req, cardUpdate);
  if (!body.ok) return body.response;
  const updated = updateCard(id, body.data, ctx.actor);
  if (!updated) return fail(404, "not_found", "No card with that id.");
  return ok(updated);
});

export const DELETE = handler(async (ctx, { params }: Params) => {
  const { id } = await params;
  if (!deleteCard(id, ctx.actor))
    return fail(404, "not_found", "No card with that id.");
  return ok({ deleted: id });
});
