import { fail, handler, ok, parseBody } from "@/lib/api";
import {
  countCardsInScope,
  deleteChapter,
  getChapter,
  getCourse,
  updateChapter,
} from "@/lib/repo";
import { chapterUpdate } from "@/lib/validators";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_ctx, { params }: Params) => {
  const { id } = await params;
  const chapter = getChapter(id);
  if (!chapter) return fail(404, "not_found", "No chapter with that id.");
  return ok({
    ...chapter,
    course: getCourse(chapter.course_id) ?? null,
    counts: countCardsInScope({ kind: "chapter", id }),
  });
});

export const PATCH = handler(async (ctx, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(ctx.req, chapterUpdate);
  if (!body.ok) return body.response;

  const { courseId, archived, ...rest } = body.data;
  const patch: Record<string, unknown> = { ...rest };
  if (courseId !== undefined) patch.course_id = courseId;
  if (archived !== undefined)
    patch.archived = typeof archived === "boolean" ? (archived ? 1 : 0) : archived;

  const updated = updateChapter(id, patch, ctx.actor);
  if (!updated) return fail(404, "not_found", "No chapter with that id.");
  return ok(updated);
});

export const DELETE = handler(async (ctx, { params }: Params) => {
  const { id } = await params;
  if (!deleteChapter(id, ctx.actor))
    return fail(404, "not_found", "No chapter with that id.");
  return ok({ deleted: id });
});
