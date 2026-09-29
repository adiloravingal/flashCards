import { fail, handler } from "@/lib/api";
import { buildDeckZip, deckFilename } from "@/lib/deck";
import { logEvent } from "@/lib/log";
import { getChapter, getCourse, listChapters } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/export/deck?courseId=…  — the whole course, chapter by chapter
 * GET /api/v1/export/deck?chapterId=… — just that chapter
 *
 * Returns a `.fcdeck` zip: content and media, no scheduling. Made to hand to
 * someone else.
 */
export const GET = handler(async (ctx) => {
  const sp = new URL(ctx.req.url).searchParams;
  const courseId = sp.get("courseId");
  const chapterId = sp.get("chapterId");

  let course;
  let chapters;
  let scope: "course" | "chapter";
  let label: string;

  if (chapterId) {
    const chapter = getChapter(chapterId);
    if (!chapter) return fail(404, "not_found", "No chapter with that id.");
    course = getCourse(chapter.course_id);
    if (!course) return fail(404, "not_found", "That chapter has no course.");
    chapters = [chapter];
    scope = "chapter";
    label = `${course.name} - ${chapter.name}`;
  } else if (courseId) {
    course = getCourse(courseId);
    if (!course) return fail(404, "not_found", "No course with that id.");
    chapters = listChapters(courseId, true);
    scope = "course";
    label = course.name;
  } else {
    return fail(
      400,
      "missing_param",
      "Pass either ?courseId= or ?chapterId=.",
    );
  }

  const { bytes, deck, mediaCount } = await buildDeckZip(course, chapters, scope);
  const cards = deck.chapters.reduce((n, c) => n + c.cards.length, 0);

  if (cards === 0) {
    return fail(
      400,
      "empty",
      scope === "chapter"
        ? "That chapter has no cards to export yet."
        : "That course has no cards to export yet.",
    );
  }

  logEvent({
    actor: ctx.actor,
    action: "export.deck",
    entityType: scope,
    entityId: chapterId ?? courseId,
    summary: `Exported “${label}” — ${cards} card(s), ${mediaCount} file(s)`,
    ip: ctx.ip,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${deckFilename(label)}"`,
    },
  });
});
