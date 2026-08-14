import { fail, handler, ok, parseBody } from "@/lib/api";
import {
  countCardsInScope,
  deleteCourse,
  getCourse,
  listChapters,
  updateCourse,
} from "@/lib/repo";
import { courseUpdate } from "@/lib/validators";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_ctx, { params }: Params) => {
  const { id } = await params;
  const course = getCourse(id);
  if (!course) return fail(404, "not_found", "No course with that id.");
  return ok({
    ...course,
    chapters: listChapters(id, true),
    counts: countCardsInScope({ kind: "course", id }),
  });
});

export const PATCH = handler(async (ctx, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(ctx.req, courseUpdate);
  if (!body.ok) return body.response;

  const patch = { ...body.data } as Record<string, unknown>;
  if (typeof patch.archived === "boolean") patch.archived = patch.archived ? 1 : 0;

  const updated = updateCourse(id, patch, ctx.actor);
  if (!updated) return fail(404, "not_found", "No course with that id.");
  return ok(updated);
});

export const DELETE = handler(async (ctx, { params }: Params) => {
  const { id } = await params;
  if (!deleteCourse(id, ctx.actor))
    return fail(404, "not_found", "No course with that id.");
  return ok({ deleted: id });
});
