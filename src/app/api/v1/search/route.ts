import { handler, intParam, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { searchCards } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handler(async (ctx) => {
  const sp = new URL(ctx.req.url).searchParams;
  const q = sp.get("q") ?? "";
  const limit = intParam(sp, "limit", 50, 1, 200);

  const cards = searchCards(q, limit);

  // Attach the course/chapter names so results are navigable without a
  // second request — the search screen shows "Biology › Cells" under each hit.
  const chapterIds = [...new Set(cards.map((c) => c.chapter_id))];
  const labels = new Map<string, { courseId: string; course: string; chapter: string }>();
  if (chapterIds.length) {
    const rows = getDb()
      .prepare(
        `SELECT ch.id AS chapter_id, ch.name AS chapter, co.id AS course_id, co.name AS course
           FROM chapters ch JOIN courses co ON co.id = ch.course_id
          WHERE ch.id IN (${chapterIds.map(() => "?").join(",")})`,
      )
      .all(...chapterIds) as {
      chapter_id: string;
      chapter: string;
      course_id: string;
      course: string;
    }[];
    for (const r of rows)
      labels.set(r.chapter_id, {
        courseId: r.course_id,
        course: r.course,
        chapter: r.chapter,
      });
  }

  return ok({
    query: q,
    results: cards.map((c) => ({
      ...c,
      courseId: labels.get(c.chapter_id)?.courseId,
      courseName: labels.get(c.chapter_id)?.course,
      chapterName: labels.get(c.chapter_id)?.chapter,
    })),
  });
});
