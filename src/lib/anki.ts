import Database from "better-sqlite3";
import { unzipSync } from "fflate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zstdDecompressSync } from "node:zlib";

/**
 * Reader for Anki `.apkg` files.
 *
 * An .apkg is a zip holding a SQLite collection plus numbered media blobs.
 * Three generations exist in the wild and shared decks are a mix of all
 * three, so all three are handled:
 *
 *   collection.anki2    plain SQLite, decks/notetypes as JSON in `col`
 *   collection.anki21   plain SQLite, same or split-table schema
 *   collection.anki21b  zstd-compressed SQLite, split-table schema,
 *                       protobuf media manifest, zstd-compressed media
 *
 * Note types are deliberately *not* interpreted. Anki's templating system is
 * a whole language, and faithfully executing it is not the goal — getting
 * your content across is. Field 1 becomes the front, field 2 the back, and
 * anything else is appended to notes. Cloze notes need no special casing at
 * all: the `{{c1::…}}` markup survives as text and our own card pipeline
 * expands it.
 */

/* ==========================================================================
 * Minimal protobuf reader (only what the media manifest needs)
 * ========================================================================== */

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break;
  }
  return [result >>> 0, pos];
}

/** Pull the `name` (field 1) out of each MediaEntry in a MediaEntries blob. */
function parseMediaProto(buf: Uint8Array): string[] {
  const names: string[] = [];
  let pos = 0;

  while (pos < buf.length) {
    let key: number;
    [key, pos] = readVarint(buf, pos);
    const field = key >>> 3;
    const wire = key & 0x07;

    if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(buf, pos);
      const chunk = buf.subarray(pos, pos + len);
      pos += len;

      if (field === 1) {
        // MediaEntry — its own field 1 is the filename.
        let p = 0;
        while (p < chunk.length) {
          let k: number;
          [k, p] = readVarint(chunk, p);
          const f = k >>> 3;
          const w = k & 0x07;
          if (w === 2) {
            let l: number;
            [l, p] = readVarint(chunk, p);
            if (f === 1) {
              names.push(new TextDecoder().decode(chunk.subarray(p, p + l)));
            }
            p += l;
          } else if (w === 0) {
            [, p] = readVarint(chunk, p);
          } else if (w === 5) {
            p += 4;
          } else if (w === 1) {
            p += 8;
          } else break;
        }
      }
    } else if (wire === 0) {
      [, pos] = readVarint(buf, pos);
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 1) {
      pos += 8;
    } else break;
  }
  return names;
}

/* ==========================================================================
 * HTML flattening
 * ========================================================================== */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

export function flattenHtml(input: string): string {
  let s = input;

  // Structural tags become line breaks so lists and paragraphs survive.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(div|p|li|tr|h[1-6])\s*>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "· ");

  // Anki wraps TTS and typing prompts in tags that carry no reading value.
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");

  s = s.replace(/<[^>]+>/g, "");

  s = s.replace(/&#(\d+);/g, (_m, code: string) =>
    String.fromCodePoint(Number(code)),
  );
  for (const [entity, char] of Object.entries(ENTITIES)) {
    s = s.split(entity).join(char);
  }

  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Media referenced by a field, plus the text with those references removed. */
export function extractMediaRefs(field: string): {
  text: string;
  files: string[];
} {
  const files: string[] = [];
  let text = field;

  text = text.replace(/<img[^>]*>/gi, (tag) => {
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) files.push(decodeURIComponent(src));
    return " ";
  });

  text = text.replace(/\[sound:([^\]]+)\]/gi, (_all, name: string) => {
    files.push(decodeURIComponent(name));
    return " ";
  });

  text = text.replace(/<(audio|video)[^>]*>[\s\S]*?<\/\1>/gi, (tag) => {
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) files.push(decodeURIComponent(src));
    return " ";
  });

  return { text, files };
}

/* ==========================================================================
 * Types
 * ========================================================================== */

