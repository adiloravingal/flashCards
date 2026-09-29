import { clozeIndices, hasCloze } from "./cloze";
import { getDb, getSettings, newId, now } from "./db";
import { mediaUrlFor } from "./mediaStore";
import { logEvent, type Actor } from "./log";
import { applyRating, freshState, stateFromRow } from "./scheduler";
import type {
  Card,
  CardMediaRef,
  CardRow,
  CardType,
  Chapter,
  Counts,
  Course,
  Rating,
  ReviewMode,
  ReviewScope,
} from "./types";

/* ==========================================================================
 * Helpers
 * ========================================================================== */

const parseTags = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const normaliseTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const v = t.trim().toLowerCase().replace(/\s+/g, "-");
    if (v) seen.add(v);
  }
  return [...seen].slice(0, 30);
};

function mediaFor(cardIds: string[]): Map<string, CardMediaRef[]> {
  const map = new Map<string, CardMediaRef[]>();
  if (cardIds.length === 0) return map;
  const placeholders = cardIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT cm.card_id, cm.side, cm.position, m.*
         FROM card_media cm
         JOIN media m ON m.id = cm.media_id
        WHERE cm.card_id IN (${placeholders})
        ORDER BY cm.side, cm.position`,
    )
    .all(...cardIds) as (CardMediaRef & { card_id: string })[];

  for (const r of rows) {
    const { card_id, ...rest } = r;
    const ref: CardMediaRef = {
      ...rest,
      url: mediaUrlFor(rest.filename, rest.id),
    } as CardMediaRef;
    const list = map.get(card_id) ?? [];
    list.push(ref);
    map.set(card_id, list);
  }
  return map;
}

export function hydrate(rows: CardRow[]): Card[] {
  const media = mediaFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    tags: parseTags(r.tags),
    media: media.get(r.id) ?? [],
  }));
}

/* ==========================================================================
 * Courses
 * ========================================================================== */

export function listCourses(includeArchived = false) {
  const db = getDb();
  const courses = db
    .prepare(
      `SELECT * FROM courses ${includeArchived ? "" : "WHERE archived = 0"}
       ORDER BY position, created_at`,
    )
    .all() as Course[];

  const stats = db
    .prepare(
      `SELECT ch.course_id AS cid,
              COUNT(c.id) AS total,
              SUM(CASE WHEN c.suspended = 0 AND c.state = 0 THEN 1 ELSE 0 END) AS newc,
              SUM(CASE WHEN c.suspended = 0 AND c.state != 0 AND c.due <= ? THEN 1 ELSE 0 END) AS duec
         FROM chapters ch
         LEFT JOIN cards c ON c.chapter_id = ch.id
        GROUP BY ch.course_id`,
    )
    .all(now()) as { cid: string; total: number; newc: number; duec: number }[];

  const byId = new Map(stats.map((s) => [s.cid, s]));
  return courses.map((c) => {
    const s = byId.get(c.id);
    return {
      ...c,
      totalCards: s?.total ?? 0,
      newCards: s?.newc ?? 0,
      dueCards: s?.duec ?? 0,
    };
  });
}

export function getCourse(id: string): Course | undefined {
  return getDb().prepare("SELECT * FROM courses WHERE id = ?").get(id) as
    | Course
    | undefined;
}

export function createCourse(
  input: {
    name: string;
    description?: string;
    emoji?: string;
    color?: string;
  },
  actor: Actor,
): Course {
  const db = getDb();
  const id = newId();
  const ts = now();
  const pos =
    ((db.prepare("SELECT MAX(position) AS m FROM courses").get() as {
      m: number | null;
    }).m ?? -1) + 1;

  db.prepare(
    `INSERT INTO courses (id, name, description, emoji, color, position, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    input.name.trim() || "Untitled course",
    input.description ?? "",
    input.emoji ?? "",
    input.color ?? "violet",
    pos,
    ts,
    ts,
  );

  logEvent({
    actor,
    action: "course.create",
    entityType: "course",
    entityId: id,
    summary: `Created course “${input.name}”`,
  });
  return getCourse(id)!;
}

