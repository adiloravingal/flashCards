import { z } from "zod";
import { fail, handler, ok, parseBody } from "@/lib/api";
import { countCards, readDeckZip } from "@/lib/deck";
import { logEvent } from "@/lib/log";
import { saveUpload } from "@/lib/media";
import {
  createCards,
  createChapter,
  createCourse,
  getCourse,
  listChapters,
  listCourses,
  type CardInput,
} from "@/lib/repo";
import { discardStaged, readStaged } from "@/lib/staging";

export const dynamic = "force-dynamic";

const body = z.object({
  stagingId: z.string().uuid(),
  /** Override the course name the deck arrived with. */
  courseName: z.string().min(1).max(200).optional(),
  /** Merge into an existing course instead of creating one. */
  courseId: z.string().min(1).optional(),
  chapters: z.array(z.string()).optional(),
  dryRun: z.boolean().optional().default(false),
});

export const POST = handler(async (ctx) => {
  const parsedBody = await parseBody(ctx.req, body);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.data;

  const staged = readStaged(input.stagingId, "fcdeck");
  if (!staged) {
    return fail(
      404,
      "staging_expired",
      "That upload is no longer staged. Upload the deck again.",
    );
  }

  let parsed;
  try {
    parsed = readDeckZip(staged);
  } catch (err) {
    return fail(
      400,
      "parse_failed",
      err instanceof Error ? err.message : "Could not re-read the staged deck.",
    );
  }

  const wanted = input.chapters
    ? parsed.deck.chapters.filter((c) => input.chapters!.includes(c.name))
    : parsed.deck.chapters;

  // Counted after cloze expansion, so the preview matches what gets created.
  const totalCards = countCards(wanted);

  if (input.dryRun) {
    return ok({
      dryRun: true,
      wouldCreateCards: totalCards,
      wouldCreateNotes: wanted.reduce((n, c) => n + (c.cards?.length ?? 0), 0),
      courseName: input.courseName ?? parsed.deck.course.name,
      chapters: wanted.map((c) => ({ name: c.name, cards: countCards([c]) })),
      mediaFiles: parsed.media.size,
    });
  }

  if (totalCards === 0)
    return fail(400, "no_cards", "The selected chapters contain no cards.");

  // ---- Media first, so cards can reference it ----------------------------
  // The archive's filenames are the *exporter's* ids; saving re-hashes the
  // bytes, so a file you already have is reused rather than duplicated.
  const mediaIdByName = new Map<string, string>();
  let mediaFailures = 0;
  for (const [name, bytes] of parsed.media) {
    try {
      const file = new File([bytes as BlobPart], name);
      const { media } = await saveUpload(file);
      mediaIdByName.set(name, media.id);
    } catch {
      mediaFailures++;
    }
  }

  // ---- Destination course -------------------------------------------------
  const name = (input.courseName ?? parsed.deck.course.name).trim();
  let courseId = input.courseId;

  if (courseId) {
    if (!getCourse(courseId))
      return fail(404, "course_not_found", "No course with that id.");
  } else {
    const clash = listCourses(true).find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    courseId =
      clash?.id ??
      createCourse(
        {
          name,
          description: parsed.deck.course.description,
          emoji: parsed.deck.course.emoji,
          color: parsed.deck.course.color,
        },
        "import",
      ).id;
  }

  // ---- Chapters and cards -------------------------------------------------
  const results: { chapter: string; created: number }[] = [];

  for (const chapter of wanted) {
    if (!chapter.cards?.length) continue;

    const existing = listChapters(courseId, true).find(
      (ch) => ch.name.toLowerCase() === chapter.name.toLowerCase(),
    );
    const chapterId =
      existing?.id ??
      createChapter(
        { courseId, name: chapter.name, description: chapter.description },
        "import",
      )?.id;
    if (!chapterId) continue;

    const cards: CardInput[] = chapter.cards.map((card) => ({
      chapterId,
      front: card.front ?? "",
      back: card.back ?? "",
      hint: card.hint,
      notes: card.notes,
      tags: card.tags,
      starred: card.starred,
      cardType: card.cardType,
      mediaIds: (card.media ?? [])
        .map((m) => {
          const id = mediaIdByName.get(m.file);
          return id ? { id, side: m.side } : null;
        })
        .filter((m): m is { id: string; side: "front" | "back" } => m !== null),
    }));

    const created = createCards(cards, "import", "deck");
    results.push({ chapter: chapter.name, created: created.length });
  }

  discardStaged(input.stagingId, "fcdeck");

  const createdCards = results.reduce((n, r) => n + r.created, 0);
  logEvent({
    actor: ctx.actor,
    action: "import.deck_commit",
    entityType: "course",
    entityId: courseId,
    summary:
      `Imported ${createdCards} card(s) into “${name}”` +
      (mediaFailures ? `, ${mediaFailures} media file(s) failed` : ""),
    meta: { results, media: mediaIdByName.size, mediaFailures },
    ip: ctx.ip,
  });

  return ok(
    {
      courseId,
      cardsCreated: createdCards,
      mediaImported: mediaIdByName.size,
      mediaFailures,
      results,
    },
    { status: 201 },
  );
});