export interface AnkiNote {
  deck: string;
  fields: string[];
  tags: string[];
  /** Media filenames referenced anywhere in this note. */
  media: string[];
  /** Same, but per field index — lets field 1's image stay on the front. */
  mediaByField: string[][];
}

export interface AnkiDeckSummary {
  name: string;
  /** Top-level deck — becomes the course. */
  course: string;
  /** Remaining path — becomes the chapter. */
  chapter: string;
  notes: number;
  clozeNotes: number;
  sampleFront: string;
  sampleBack: string;
}

export interface AnkiPackage {
  decks: AnkiDeckSummary[];
  notes: AnkiNote[];
  /** filename -> bytes, only for files a note actually references. */
  media: Map<string, Uint8Array>;
  totalNotes: number;
  skipped: number;
  schema: string;
}

/* ==========================================================================
 * Reading
 * ========================================================================== */

const DECK_SEPARATORS = /\x1f|::/;

function splitDeckName(name: string): { course: string; chapter: string } {
  const parts = name
    .split(DECK_SEPARATORS)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { course: "Imported", chapter: "Main" };
  if (parts.length === 1) return { course: parts[0], chapter: parts[0] };
  return { course: parts[0], chapter: parts.slice(1).join(" › ") };
}

function openCollection(files: Record<string, Uint8Array>): {
  db: Database.Database;
  tmpPath: string;
  schema: string;
} {
  // Newest first — a modern .apkg ships a legacy stub that says "upgrade".
  const candidates: [string, boolean][] = [
    ["collection.anki21b", true],
    ["collection.anki21", false],
    ["collection.anki2", false],
  ];

  for (const [name, compressed] of candidates) {
    const raw = files[name];
    if (!raw) continue;

    let bytes: Buffer;
    if (compressed) {
      try {
        bytes = zstdDecompressSync(Buffer.from(raw));
      } catch {
        continue; // not actually zstd — try the next candidate
      }
    } else {
      bytes = Buffer.from(raw);
    }

    // SQLite has no in-memory "open from buffer", so stage it on disk.
    const tmpPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "fc-anki-")),
      "collection.sqlite",
    );
    fs.writeFileSync(tmpPath, bytes);

    try {
      const db = new Database(tmpPath, { readonly: true });
      // Sanity-check that this is really a collection.
      db.prepare("SELECT COUNT(*) AS c FROM notes").get();
      return { db, tmpPath, schema: name };
    } catch {
      try {
        fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  throw new Error(
    "No readable Anki collection inside that file. Is it really an .apkg export?",
  );
}

/** Deck id -> deck name, across both the JSON and the split-table layouts. */
function readDeckNames(db: Database.Database): Map<number, string> {
  const names = new Map<number, string>();

  // Modern: a real `decks` table.
  try {
    const rows = db.prepare("SELECT id, name FROM decks").all() as {
      id: number;
      name: string;
    }[];
    for (const r of rows) names.set(Number(r.id), r.name);
    if (names.size > 0) return names;
  } catch {
    /* older schema — fall through */
  }

  // Legacy: a JSON blob in `col.decks`.
  try {
    const row = db.prepare("SELECT decks FROM col LIMIT 1").get() as
      | { decks: string }
      | undefined;
    if (row?.decks) {
      const parsed = JSON.parse(row.decks) as Record<
        string,
        { name?: string }
      >;
      for (const [id, deck] of Object.entries(parsed)) {
        if (deck?.name) names.set(Number(id), deck.name);
      }
    }
  } catch {
    /* leave empty; callers fall back to a default deck name */
  }
  return names;
}

export function readApkg(buffer: Buffer): AnkiPackage {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("That file isn't a valid .apkg (it isn't a readable zip).");
  }

  const { db, tmpPath, schema } = openCollection(files);

  try {
    const deckNames = readDeckNames(db);

    // A note has no deck of its own; its cards do. First card wins.
    const deckByNote = new Map<number, string>();
    try {
      const rows = db
        .prepare("SELECT nid, did FROM cards ORDER BY ord")
        .all() as { nid: number; did: number }[];
      for (const r of rows) {
        if (!deckByNote.has(Number(r.nid))) {
          deckByNote.set(
            Number(r.nid),
            deckNames.get(Number(r.did)) ?? "Imported",
          );
        }
      }
    } catch {
      /* a note-only export is still importable */
    }

    const noteRows = db
      .prepare("SELECT id, flds, tags FROM notes")
      .all() as { id: number; flds: string; tags: string }[];

    const notes: AnkiNote[] = [];
    const neededMedia = new Set<string>();
    let skipped = 0;

    for (const row of noteRows) {
      // Anki separates fields with the unit-separator character.
      const rawFields = (row.flds ?? "").split("\x1f");
      const media: string[] = [];
      const mediaByField: string[][] = [];

      const fields = rawFields.map((f) => {
        const { text, files: refs } = extractMediaRefs(f ?? "");
        mediaByField.push(refs);
        for (const r of refs) {
          media.push(r);
          neededMedia.add(r);
        }
        return flattenHtml(text);
      });

      // A note with no text and no media carries nothing across.
      if (fields.every((f) => !f) && media.length === 0) {
        skipped++;
        continue;
      }

      notes.push({
        deck: deckByNote.get(Number(row.id)) ?? "Imported",
        fields,
        tags: (row.tags ?? "")
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean),
        media,
        mediaByField,
      });
    }

    // ---- Media -----------------------------------------------------------
    const media = new Map<string, Uint8Array>();
    const manifest = files["media"];
    if (manifest && neededMedia.size > 0) {
      let nameByIndex: string[] = [];

      // Legacy manifest is JSON: {"0": "cat.jpg"}. Modern is protobuf.
      try {
        const parsed = JSON.parse(new TextDecoder().decode(manifest)) as Record<
          string,
          string
        >;
        const entries = Object.entries(parsed);
        nameByIndex = [];
        for (const [idx, name] of entries) nameByIndex[Number(idx)] = name;
      } catch {
        nameByIndex = parseMediaProto(manifest);
      }

      nameByIndex.forEach((name, index) => {
        if (!name || !neededMedia.has(name)) return;
        const blob = files[String(index)];
        if (!blob) return;
        let bytes = blob;
        // Scheme 18 compresses each media file individually.
        try {
          bytes = new Uint8Array(zstdDecompressSync(Buffer.from(blob)));
        } catch {
          /* not compressed — use the raw bytes */
        }
        media.set(name, bytes);
      });
    }

    // ---- Deck summaries --------------------------------------------------
    const byDeck = new Map<string, AnkiNote[]>();
    for (const n of notes) {
      const list = byDeck.get(n.deck) ?? [];
      list.push(n);
      byDeck.set(n.deck, list);
    }

    const decks: AnkiDeckSummary[] = [...byDeck.entries()]
      .map(([name, list]) => {
        const { course, chapter } = splitDeckName(name);
        return {
          name: name.replace(/\x1f/g, "::"),
          course,
          chapter,
          notes: list.length,
          clozeNotes: list.filter((n) => /\{\{c\d+::/.test(n.fields[0] ?? ""))
            .length,
          sampleFront: (list[0]?.fields[0] ?? "").slice(0, 120),
          sampleBack: (list[0]?.fields[1] ?? "").slice(0, 120),
        };
      })
      .sort((a, b) => b.notes - a.notes);

    return {
      decks,
      notes,
      media,
      totalNotes: notes.length,
      skipped,
      schema,
    };
  } finally {
    db.close();
    try {
      fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Turn a note's fields into front/back/notes.
 * Extra fields beyond the first two are kept rather than dropped — they are
 * usually the "Extra"/"Source" fields people rely on.
 */
export function noteToCard(note: AnkiNote): {
  front: string;
  back: string;
  notes: string;
} {
  const [first = "", second = "", ...rest] = note.fields;
  const extras = rest.filter(Boolean);
  return {
    front: first,
    back: second,
    notes: extras.join("\n\n"),
  };
}