export function updateCourse(
  id: string,
  patch: Partial<Pick<Course, "name" | "description" | "emoji" | "color" | "position" | "archived">>,
  actor: Actor,
): Course | undefined {
  const existing = getCourse(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const params: unknown[] = [];
  for (const k of ["name", "description", "emoji", "color", "position", "archived"] as const) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(patch[k]);
    }
  }
  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  params.push(now(), id);
  getDb().prepare(`UPDATE courses SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  logEvent({
    actor,
    action: "course.update",
    entityType: "course",
    entityId: id,
    summary: `Updated course “${existing.name}”`,
    meta: patch as Record<string, unknown>,
  });
  return getCourse(id);
}

export function deleteCourse(id: string, actor: Actor): boolean {
  const existing = getCourse(id);
  if (!existing) return false;
  const cards = countCardsInScope({ kind: "course", id });
  getDb().prepare("DELETE FROM courses WHERE id = ?").run(id);
  logEvent({
    actor,
    action: "course.delete",
    level: "warn",
    entityType: "course",
    entityId: id,
    summary: `Deleted course “${existing.name}” and ${cards.total} card(s)`,
  });
  return true;
}

/* ==========================================================================
 * Chapters
 * ========================================================================== */

export function listChapters(courseId: string, includeArchived = false) {
  const db = getDb();
  const chapters = db
    .prepare(
      `SELECT * FROM chapters
        WHERE course_id = ? ${includeArchived ? "" : "AND archived = 0"}
        ORDER BY position, created_at`,
    )
    .all(courseId) as Chapter[];

  const stats = db
    .prepare(
      `SELECT chapter_id AS cid,
              COUNT(*) AS total,
              SUM(CASE WHEN suspended = 0 AND state = 0 THEN 1 ELSE 0 END) AS newc,
              SUM(CASE WHEN suspended = 0 AND state != 0 AND due <= ? THEN 1 ELSE 0 END) AS duec
         FROM cards GROUP BY chapter_id`,
    )
    .all(now()) as { cid: string; total: number; newc: number; duec: number }[];

  const byId = new Map(stats.map((s) => [s.cid, s]));
  return chapters.map((ch) => {
    const s = byId.get(ch.id);
    return {
      ...ch,
      totalCards: s?.total ?? 0,
      newCards: s?.newc ?? 0,
      dueCards: s?.duec ?? 0,
    };
  });
}

export function getChapter(id: string): Chapter | undefined {
  return getDb().prepare("SELECT * FROM chapters WHERE id = ?").get(id) as
    | Chapter
    | undefined;
}

export function createChapter(
  input: { courseId: string; name: string; description?: string },
  actor: Actor,
): Chapter | undefined {
  if (!getCourse(input.courseId)) return undefined;
  const db = getDb();
  const id = newId();
  const ts = now();
  const pos =
    ((db
      .prepare("SELECT MAX(position) AS m FROM chapters WHERE course_id = ?")
      .get(input.courseId) as { m: number | null }).m ?? -1) + 1;

  db.prepare(
    `INSERT INTO chapters (id, course_id, name, description, position, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, input.courseId, input.name.trim() || "Untitled chapter", input.description ?? "", pos, ts, ts);

  logEvent({
    actor,
    action: "chapter.create",
    entityType: "chapter",
    entityId: id,
    summary: `Created chapter “${input.name}”`,
  });
  return getChapter(id);
}

