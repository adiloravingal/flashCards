import { fail, handler, ok } from "@/lib/api";
import { countCards, readDeckZip } from "@/lib/deck";
import { logEvent } from "@/lib/log";
import { listCourses } from "@/lib/repo";
import { stageUpload } from "@/lib/staging";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/import/deck/analyze — multipart `file` (.fcdeck).
 * Reads the deck and reports what's inside. Writes nothing.
 */
export const POST = handler(async (ctx) => {
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    return fail(400, "invalid_form", "Send multipart/form-data with a `file` field.");
  }

  const file = form.get("file");
  if (!(file instanceof File))
    return fail(400, "no_file", "No file found under the `file` field.");

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = readDeckZip(buffer);
  } catch (err) {
    return fail(
      400,
      "parse_failed",
      err instanceof Error ? err.message : "Could not read that deck.",
    );
  }

  if (parsed.totalCards === 0)
    return fail(400, "empty_deck", "That deck has no cards in it.");

  // Warn about a name clash up front rather than silently merging into an
  // existing course after the user has already committed.
  const existing = listCourses(true).find(
    (c) => c.name.toLowerCase() === parsed.deck.course.name.toLowerCase(),
  );

  const stagingId = stageUpload(buffer, "fcdeck");

  logEvent({
    actor: ctx.actor,
    action: "import.deck_analyze",
    summary: `Read deck “${parsed.deck.course.name}” — ${parsed.totalCards} card(s)`,
    meta: { chapters: parsed.deck.chapters.length, media: parsed.media.size },
    ip: ctx.ip,
  });

  return ok({
    stagingId,
    filename: file.name,
    exportedAt: parsed.deck.exportedAt,
    scope: parsed.deck.scope,
    course: parsed.deck.course,
    totalNotes: parsed.totalNotes,
    totalCards: parsed.totalCards,
    mediaCount: parsed.media.size,
    existingCourse: existing ? { id: existing.id, name: existing.name } : null,
    chapters: parsed.deck.chapters.map((c) => ({
      name: c.name,
      // The number of cards this chapter will produce, cloze expansion included.
      cards: countCards([c]),
      clozeCards: Array.isArray(c.cards)
        ? c.cards.filter((x) => x?.cardType === "cloze").length
        : 0,
      sampleFront: (c.cards?.[0]?.front ?? "").slice(0, 120),
      sampleBack: (c.cards?.[0]?.back ?? "").slice(0, 120),
    })),
  });
});
