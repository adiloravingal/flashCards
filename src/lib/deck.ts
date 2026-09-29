import { unzipSync, zipSync } from "fflate";
import { clozeIndices } from "./cloze";
import { getDb } from "./db";
import { mediaStore } from "./mediaStore";
import { hydrate } from "./repo";
import type { CardRow, Chapter, Course } from "./types";

/**
 * `.fcdeck` — the shareable deck format.
 *
 * A zip holding `deck.json` plus a `media/` folder. Zip rather than plain JSON
 * because a deck without its images isn't the same deck, and base64-inlining
 * megabytes of PNGs into JSON makes a file nobody can open in a text editor
 * *and* nobody can extract an image from.
 *
 * Deliberately carries no scheduling state. These are made to hand to someone
 * else, and your intervals mean nothing to their memory. Use the full JSON
 * export (Settings → Backup) when you want your own progress preserved.
 */

export const DECK_FORMAT = "flashcards.io/deck";
export const DECK_VERSION = 1;

export interface DeckCard {
  front: string;
  back: string;
  hint?: string;
  notes?: string;
  tags?: string[];
  starred?: boolean;
  /** "cloze" notes keep their `{{c1::…}}` markup and re-expand on import. */
  cardType?: "basic" | "cloze";
  media?: { file: string; side: "front" | "back" }[];
}

export interface DeckChapter {
  name: string;
  description?: string;
  cards: DeckCard[];
}

export interface DeckFile {
  format: string;
  version: number;
  exportedAt: string;
  /** What was selected when this was exported — informational only. */
  scope: "course" | "chapter";
  course: {
    name: string;
    description?: string;
    emoji?: string;
    color?: string;
  };
  chapters: DeckChapter[];
}

/* ==========================================================================
 * Building
 * ========================================================================== */

/**
 * Collect a course (or a single chapter) into a deck payload.
 *
 * Cards are grouped back into the notes they came from: a cloze note that
 * exploded into three cards is exported once, and re-expands on import.
 * Exporting three near-identical rows would turn one shared note into three
 * unrelated cards on the other side.
 */
function collect(
  course: Course,
  chapters: Chapter[],
  scope: "course" | "chapter",
): { deck: DeckFile; mediaFiles: Set<string> } {
  const db = getDb();
  const mediaFiles = new Set<string>();

  const deckChapters: DeckChapter[] = chapters.map((chapter) => {
    const rows = db
      .prepare(
        "SELECT * FROM cards WHERE chapter_id = ? ORDER BY position, created_at",
      )
      .all(chapter.id) as CardRow[];

    const cards = hydrate(rows);
    const seenNotes = new Set<string>();
    const out: DeckCard[] = [];

    for (const card of cards) {
      const noteKey = card.note_id || card.id;
      if (seenNotes.has(noteKey)) continue;
      seenNotes.add(noteKey);

      const media = card.media.map((m) => {
        mediaFiles.add(m.filename);
        return { file: m.filename, side: m.side };
      });

      out.push({
        front: card.front,
        back: card.back,
        ...(card.hint ? { hint: card.hint } : {}),
        ...(card.notes ? { notes: card.notes } : {}),
        ...(card.tags.length ? { tags: card.tags } : {}),
        ...(card.starred ? { starred: true } : {}),
        ...(card.card_type === "cloze" ? { cardType: "cloze" as const } : {}),
        ...(media.length ? { media } : {}),
      });
    }

    return {
      name: chapter.name,
      ...(chapter.description ? { description: chapter.description } : {}),
      cards: out,
    };
  });

  return {
    deck: {
      format: DECK_FORMAT,
      version: DECK_VERSION,
      exportedAt: new Date().toISOString(),
      scope,
      course: {
        name: course.name,
        ...(course.description ? { description: course.description } : {}),
        ...(course.emoji ? { emoji: course.emoji } : {}),
        ...(course.color ? { color: course.color } : {}),
      },
      chapters: deckChapters,
    },
    mediaFiles,
  };
}

export async function buildDeckZip(
  course: Course,
  chapters: Chapter[],
  scope: "course" | "chapter",
): Promise<{ bytes: Buffer; deck: DeckFile; mediaCount: number }> {
  const { deck, mediaFiles } = collect(course, chapters, scope);

  const entries: Record<string, Uint8Array> = {
    "deck.json": new TextEncoder().encode(JSON.stringify(deck, null, 2)),
  };

  const store = mediaStore();
  let mediaCount = 0;
  for (const filename of mediaFiles) {
    const bytes = await store.read(filename);
    if (!bytes) {
      // Missing bytes shouldn't sink the export: the cards still carry their
      // text, and the reference simply won't resolve on the other side.
      continue;
    }
    entries[`media/${filename}`] = bytes;
    mediaCount++;
  }

  return { bytes: Buffer.from(zipSync(entries)), deck, mediaCount };
}

/** Safe, human-readable filename for the download. */
export function deckFilename(label: string): string {
  const clean = label
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
  return `${clean || "deck"}.fcdeck`;
}

/* ==========================================================================
 * Reading
 * ========================================================================== */

export interface ParsedDeck {
  deck: DeckFile;
  media: Map<string, Uint8Array>;
  /** Entries in the file — one per authored note. */
  totalNotes: number;
  /** Cards those entries will become, after cloze expansion. */
  totalCards: number;
}

/**
 * How many cards a deck entry will actually become once imported.
 *
 * A deck stores *notes*, and a cloze note explodes into one card per deletion.
 * Counting entries would under-report — the preview would promise four cards
 * and produce five, which is exactly the kind of small lie that makes someone
 * stop trusting the numbers.
 */
export function cardsInEntry(card: DeckCard): number {
  if (card.cardType !== "cloze") return 1;
  return Math.max(1, clozeIndices(card.front ?? "").length);
}

export function countCards(chapters: DeckChapter[]): number {
  return chapters.reduce(
    (total, chapter) =>
      total +
      (Array.isArray(chapter.cards)
        ? chapter.cards.reduce((n, card) => n + cardsInEntry(card), 0)
        : 0),
    0,
  );
}

export function readDeckZip(buffer: Buffer): ParsedDeck {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("That file isn't a readable .fcdeck (it isn't a valid zip).");
  }

  const manifest = files["deck.json"];
  if (!manifest) {
    throw new Error("No deck.json inside that file — is it really a .fcdeck?");
  }

  let deck: DeckFile;
  try {
    deck = JSON.parse(new TextDecoder().decode(manifest)) as DeckFile;
  } catch {
    throw new Error("The deck.json inside that file is corrupt.");
  }

  if (deck?.format !== DECK_FORMAT) {
    throw new Error(
      `Unrecognised deck format${deck?.format ? ` “${deck.format}”` : ""}.`,
    );
  }
  if (typeof deck.version !== "number" || deck.version > DECK_VERSION) {
    throw new Error(
      `That deck was made by a newer version of the app (format v${deck.version}).`,
    );
  }
  if (!Array.isArray(deck.chapters)) {
    throw new Error("That deck has no chapters in it.");
  }

  const media = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith("media/") && bytes.length > 0) {
      media.set(name.slice("media/".length), bytes);
    }
  }

  const totalNotes = deck.chapters.reduce(
    (n, c) => n + (Array.isArray(c.cards) ? c.cards.length : 0),
    0,
  );

  return { deck, media, totalNotes, totalCards: countCards(deck.chapters) };
}