export function updateChapter(
  id: string,
  patch: Partial<Pick<Chapter, "name" | "description" | "position" | "archived" | "course_id">>,
  actor: Actor,
): Chapter | undefined {
  const existing = getChapter(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const params: unknown[] = [];
  for (const k of ["name", "description", "position", "archived", "course_id"] as const) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(patch[k]);
    }
  }
  if (fields.length === 0) return existing;
  fields.push("updated_at = ?");
  params.push(now(), id);
  getDb().prepare(`UPDATE chapters SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  logEvent({
    actor,
    action: "chapter.update",
    entityType: "chapter",
    entityId: id,
    summary: `Updated chapter “${existing.name}”`,
    meta: patch as Record<string, unknown>,
  });
  return getChapter(id);
}

export function deleteChapter(id: string, actor: Actor): boolean {
  const existing = getChapter(id);
  if (!existing) return false;
  const cards = countCardsInScope({ kind: "chapter", id });
  getDb().prepare("DELETE FROM chapters WHERE id = ?").run(id);
  logEvent({
    actor,
    action: "chapter.delete",
    level: "warn",
    entityType: "chapter",
    entityId: id,
    summary: `Deleted chapter “${existing.name}” and ${cards.total} card(s)`,
  });
  return true;
}

/* ==========================================================================
 * Cards
 * ========================================================================== */

export interface CardInput {
  chapterId: string;
  front: string;
  back: string;
  hint?: string;
  notes?: string;
  tags?: string[];
  starred?: boolean;
  suspended?: boolean;
  cardType?: CardType;
  mediaIds?: { id: string; side?: "front" | "back" }[];
}

/**
 * Decide how many cards one authored note becomes.
 * `cardType` is respected when given; otherwise cloze markup in the front is
 * enough to opt in, so writing `{{c1::…}}` just works without a mode switch.
 */
function planNote(input: CardInput): { type: CardType; indices: number[] } {
  const wantsCloze =
    input.cardType === "cloze" ||
    (input.cardType !== "basic" && hasCloze(input.front));
  if (!wantsCloze) return { type: "basic", indices: [] };

  const indices = clozeIndices(input.front);
  // `cardType: "cloze"` with no deletions written yet would otherwise create
  // zero cards and silently swallow the note.
  if (indices.length === 0) return { type: "basic", indices: [] };
  return { type: "cloze", indices };
}

export function createCards(
  inputs: CardInput[],
  actor: Actor,
  source = "manual",
): Card[] {
  const db = getDb();
  const ts = now();

  const insert = db.prepare(
    `INSERT INTO cards (id, chapter_id, front, back, hint, notes, tags, starred, suspended,
                        source, position, due, stability, difficulty, elapsed_days, scheduled_days,
                        learning_steps, reps, lapses, state, last_review, created_at, updated_at,
                        card_type, note_id, cloze_index)
     VALUES (@id, @chapter_id, @front, @back, @hint, @notes, @tags, @starred, @suspended,
             @source, @position, @due, @stability, @difficulty, @elapsed_days, @scheduled_days,
             @learning_steps, @reps, @lapses, @state, @last_review, @created_at, @updated_at,
             @card_type, @note_id, @cloze_index)`,
  );
  const attach = db.prepare(
    `INSERT INTO card_media (id, card_id, media_id, side, position) VALUES (?, ?, ?, ?, ?)`,
  );
  const nextPos = db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM cards WHERE chapter_id = ?",
  );

  const ids: string[] = [];
  const tx = db.transaction(() => {
    const posCache = new Map<string, number>();
    for (const input of inputs) {
      if (!getChapter(input.chapterId)) continue;

      const { type, indices } = planNote(input);
      const noteId = newId();
      // A basic note is just a cloze note with a single, index-less card.
      const slots: (number | null)[] = type === "cloze" ? indices : [null];

      for (const clozeIndex of slots) {
        const id = newId();
        const s = freshState(ts);

        let pos = posCache.get(input.chapterId);
        if (pos === undefined) {
          pos = (nextPos.get(input.chapterId) as { p: number }).p;
        }
        posCache.set(input.chapterId, pos + 1);

        insert.run({
          id,
          chapter_id: input.chapterId,
          front: input.front ?? "",
          back: input.back ?? "",
          hint: input.hint ?? "",
          notes: input.notes ?? "",
          tags: JSON.stringify(normaliseTags(input.tags)),
          starred: input.starred ? 1 : 0,
          suspended: input.suspended ? 1 : 0,
          source,
          position: pos,
          ...s,
          created_at: ts,
          updated_at: ts,
          card_type: type,
          note_id: type === "cloze" ? noteId : id,
          cloze_index: clozeIndex,
        });

        // Media belongs to the note, so every sibling shows it.
        let mp = 0;
        for (const m of input.mediaIds ?? []) {
          attach.run(newId(), id, m.id, m.side ?? "front", mp++);
        }
        ids.push(id);
      }
    }
  });
  tx();

  logEvent({
    actor,
    action: "card.create",
    entityType: "card",
    entityId: ids.length === 1 ? ids[0] : null,
    summary:
      ids.length === 1
        ? `Created card “${truncate(inputs[0]?.front ?? "")}”`
        : `Created ${ids.length} cards`,
    meta: { count: ids.length, source },
  });

  return getCardsByIds(ids);
}

const truncate = (s: string, n = 60) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

export function getCardsByIds(ids: string[]): Card[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`)
    .all(...ids) as CardRow[];
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return hydrate(rows);
}

export function getCard(id: string): Card | undefined {
  return getCardsByIds([id])[0];
}

