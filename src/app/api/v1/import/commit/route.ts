import { fail, handler, ok, parseBody } from "@/lib/api";
import { logEvent } from "@/lib/log";
import {
  createCards,
  createChapter,
  createCourse,
  getCourse,
  type CardInput,
} from "@/lib/repo";
import { importCommit } from "@/lib/validators";

export const dynamic = "force-dynamic";

const at = (row: string[], index: number): string =>
  index >= 0 && index < row.length ? (row[index] ?? "").trim() : "";

/**
 * POST /api/v1/import/commit — turn a reviewed mapping into real cards.
 * One chapter per included sheet. `dryRun: true` reports counts only.
 */
export const POST = handler(async (ctx) => {
  const body = await parseBody(ctx.req, importCommit);
  if (!body.ok) return body.response;
  const input = body.data;

  const included = input.sheets.filter((s) => s.include);
  if (included.length === 0)
    return fail(400, "nothing_selected", "No sheets were marked for import.");

  // ---- Work out what would be created, before touching the database -------
  const plan = included.map((sheet) => {
    const dataRows = sheet.skipFirstRow ? sheet.rows.slice(1) : sheet.rows;
    const cards: CardInput[] = [];
    let skipped = 0;

    for (const row of dataRows) {
      const front = at(row, sheet.frontColumn);
      const back = at(row, sheet.backColumn);
      if (!front && !back) {
        skipped++;
        continue;
      }
      const tagsRaw = at(row, sheet.tagsColumn ?? -1);
      cards.push({
        chapterId: "", // filled in once the chapter exists
        front,
        back,
        hint: at(row, sheet.hintColumn ?? -1),
        notes: at(row, sheet.notesColumn ?? -1),
        tags: tagsRaw
          ? tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
          : [],
      });
    }
    return { sheet, cards, skipped };
  });

  const totalCards = plan.reduce((n, p) => n + p.cards.length, 0);

  if (input.dryRun) {
    return ok({
      dryRun: true,
      wouldCreateCards: totalCards,
      chapters: plan.map((p) => ({
        chapterName: p.sheet.chapterName,
        cards: p.cards.length,
        skippedEmptyRows: p.skipped,
      })),
    });
  }

  if (totalCards === 0)
    return fail(
      400,
      "no_cards",
      "Every row was empty under the columns you picked. Check the mapping.",
    );

  // ---- Resolve the course -------------------------------------------------
  let courseId = input.courseId;
  if (!courseId) {
    if (!input.newCourseName)
      return fail(
        400,
        "missing_course",
        "Provide either `courseId` or `newCourseName`.",
      );
    courseId = createCourse({ name: input.newCourseName }, "import").id;
  } else if (!getCourse(courseId)) {
    return fail(404, "course_not_found", "No course with that id.");
  }

  // ---- Create chapters and cards -----------------------------------------
  const results: { chapter: string; chapterId: string; created: number }[] = [];

  for (const p of plan) {
    if (p.cards.length === 0) continue;
    const chapter = createChapter(
      { courseId, name: p.sheet.chapterName },
      "import",
    );
    if (!chapter) continue;

    const created = createCards(
      p.cards.map((c) => ({ ...c, chapterId: chapter.id })),
      "import",
      "import",
    );
    results.push({
      chapter: chapter.name,
      chapterId: chapter.id,
      created: created.length,
    });
  }

  const created = results.reduce((n, r) => n + r.created, 0);
  logEvent({
    actor: ctx.actor,
    action: "import.commit",
    entityType: "course",
    entityId: courseId,
    summary: `Imported ${created} card(s) into ${results.length} chapter(s)`,
    meta: { results },
    ip: ctx.ip,
  });

  return ok({ courseId, created, chapters: results }, { status: 201 });
});
