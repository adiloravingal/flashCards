import { handler } from "@/lib/api";
import { getDb } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { hydrate } from "@/lib/repo";
import type { CardRow, Chapter, Course } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/export — everything, as one JSON file.
 *
 * Media files are referenced by id, not embedded; the real backup is the
 * `data/` folder. This export exists so your content is never trapped in a
 * format only this app understands.
 */
export const GET = handler(async (ctx) => {
  const db = getDb();
  const courses = db.prepare("SELECT * FROM courses ORDER BY position").all() as Course[];
  const chapters = db.prepare("SELECT * FROM chapters ORDER BY position").all() as Chapter[];
  const cards = hydrate(
    db.prepare("SELECT * FROM cards ORDER BY chapter_id, position").all() as CardRow[],
  );

  const byChapter = new Map<string, typeof cards>();
  for (const c of cards) {
    const list = byChapter.get(c.chapter_id) ?? [];
    list.push(c);
    byChapter.set(c.chapter_id, list);
  }

  const payload = {
    format: "flashcards.io/export",
    version: 1,
    exportedAt: new Date().toISOString(),
    courses: courses.map((course) => ({
      name: course.name,
      description: course.description,
      emoji: course.emoji,
      color: course.color,
      chapters: chapters
        .filter((ch) => ch.course_id === course.id)
        .map((ch) => ({
          name: ch.name,
          description: ch.description,
          cards: (byChapter.get(ch.id) ?? []).map((c) => ({
            front: c.front,
            back: c.back,
            hint: c.hint,
            notes: c.notes,
            tags: c.tags,
            starred: !!c.starred,
            suspended: !!c.suspended,
            media: c.media.map((m) => ({
              id: m.id,
              side: m.side,
              filename: m.filename,
              originalName: m.original_name,
              mime: m.mime,
            })),
            schedule: {
              due: c.due,
              stability: c.stability,
              difficulty: c.difficulty,
              reps: c.reps,
              lapses: c.lapses,
              state: c.state,
              lastReview: c.last_review,
            },
          })),
        })),
    })),
  };

  logEvent({
    actor: ctx.actor,
    action: "export",
    summary: `Exported ${cards.length} card(s)`,
    ip: ctx.ip,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="flashcards-backup-${stamp}.json"`,
    },
  });
});