export function updateCard(
  id: string,
  patch: Partial<CardInput> & { position?: number },
  actor: Actor,
): Card | undefined {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as
    | CardRow
    | undefined;
  if (!existing) return undefined;

  // Editing shared text on a cloze note has to fan out across its siblings,
  // and adding or removing a deletion changes how many cards exist.
  if (existing.card_type === "cloze" || (patch.front && hasCloze(patch.front))) {
    return updateClozeNote(existing, patch, actor);
  }

  const fields: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    fields.push(`${col} = ?`);
    params.push(val);
  };

  if (patch.front !== undefined) push("front", patch.front);
  if (patch.back !== undefined) push("back", patch.back);
  if (patch.hint !== undefined) push("hint", patch.hint);
  if (patch.notes !== undefined) push("notes", patch.notes);
  if (patch.tags !== undefined) push("tags", JSON.stringify(normaliseTags(patch.tags)));
  if (patch.starred !== undefined) push("starred", patch.starred ? 1 : 0);
  if (patch.suspended !== undefined) push("suspended", patch.suspended ? 1 : 0);
  if (patch.position !== undefined) push("position", patch.position);
  if (patch.chapterId !== undefined && getChapter(patch.chapterId)) {
    push("chapter_id", patch.chapterId);
  }

  const tx = db.transaction(() => {
    if (fields.length) {
      push("updated_at", now());
      params.push(id);
      db.prepare(`UPDATE cards SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    }
    if (patch.mediaIds !== undefined) {
      db.prepare("DELETE FROM card_media WHERE card_id = ?").run(id);
      const attach = db.prepare(
        "INSERT INTO card_media (id, card_id, media_id, side, position) VALUES (?, ?, ?, ?, ?)",
      );
      let p = 0;
      for (const m of patch.mediaIds) attach.run(newId(), id, m.id, m.side ?? "front", p++);
    }
  });
  tx();

  logEvent({
    actor,
    action: "card.update",
    entityType: "card",
    entityId: id,
    summary: `Edited card “${truncate(patch.front ?? existing.front)}”`,
  });
  return getCard(id);
}

/**
 * Apply an edit to every card of a cloze note.
 *
 * The rule that matters: a deletion index that still exists keeps its card,
 * and therefore its schedule. Rewriting a typo in c1 must not cost you the
 * three months of review history attached to c2.
 */
function updateClozeNote(
  existing: CardRow,
  patch: Partial<CardInput> & { position?: number },
  actor: Actor,
): Card | undefined {
  const db = getDb();
  const ts = now();
  const noteId = existing.note_id || existing.id;

  const front = patch.front ?? existing.front;
  const indices = clozeIndices(front);

  const siblings = db
    .prepare("SELECT * FROM cards WHERE note_id = ? ORDER BY cloze_index")
    .all(noteId) as CardRow[];

  const shared = {
    front,
    back: patch.back ?? existing.back,
    hint: patch.hint ?? existing.hint,
    notes: patch.notes ?? existing.notes,
    tags:
      patch.tags !== undefined
        ? JSON.stringify(normaliseTags(patch.tags))
        : existing.tags,
    starred:
      patch.starred !== undefined ? (patch.starred ? 1 : 0) : existing.starred,
    suspended:
      patch.suspended !== undefined
        ? patch.suspended
          ? 1
          : 0
        : existing.suspended,
    chapter_id:
      patch.chapterId && getChapter(patch.chapterId)
        ? patch.chapterId
        : existing.chapter_id,
  };

  const setShared = db.prepare(
    `UPDATE cards SET front = @front, back = @back, hint = @hint, notes = @notes,
            tags = @tags, starred = @starred, suspended = @suspended,
            chapter_id = @chapter_id, card_type = @card_type,
            cloze_index = @cloze_index, updated_at = @updated_at
      WHERE id = @id`,
  );

  const tx = db.transaction(() => {
    // All deletions removed: collapse the note back to a single basic card,
    // keeping the oldest sibling so its history survives.
    if (indices.length === 0) {
      const keeper = siblings[0] ?? existing;
      setShared.run({
        ...shared,
        card_type: "basic",
        cloze_index: null,
        updated_at: ts,
        id: keeper.id,
      });
      db.prepare("UPDATE cards SET note_id = id WHERE id = ?").run(keeper.id);
      for (const s of siblings) {
        if (s.id !== keeper.id)
          db.prepare("DELETE FROM cards WHERE id = ?").run(s.id);
      }
      return;
    }

    const byIndex = new Map(siblings.map((s) => [s.cloze_index, s]));

    for (const idx of indices) {
      const match = byIndex.get(idx);
      if (match) {
        setShared.run({
          ...shared,
          card_type: "cloze",
          cloze_index: idx,
          updated_at: ts,
          id: match.id,
        });
      } else {
        // A newly written deletion starts fresh, as an unseen card should.
        const s = freshState(ts);
        db.prepare(
          `INSERT INTO cards (id, chapter_id, front, back, hint, notes, tags, starred, suspended,
                              source, position, due, stability, difficulty, elapsed_days, scheduled_days,
                              learning_steps, reps, lapses, state, last_review, created_at, updated_at,
                              card_type, note_id, cloze_index)
           VALUES (@id, @chapter_id, @front, @back, @hint, @notes, @tags, @starred, @suspended,
                   @source, @position, @due, @stability, @difficulty, @elapsed_days, @scheduled_days,
                   @learning_steps, @reps, @lapses, @state, @last_review, @created_at, @updated_at,
                   'cloze', @note_id, @cloze_index)`,
        ).run({
          id: newId(),
          ...shared,
          source: existing.source,
          position: existing.position,
          ...s,
          created_at: ts,
          updated_at: ts,
          note_id: noteId,
          cloze_index: idx,
        });
      }
    }

    // Deletions the user removed: their cards no longer have anything to ask.
    for (const s of siblings) {
      if (s.cloze_index !== null && !indices.includes(s.cloze_index)) {
        db.prepare("DELETE FROM cards WHERE id = ?").run(s.id);
      }
    }

    // Make sure the edited card is part of the note group even if it was
    // previously a basic card that just gained cloze markup.
    db.prepare("UPDATE cards SET note_id = ? WHERE id = ?").run(
      noteId,
      existing.id,
    );

    if (patch.mediaIds !== undefined) {
      const current = db
        .prepare("SELECT id FROM cards WHERE note_id = ?")
        .all(noteId) as { id: string }[];
      const attach = db.prepare(
        "INSERT INTO card_media (id, card_id, media_id, side, position) VALUES (?, ?, ?, ?, ?)",
      );
      for (const c of current) {
        db.prepare("DELETE FROM card_media WHERE card_id = ?").run(c.id);
        let p = 0;
        for (const m of patch.mediaIds) {
          attach.run(newId(), c.id, m.id, m.side ?? "front", p++);
        }
      }
    }
  });
  tx();

  logEvent({
    actor,
    action: "card.update",
    entityType: "card",
    entityId: existing.id,
    summary: `Edited cloze note “${truncate(front)}” (${indices.length} card${
      indices.length === 1 ? "" : "s"
    })`,
  });

  // The edited row may have been deleted if its own deletion was removed;
  // fall back to whatever the note still has.
  return (
    getCard(existing.id) ??
    hydrate(
      db
        .prepare("SELECT * FROM cards WHERE note_id = ? ORDER BY cloze_index LIMIT 1")
        .all(noteId) as CardRow[],
    )[0]
  );
}

export function deleteCard(id: string, actor: Actor): boolean {
  const existing = getDb().prepare("SELECT front FROM cards WHERE id = ?").get(id) as
    | { front: string }
    | undefined;
  if (!existing) return false;
  getDb().prepare("DELETE FROM cards WHERE id = ?").run(id);
  logEvent({
    actor,
    action: "card.delete",
    level: "warn",
    entityType: "card",
    entityId: id,
    summary: `Deleted card “${truncate(existing.front)}”`,
  });
  return true;
}

/** Reset scheduling on a set of cards without touching their content. */
export function resetProgress(scope: ReviewScope, actor: Actor): number {
  const { where, params } = scopeSql(scope);
  const s = freshState();
  const info = getDb()
    .prepare(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
              scheduled_days = ?, learning_steps = ?, reps = 0, lapses = 0,
              state = 0, last_review = NULL, updated_at = ?
        WHERE ${where}`,
    )
    .run(
      s.due,
      s.stability,
      s.difficulty,
      s.elapsed_days,
      s.scheduled_days,
      s.learning_steps,
      now(),
      ...params,
    );
  logEvent({
    actor,
    action: "cards.reset",
    level: "warn",
    summary: `Reset review progress on ${info.changes} card(s)`,
    meta: { scope },
  });
  return info.changes;
}

/* ==========================================================================
 * Scope resolution — one place that turns a ReviewScope into SQL.
 * ========================================================================== */

export function scopeSql(scope: ReviewScope): { where: string; params: unknown[] } {
  switch (scope.kind) {
    case "chapter":
      return { where: "cards.chapter_id = ?", params: [scope.id] };
    case "course":
      return {
        where:
          "cards.chapter_id IN (SELECT id FROM chapters WHERE course_id = ?)",
        params: [scope.id],
      };
    case "starred":
      return { where: "cards.starred = 1", params: [] };
    case "tag":
      return { where: "cards.tags LIKE ?", params: [`%"${scope.tag}"%`] };
    case "all":
    default:
      return { where: "1 = 1", params: [] };
  }
}

export function parseScope(sp: URLSearchParams): ReviewScope {
  const chapterId = sp.get("chapterId");
  if (chapterId) return { kind: "chapter", id: chapterId };
  const courseId = sp.get("courseId");
  if (courseId) return { kind: "course", id: courseId };
  const tag = sp.get("tag");
  if (tag) return { kind: "tag", tag };
  if (sp.get("starred") === "1") return { kind: "starred" };
  return { kind: "all" };
}

export function countCardsInScope(scope: ReviewScope): Counts {
  const { where, params } = scopeSql(scope);
  const t = now();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN suspended = 0 AND state = 0 THEN 1 ELSE 0 END) AS newc,
              SUM(CASE WHEN suspended = 0 AND state != 0 AND due <= ? THEN 1 ELSE 0 END) AS duec,
              SUM(CASE WHEN suspended = 0 AND state IN (1,3) THEN 1 ELSE 0 END) AS learning,
              SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END) AS susp
         FROM cards WHERE ${where}`,
    )
    .get(t, ...params) as {
    total: number;
    newc: number | null;
    duec: number | null;
    learning: number | null;
    susp: number | null;
  };
  return {
    total: row.total ?? 0,
    new: row.newc ?? 0,
    due: row.duec ?? 0,
    learning: row.learning ?? 0,
    suspended: row.susp ?? 0,
  };
}

/* ==========================================================================
 * Review queue
 * ========================================================================== */

export const localDay = (ts: number = now()): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function newCardsIntroducedToday(): number {
  const row = getDb()
    .prepare("SELECT new_cards FROM daily_stats WHERE day = ?")
    .get(localDay()) as { new_cards: number } | undefined;
  return row?.new_cards ?? 0;
}

/**
 * Build the list of cards to study.
 *
 * Ordering matters for motivation: due cards first (they are the promise you
 * made yesterday), with new cards sprinkled through rather than dumped at the
 * end — a wall of unfamiliar cards is where sessions get abandoned.
 */
export function buildQueue(
  scope: ReviewScope,
  mode: ReviewMode,
  limitOverride?: number,
): Card[] {
  const settings = getSettings();
  const limit = Math.max(1, Math.min(limitOverride ?? settings.sessionSize, 500));
  const { where, params } = scopeSql(scope);
  const db = getDb();
  const t = now();

  if (mode === "cram") {
    const rows = db
      .prepare(
        `SELECT * FROM cards WHERE ${where} AND suspended = 0
          ORDER BY RANDOM() LIMIT ?`,
      )
      .all(...params, limit) as CardRow[];
    return hydrate(rows);
  }

  if (mode === "new") {
    const rows = db
      .prepare(
        `SELECT * FROM cards WHERE ${where} AND suspended = 0 AND state = 0
          ORDER BY position, created_at LIMIT ?`,
      )
      .all(...params, limit) as CardRow[];
    return hydrate(rows);
  }

  // mode === "due"
  const dueRows = db
    .prepare(
      `SELECT * FROM cards WHERE ${where} AND suspended = 0 AND state != 0 AND due <= ?
        ORDER BY due ASC LIMIT ?`,
    )
    .all(...params, t, limit) as CardRow[];

  const newAllowance = Math.max(0, settings.newPerDay - newCardsIntroducedToday());
  const roomLeft = Math.max(0, limit - dueRows.length);
  const newTake = Math.min(newAllowance, roomLeft);

  const newRows =
    newTake > 0
      ? (db
          .prepare(
            `SELECT * FROM cards WHERE ${where} AND suspended = 0 AND state = 0
              ORDER BY position, created_at LIMIT ?`,
          )
          .all(...params, newTake) as CardRow[])
      : [];

  return hydrate(interleave(dueRows, newRows));
}

/** Spread `b` evenly through `a` instead of appending it. */
function interleave<T>(a: T[], b: T[]): T[] {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const out: T[] = [];
  const every = a.length / b.length;
  let bi = 0;
  for (let i = 0; i < a.length; i++) {
    out.push(a[i]);
    while (bi < b.length && (bi + 1) * every <= i + 1) out.push(b[bi++]);
  }
  while (bi < b.length) out.push(b[bi++]);
  return out;
}

/* ==========================================================================
 * Answering
 * ========================================================================== */

export interface AnswerResult {
  card: Card;
  reviewId: string;
  nextDue: number;
  intervalMs: number;
}

export function answerCard(
  cardId: string,
  rating: Rating,
  opts: { durationMs?: number; sessionId?: string; cram?: boolean },
  actor: Actor,
): AnswerResult | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as
    | CardRow
    | undefined;
  if (!row) return undefined;

  const settings = getSettings();
  const t = now();
  const prev = stateFromRow(row);
  const wasNew = row.state === 0;
  const reviewId = newId();

  // Cram reviews are practice: they count towards your daily activity but must
  // not disturb the real schedule.
  const next = opts.cram ? prev : applyRating(prev, rating, t, settings.targetRetention);

  const tx = db.transaction(() => {
    if (!opts.cram) {
      db.prepare(
        `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
                scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
                state = ?, last_review = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        next.due,
        next.stability,
        next.difficulty,
        next.elapsed_days,
        next.scheduled_days,
        next.learning_steps,
        next.reps,
        next.lapses,
        next.state,
        t,
        t,
        cardId,
      );
    }

    db.prepare(
      `INSERT INTO review_log (id, card_id, reviewed_at, rating, duration_ms, session_id,
                               prev_due, prev_stability, prev_difficulty, prev_elapsed_days,
                               prev_scheduled_days, prev_learning_steps, prev_reps, prev_lapses,
                               prev_state, prev_last_review, undone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      reviewId,
      cardId,
      t,
      rating,
      Math.max(0, Math.min(opts.durationMs ?? 0, 3_600_000)),
      opts.sessionId ?? null,
      prev.due,
      prev.stability,
      prev.difficulty,
      prev.elapsed_days,
      prev.scheduled_days,
      prev.learning_steps,
      prev.reps,
      prev.lapses,
      prev.state,
      prev.last_review,
    );

    bumpDailyStats(rating, wasNew && !opts.cram, opts.durationMs ?? 0);
  });
  tx();

  return {
    card: getCard(cardId)!,
    reviewId,
    nextDue: next.due,
    intervalMs: next.due - t,
  };
}

function bumpDailyStats(rating: Rating, wasNew: boolean, ms: number) {
  const col = (["", "again", "hard", "good", "easy"] as const)[rating];
  getDb()
    .prepare(
      `INSERT INTO daily_stats (day, reviews, again, hard, good, easy, new_cards, ms_spent)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         reviews   = reviews + 1,
         ${col}    = ${col} + 1,
         new_cards = new_cards + ?,
         ms_spent  = ms_spent + ?`,
    )
    .run(
      localDay(),
      rating === 1 ? 1 : 0,
      rating === 2 ? 1 : 0,
      rating === 3 ? 1 : 0,
      rating === 4 ? 1 : 0,
      wasNew ? 1 : 0,
      ms,
      wasNew ? 1 : 0,
      ms,
    );
}

/**
 * Undo the most recent answer, restoring the card exactly as it was.
 * Misclicking "Easy" on a card you actually forgot is the single most common
 * way a schedule gets poisoned, so this is a first-class action, not a setting.
 */
export function undoLastReview(
  sessionId: string | undefined,
  actor: Actor,
): Card | undefined {
  const db = getDb();
  const log = db
    .prepare(
      `SELECT * FROM review_log
        WHERE undone = 0 ${sessionId ? "AND session_id = ?" : ""}
        ORDER BY reviewed_at DESC LIMIT 1`,
    )
    .get(...(sessionId ? [sessionId] : [])) as
    | (Record<string, number | string | null> & { id: string; card_id: string })
    | undefined;
  if (!log) return undefined;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
              scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
              state = ?, last_review = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      log.prev_due,
      log.prev_stability,
      log.prev_difficulty,
      log.prev_elapsed_days,
      log.prev_scheduled_days,
      log.prev_learning_steps,
      log.prev_reps,
      log.prev_lapses,
      log.prev_state,
      log.prev_last_review,
      now(),
      log.card_id,
    );
    db.prepare("UPDATE review_log SET undone = 1 WHERE id = ?").run(log.id);

    const day = localDay(log.reviewed_at as number);
    const col = (["", "again", "hard", "good", "easy"] as const)[
      log.rating as Rating
    ];
    db.prepare(
      `UPDATE daily_stats SET reviews = MAX(0, reviews - 1),
              ${col} = MAX(0, ${col} - 1),
              new_cards = MAX(0, new_cards - ?)
        WHERE day = ?`,
    ).run(log.prev_state === 0 ? 1 : 0, day);
  });
  tx();

  logEvent({
    actor,
    action: "review.undo",
    entityType: "card",
    entityId: log.card_id,
    summary: "Undid last answer",
  });
  return getCard(log.card_id);
}

/* ==========================================================================
 * Search
 * ========================================================================== */

export function searchCards(query: string, limit = 50): Card[] {
  const q = query.trim();
  if (!q) return [];
  const db = getDb();

  // FTS5 needs a sanitised query; fall back to LIKE if the user types
  // something the parser rejects (stray quotes, lone operators, …).
  const ftsQuery = q
    .split(/\s+/)
    .map((tok) => tok.replace(/["*()]/g, ""))
    .filter(Boolean)
    .map((tok) => `"${tok}"*`)
    .join(" AND ");

  if (ftsQuery) {
    try {
      const rows = db
        .prepare(
          `SELECT cards.* FROM cards_fts
             JOIN cards ON cards.rowid = cards_fts.rowid
            WHERE cards_fts MATCH ?
            ORDER BY rank LIMIT ?`,
        )
        .all(ftsQuery, limit) as CardRow[];
      return hydrate(rows);
    } catch {
      /* fall through to LIKE */
    }
  }

  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT * FROM cards
        WHERE front LIKE ? OR back LIKE ? OR notes LIKE ? OR tags LIKE ?
        ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(like, like, like, like, limit) as CardRow[];
  return hydrate(rows);
}

export function listAllTags(): { tag: string; count: number }[] {
  const rows = getDb().prepare("SELECT tags FROM cards").all() as {
    tags: string;
  }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of parseTags(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/* ==========================================================================
 * Stats
 * ========================================================================== */

export function getStats() {
  const db = getDb();
  const t = now();
  const overall = countCardsInScope({ kind: "all" });

  const days = db
    .prepare("SELECT * FROM daily_stats ORDER BY day DESC LIMIT 365")
    .all() as {
    day: string;
    reviews: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
    new_cards: number;
    ms_spent: number;
  }[];

  const byDay = new Map(days.map((d) => [d.day, d]));
  const today = byDay.get(localDay());

  // Streak: consecutive days ending today (or yesterday, if today is untouched
  // — you shouldn't "lose" your streak at 00:01).
  let streak = 0;
  const cursor = new Date();
  if (!today || today.reviews === 0) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const key = localDay(cursor.getTime());
    const d = byDay.get(key);
    if (!d || d.reviews === 0) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Upcoming workload for the next 14 days.
  const forecast: { day: string; count: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM cards
          WHERE suspended = 0 AND state != 0 AND due >= ? AND due < ?`,
      )
      .get(i === 0 ? 0 : start.getTime(), end.getTime()) as { c: number };
    forecast.push({ day: localDay(start.getTime()), count: row.c });
  }

  const retention = db
    .prepare(
      `SELECT
         SUM(CASE WHEN rating > 1 THEN 1 ELSE 0 END) AS good,
         COUNT(*) AS total
       FROM review_log
       WHERE undone = 0 AND prev_state = 2 AND reviewed_at > ?`,
    )
    .get(t - 30 * 86_400_000) as { good: number | null; total: number };

  const hardest = db
    .prepare(
      `SELECT * FROM cards
        WHERE lapses > 0 AND suspended = 0
        ORDER BY lapses DESC, difficulty DESC LIMIT 10`,
    )
    .all() as CardRow[];

  return {
    counts: overall,
    today: today ?? {
      day: localDay(),
      reviews: 0,
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
      new_cards: 0,
      ms_spent: 0,
    },
    streak,
    history: days.slice().reverse(),
    forecast,
    retention30d:
      retention.total > 0 ? (retention.good ?? 0) / retention.total : null,
    hardestCards: hydrate(hardest),
    totalReviews: (
      db.prepare("SELECT COUNT(*) AS c FROM review_log WHERE undone = 0").get() as {
        c: number;
      }
    ).c,
  };
}
