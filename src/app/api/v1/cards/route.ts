import { fail, handler, intParam, ok, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { logEvent } from "@/lib/log";
import {
  createCards,
  createChapter,
  createCourse,
  getChapter,
  hydrate,
  listChapters,
  listCourses,
  parseScope,
  scopeSql,
} from "@/lib/repo";
import type { CardRow } from "@/lib/types";
import { cardsBulkCreate } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** GET /api/v1/cards?chapterId=&courseId=&tag=&starred=1&limit=&offset= */
export const GET = handler(async (ctx) => {
  const sp = new URL(ctx.req.url).searchParams;
  const scope = parseScope(sp);
  const { where, params } = scopeSql(scope);
  const limit = intParam(sp, "limit", 200, 1, 1000);
  const offset = intParam(sp, "offset", 0, 0, 1_000_000);

  const rows = getDb()
    .prepare(
      `SELECT * FROM cards WHERE ${where}
        ORDER BY position, created_at LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CardRow[];

  const total = (
    getDb()
      .prepare(`SELECT COUNT(*) AS c FROM cards WHERE ${where}`)
      .get(...params) as { c: number }
  ).c;

  return ok({ cards: hydrate(rows), total, limit, offset });
});

/**
 * POST /api/v1/cards — bulk create. This is the main entry point for agents.
 *
 * Target a chapter either by `chapterId`, or by `courseName` + `chapterName`
 * (created on demand unless `createMissing: false`). Set `dryRun: true` to see
 * exactly what would happen without writing anything.
 */
export const POST = handler(async (ctx) => {
  const body = await parseBody(ctx.req, cardsBulkCreate);
  if (!body.ok) return body.response;
  const input = body.data;

  // ---- Resolve the destination chapter -----------------------------------
  let chapterId = input.chapterId;
  const created: { course?: string; chapter?: string } = {};

  if (!chapterId) {
    if (!input.courseName || !input.chapterName) {
      return fail(
        400,
        "missing_target",
        "Provide either `chapterId`, or both `courseName` and `chapterName`.",
      );
    }

    const courses = listCourses(true);
    const match = courses.find(
      (c) => c.name.toLowerCase() === input.courseName!.toLowerCase(),
    );
    let courseId: string | undefined = match?.id;

    if (!courseId) {
      if (!input.createMissing)
        return fail(
          404,
          "course_not_found",
          `No course named “${input.courseName}”. Set createMissing: true to create it.`,
        );
      created.course = input.courseName;
      if (!input.dryRun) {
        courseId = createCourse({ name: input.courseName }, ctx.actor).id;
      }
    }

    if (courseId) {
      const chapters = listChapters(courseId, true);
      const chapter = chapters.find(
        (c) => c.name.toLowerCase() === input.chapterName!.toLowerCase(),
      );
      if (chapter) {
        chapterId = chapter.id;
      } else if (!input.createMissing) {
        return fail(
          404,
          "chapter_not_found",
          `No chapter named “${input.chapterName}” in that course.`,
        );
      } else if (!input.dryRun) {
        const made = createChapter(
          { courseId, name: input.chapterName },
          ctx.actor,
        );
        chapterId = made?.id;
        created.chapter = input.chapterName;
      } else {
        created.chapter = input.chapterName;
      }
    }
  } else if (!getChapter(chapterId)) {
    return fail(404, "chapter_not_found", "No chapter with that id.");
  }

  // ---- Deduplicate against what is already there --------------------------
  const existingFronts = new Set<string>();
  if (input.dedupe && chapterId) {
    const rows = getDb()
      .prepare("SELECT front FROM cards WHERE chapter_id = ?")
      .all(chapterId) as { front: string }[];
    for (const r of rows) existingFronts.add(r.front.trim().toLowerCase());
  }

  const accepted: typeof input.cards = [];
  const skipped: { index: number; reason: string }[] = [];
  const seenInBatch = new Set<string>();

  input.cards.forEach((c, index) => {
    const front = (c.front ?? "").trim();
    const back = (c.back ?? "").trim();
    if (!front && !back && !(c.mediaIds?.length)) {
      skipped.push({ index, reason: "empty" });
      return;
    }
    const key = front.toLowerCase();
    if (input.dedupe && key && (existingFronts.has(key) || seenInBatch.has(key))) {
      skipped.push({ index, reason: "duplicate_front" });
      return;
    }
    seenInBatch.add(key);
    accepted.push(c);
  });

  if (input.dryRun) {
    return ok({
      dryRun: true,
      wouldCreate: accepted.length,
      wouldSkip: skipped,
      wouldCreateCourse: created.course ?? null,
      wouldCreateChapter: created.chapter ?? null,
      resolvedChapterId: chapterId ?? null,
    });
  }

  if (!chapterId)
    return fail(500, "no_chapter", "Could not resolve a destination chapter.");

  const cards = createCards(
    accepted.map((c) => ({ ...c, chapterId: chapterId! })),
    ctx.actor,
    ctx.actor === "agent" ? "agent" : "manual",
  );

  if (ctx.actor === "agent") {
    logEvent({
      actor: "agent",
      action: "agent.bulk_create",
      entityType: "chapter",
      entityId: chapterId,
      summary: `Agent added ${cards.length} card(s)` +
        (skipped.length ? `, skipped ${skipped.length}` : ""),
      meta: { created: cards.length, skipped },
      ip: ctx.ip,
    });
  }

  return ok({ created: cards.length, skipped, chapterId, cards }, { status: 201 });
});
