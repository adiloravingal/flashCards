import { fail, handler, ok, parseBody } from "@/lib/api";
import { createChapter, listChapters } from "@/lib/repo";
import { chapterCreate } from "@/lib/validators";

export const dynamic = "force-dynamic";

export const GET = handler(async (ctx) => {
  const courseId = new URL(ctx.req.url).searchParams.get("courseId");
  if (!courseId)
    return fail(400, "missing_param", "Pass ?courseId= to list chapters.");
  return ok(listChapters(courseId));
});

export const POST = handler(async (ctx) => {
  const body = await parseBody(ctx.req, chapterCreate);
  if (!body.ok) return body.response;
  const chapter = createChapter(body.data, ctx.actor);
  if (!chapter) return fail(404, "not_found", "No course with that id.");
  return ok(chapter, { status: 201 });
});
