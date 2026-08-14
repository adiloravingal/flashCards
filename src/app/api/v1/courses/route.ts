import { handler, ok, parseBody } from "@/lib/api";
import { createCourse, listCourses } from "@/lib/repo";
import { courseCreate } from "@/lib/validators";

export const dynamic = "force-dynamic";

export const GET = handler(async (ctx) => {
  const includeArchived =
    new URL(ctx.req.url).searchParams.get("includeArchived") === "1";
  return ok(listCourses(includeArchived));
});

export const POST = handler(async (ctx) => {
  const body = await parseBody(ctx.req, courseCreate);
  if (!body.ok) return body.response;
  return ok(createCourse(body.data, ctx.actor), { status: 201 });
});
