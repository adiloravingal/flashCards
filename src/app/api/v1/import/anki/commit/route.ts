import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { fail, handler, ok, parseBody } from "@/lib/api";
import { noteToCard, readApkg, type AnkiNote } from "@/lib/anki";
import { DATA_DIR } from "@/lib/db-node";
import { logEvent } from "@/lib/log";
import { saveUpload } from "@/lib/media";
import {
  createCards,
  createChapter,
  createCourse,
  listChapters,
  listCourses,
  type CardInput,
} from "@/lib/repo";

export const dynamic = "force-dynamic";

const STAGING_DIR = path.join(DATA_DIR, "staging");

const body = z.object({
  stagingId: z.string().uuid(),
  dryRun: z.boolean().optional().default(false),
  /** One entry per deck the user chose to keep, with its destination. */
  decks: z
    .array(
      z.object({
        name: z.string(),
        include: z.boolean(),
        course: z.string().min(1).max(200),
        chapter: z.string().min(1).max(200),
      }),
    )
    .min(1),
});

export const POST = handler(async (ctx) => {
  const parsed = await parseBody(ctx.req, body);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const stagedPath = path.join(STAGING_DIR, `${input.stagingId}.apkg`);
  if (!fs.existsSync(stagedPath)) {
    return fail(
      404,
      "staging_expired",
      "That upload is no longer staged. Upload the .apkg again.",
    );
  }

  let pkg;
  try {
    pkg = readApkg(fs.readFileSync(stagedPath));
  } catch (err) {
    return fail(
      400,
      "parse_failed",
      err instanceof Error ? err.message : "Could not re-read the staged file.",
    );
  }

  // `readApkg` normalises \x1f to :: in summaries, so match on that form.
  const wanted = new Map(
    input.decks.filter((d) => d.include).map((d) => [d.name, d]),
  );
  if (wanted.size === 0)
    return fail(400, "nothing_selected", "No decks were marked for import.");

  const byDeck = new Map<string, AnkiNote[]>();
  for (const note of pkg.notes) {
    const key = note.deck.replace(/\x1f/g, "::");
    if (!wanted.has(key)) continue;
    const list = byDeck.get(key) ?? [];
    list.push(note);
    byDeck.set(key, list);
  }

  const totalNotes = [...byDeck.values()].reduce((n, l) => n + l.length, 0);

  if (input.dryRun) {
    return ok({
      dryRun: true,
      wouldCreateNotes: totalNotes,
      mediaFiles: pkg.media.size,
      destinations: [...byDeck.entries()].map(([name, list]) => ({
        deck: name,
        course: wanted.get(name)!.course,
        chapter: wanted.get(name)!.chapter,
        notes: list.length,
      })),
    });
  }

  if (totalNotes === 0)
    return fail(400, "no_notes", "The selected decks contain no notes.");

  // ---- Media first, so cards can reference it ----------------------------
  // Uploads are content-hashed, so a file shared by 300 notes is stored once.
  const mediaIdByName = new Map<string, string>();
  let mediaFailures = 0;
  for (const [name, bytes] of pkg.media) {
    try {
      const file = new File([bytes as BlobPart], name);
      const { media } = await saveUpload(file);
      mediaIdByName.set(name, media.id);
    } catch {
      mediaFailures++;
    }
  }

  // ---- Resolve destinations, reusing anything that already exists --------
  const courseIdByName = new Map<string, string>();
  for (const c of listCourses(true)) {
    courseIdByName.set(c.name.toLowerCase(), c.id);
  }

  const results: { deck: string; course: string; chapter: string; created: number }[] =
    [];

  for (const [deckName, notes] of byDeck) {
    const target = wanted.get(deckName)!;

    let courseId = courseIdByName.get(target.course.toLowerCase());
    if (!courseId) {
      courseId = createCourse({ name: target.course }, "import").id;
      courseIdByName.set(target.course.toLowerCase(), courseId);
    }

    const existingChapter = listChapters(courseId, true).find(
      (ch) => ch.name.toLowerCase() === target.chapter.toLowerCase(),
    );
    const chapterId =
      existingChapter?.id ??
      createChapter({ courseId, name: target.chapter }, "import")?.id;
    if (!chapterId) continue;

    const cards: CardInput[] = notes.map((note) => {
      const { front, back, notes: extra } = noteToCard(note);

      // Field 1's media belongs on the front; everything else on the back.
      const mediaIds: { id: string; side: "front" | "back" }[] = [];
      note.mediaByField.forEach((refs, fieldIndex) => {
        for (const name of refs) {
          const id = mediaIdByName.get(name);
          if (id) mediaIds.push({ id, side: fieldIndex === 0 ? "front" : "back" });
        }
      });

      return {
        chapterId,
        front,
        back,
        notes: extra,
        tags: note.tags,
        mediaIds,
        // Left undefined on purpose: `{{c1::…}}` in the front auto-detects,
        // so Anki cloze notes arrive as cloze notes without special casing.
      };
    });

    const created = createCards(cards, "import", "anki");
    results.push({
      deck: deckName,
      course: target.course,
      chapter: target.chapter,
      created: created.length,
    });
  }

  try {
    fs.rmSync(stagedPath, { force: true });
  } catch {
    /* the sweeper will get it */
  }

  const createdCards = results.reduce((n, r) => n + r.created, 0);
  logEvent({
    actor: ctx.actor,
    action: "import.anki_commit",
    summary:
      `Imported ${createdCards} card(s) from ${results.length} Anki deck(s)` +
      (mediaFailures ? `, ${mediaFailures} media file(s) failed` : ""),
    meta: { results, media: mediaIdByName.size, mediaFailures },
    ip: ctx.ip,
  });

  return ok(
    {
      notesImported: totalNotes,
      cardsCreated: createdCards,
      mediaImported: mediaIdByName.size,
      mediaFailures,
      results,
      courseId: courseIdByName.get(
        [...wanted.values()][0].course.toLowerCase(),
      ),
    },
    { status: 201 },
  );
});
