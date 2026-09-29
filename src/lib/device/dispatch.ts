import { getSettings, setSettings } from "../db";
import { buildBackup, readBackup, restoreBackup } from "../backup";
import { buildDeckZip, countCards, deckFilename, readDeckZip } from "../deck";
import { parseAnySpreadsheet } from "../importer";
import { queryLogs, type Actor, type LogLevel } from "../log";
import { saveUpload } from "../media";
import {
  answerCard, buildQueue, countCardsInScope, createCards, createChapter,
  createCourse, deleteCard, deleteChapter, deleteCourse, getCard, getChapter,
  getCourse, hydrate, listAllTags, listChapters, listCourses, parseScope,
  resetProgress, scopeSql, searchCards, getStats, undoLastReview, updateCard,
  updateChapter, updateCourse, type CardInput,
} from "../repo";
import { getDb } from "../db";
import { buildPeriod, type PeriodUnit } from "../periods";
import { humanInterval, previewIntervals, stateFromRow } from "../scheduler";
import type { CardRow, ReviewMode } from "../types";
import { mediaStore } from "../mediaStore";
import { markDirty } from "./db-browser";
import { stageDevice, readDeviceStaged, discardDeviceStaged } from "./staging-memory";

/**
 * The API, without the network.
 *
 * On a server the UI talks to route handlers over HTTP. On a device there is
 * no server, so this answers the same paths with the same `{ ok, data }`
 * shapes and returns real `Response` objects — which means `api()` and the
 * handful of raw `fetch()` callers keep working untouched.
 *
 * Everything below calls the same `repo.ts` the server does. This file is
 * plumbing, not a second implementation of the app.
 */

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ACTOR: Actor = "you";

const intParam = (sp: URLSearchParams, name: string, fallback: number, min: number, max: number) => {
  const raw = Number(sp.get(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), min), max);
};

/** Any write goes through here so the database gets saved shortly after. */
function mutated<T>(value: T): T {
  markDirty();
  return value;
}

export async function dispatch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, "http://device.local");
  const route = url.pathname.replace(/^\/api\/v1/, "");
  const sp = url.searchParams;
  const method = (init?.method ?? "GET").toUpperCase();

  const json = async <T>(): Promise<T> =>
    typeof init?.body === "string" ? (JSON.parse(init.body) as T) : ({} as T);
  const form = async (): Promise<FormData> =>
    init?.body instanceof FormData ? init.body : new FormData();

  try {
    /* ---------------- courses ---------------- */
    if (route === "/courses" && method === "GET") return ok(listCourses(sp.get("includeArchived") === "1"));
    if (route === "/courses" && method === "POST")
      return ok(mutated(createCourse(await json(), ACTOR)), 201);

    const courseMatch = /^\/courses\/([^/]+)$/.exec(route);
    if (courseMatch) {
      const id = courseMatch[1];
      if (method === "GET") {
        const course = getCourse(id);
        if (!course) return fail(404, "not_found", "No course with that id.");
        return ok({ ...course, chapters: listChapters(id, true), counts: countCardsInScope({ kind: "course", id }) });
      }
      if (method === "PATCH") {
        const updated = updateCourse(id, await json(), ACTOR);
        return updated ? ok(mutated(updated)) : fail(404, "not_found", "No course with that id.");
      }
      if (method === "DELETE")
        return deleteCourse(id, ACTOR) ? ok(mutated({ deleted: id })) : fail(404, "not_found", "No course with that id.");
    }

    /* ---------------- chapters ---------------- */
    if (route === "/chapters" && method === "GET") {
      const courseId = sp.get("courseId");
      return courseId ? ok(listChapters(courseId)) : fail(400, "missing_param", "Pass ?courseId=.");
    }
    if (route === "/chapters" && method === "POST") {
      const chapter = createChapter(await json(), ACTOR);
      return chapter ? ok(mutated(chapter), 201) : fail(404, "not_found", "No course with that id.");
    }
    const chapterMatch = /^\/chapters\/([^/]+)$/.exec(route);
    if (chapterMatch) {
      const id = chapterMatch[1];
      if (method === "GET") {
        const chapter = getChapter(id);
        if (!chapter) return fail(404, "not_found", "No chapter with that id.");
        return ok({ ...chapter, course: getCourse(chapter.course_id) ?? null, counts: countCardsInScope({ kind: "chapter", id }) });
      }
      if (method === "PATCH") {
        const body = await json<Record<string, unknown>>();
        const patch: Record<string, unknown> = { ...body };
        if (body.courseId !== undefined) { patch.course_id = body.courseId; delete patch.courseId; }
        const updated = updateChapter(id, patch, ACTOR);
        return updated ? ok(mutated(updated)) : fail(404, "not_found", "No chapter with that id.");
      }
      if (method === "DELETE")
        return deleteChapter(id, ACTOR) ? ok(mutated({ deleted: id })) : fail(404, "not_found", "No chapter with that id.");
    }

    /* ---------------- cards ---------------- */
    if (route === "/cards" && method === "GET") {
      const scope = parseScope(sp);
      const { where, params } = scopeSql(scope);
      const limit = intParam(sp, "limit", 200, 1, 1000);
      const offset = intParam(sp, "offset", 0, 0, 1_000_000);
      const rows = getDb().prepare(
        `SELECT * FROM cards WHERE ${where} ORDER BY position, created_at LIMIT ? OFFSET ?`,
      ).all(...params, limit, offset) as CardRow[];
      const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM cards WHERE ${where}`).get(...params) as { c: number }).c;
      return ok({ cards: hydrate(rows), total, limit, offset });
    }
    if (route === "/cards" && method === "POST") {
      const body = await json<{ chapterId?: string; courseName?: string; chapterName?: string; cards: CardInput[]; dedupe?: boolean }>();
      let chapterId = body.chapterId;
      if (!chapterId && body.courseName && body.chapterName) {
        const course = listCourses(true).find((c) => c.name.toLowerCase() === body.courseName!.toLowerCase())
          ?? createCourse({ name: body.courseName }, ACTOR);
        chapterId = listChapters(course.id, true).find((c) => c.name.toLowerCase() === body.chapterName!.toLowerCase())?.id
          ?? createChapter({ courseId: course.id, name: body.chapterName }, ACTOR)?.id;
      }
      if (!chapterId || !getChapter(chapterId)) return fail(404, "chapter_not_found", "No chapter with that id.");

      const existing = new Set(
        (getDb().prepare("SELECT front FROM cards WHERE chapter_id = ?").all(chapterId) as { front: string }[])
          .map((r) => r.front.trim().toLowerCase()),
      );
      const dedupe = body.dedupe !== false;
      const accepted = (body.cards ?? []).filter((c) => {
        const front = (c.front ?? "").trim();
        if (!front && !(c.back ?? "").trim() && !c.mediaIds?.length) return false;
        return !(dedupe && front && existing.has(front.toLowerCase()));
      });
      const created = createCards(accepted.map((c) => ({ ...c, chapterId: chapterId! })), ACTOR, "manual");
      return ok(mutated({ created: created.length, skipped: [], chapterId, cards: created }), 201);
    }
    const cardMatch = /^\/cards\/([^/]+)$/.exec(route);
    if (cardMatch) {
      const id = cardMatch[1];
      if (method === "GET") {
        const card = getCard(id);
        return card ? ok(card) : fail(404, "not_found", "No card with that id.");
      }
      if (method === "PATCH") {
        const updated = updateCard(id, await json(), ACTOR);
        return updated ? ok(mutated(updated)) : fail(404, "not_found", "No card with that id.");
      }
      if (method === "DELETE")
        return deleteCard(id, ACTOR) ? ok(mutated({ deleted: id })) : fail(404, "not_found", "No card with that id.");
    }

    /* ---------------- review ---------------- */
    if (route === "/review/queue") {
      const scope = parseScope(sp);
      const raw = sp.get("mode");
      const mode: ReviewMode = raw === "cram" || raw === "new" ? raw : "due";
      const limit = sp.get("limit") ? intParam(sp, "limit", 20, 1, 500) : undefined;
      const settings = getSettings();
      const at = Date.now();
      const cards = buildQueue(scope, mode, limit).map((card) => {
        const intervals = previewIntervals(stateFromRow(card), at, settings.targetRetention);
        return { ...card, preview: { 1: humanInterval(intervals[1]), 2: humanInterval(intervals[2]), 3: humanInterval(intervals[3]), 4: humanInterval(intervals[4]) } };
      });
      return ok({ mode, scope, counts: countCardsInScope(scope), sessionId: `${mode}-${at}`, cards });
    }
    if (route === "/review/answer" && method === "POST") {
      const body = await json<{ cardId: string; rating: 1 | 2 | 3 | 4; durationMs?: number; sessionId?: string; cram?: boolean }>();
      const result = answerCard(body.cardId, body.rating, { durationMs: body.durationMs, sessionId: body.sessionId, cram: body.cram }, ACTOR);
      return result
        ? ok(mutated({ reviewId: result.reviewId, nextDue: result.nextDue, interval: humanInterval(result.intervalMs), card: result.card }))
        : fail(404, "not_found", "No card with that id.");
    }
    if (route === "/review/undo" && method === "POST") {
      const body = await json<{ sessionId?: string }>();
      const card = undoLastReview(body.sessionId, ACTOR);
      return card ? ok(mutated(card)) : fail(404, "nothing_to_undo", "There is no recent answer to undo.");
    }

    /* ---------------- reading ---------------- */
    if (route === "/search") {
      const cards = searchCards(sp.get("q") ?? "", intParam(sp, "limit", 50, 1, 200));
      const chapterIds = [...new Set(cards.map((c) => c.chapter_id))];
      const labels = new Map<string, { courseId: string; course: string; chapter: string }>();
      if (chapterIds.length) {
        const rows = getDb().prepare(
          `SELECT ch.id AS chapter_id, ch.name AS chapter, co.id AS course_id, co.name AS course
             FROM chapters ch JOIN courses co ON co.id = ch.course_id
            WHERE ch.id IN (${chapterIds.map(() => "?").join(",")})`,
        ).all(...chapterIds) as { chapter_id: string; chapter: string; course_id: string; course: string }[];
        for (const r of rows) labels.set(r.chapter_id, { courseId: r.course_id, course: r.course, chapter: r.chapter });
      }
      return ok({
        query: sp.get("q") ?? "",
        results: cards.map((c) => ({ ...c, courseId: labels.get(c.chapter_id)?.courseId, courseName: labels.get(c.chapter_id)?.course, chapterName: labels.get(c.chapter_id)?.chapter })),
      });
    }
    if (route === "/stats") return ok({ ...getStats(), settings: getSettings() });
    if (route === "/stats/period") {
      const raw = sp.get("unit");
      const unit: PeriodUnit = raw === "week" || raw === "month" ? raw : "day";
      return ok(buildPeriod(unit, intParam(sp, "offset", 0, 0, 800)));
    }
    if (route === "/tags") return ok(listAllTags());
    if (route === "/logs")
      return ok(queryLogs({
        limit: intParam(sp, "limit", 200, 1, 1000),
        actor: (sp.get("actor") as Actor) || undefined,
        level: (sp.get("level") as LogLevel) || undefined,
        action: sp.get("action") || undefined,
        search: sp.get("q") || undefined,
      }));
    if (route === "/health")
      return ok({ status: "ok", actor: ACTOR, dataDir: "device", time: Date.now(), counts: countCardsInScope({ kind: "all" }) });

    /* ---------------- settings & maintenance ---------------- */
    if (route === "/settings" && method === "GET") return ok(getSettings());
    if (route === "/settings" && method === "PATCH") {
      setSettings(await json());
      return ok(mutated(getSettings()));
    }
    if (route === "/maintenance" && method === "POST") {
      const body = await json<{ action?: string; days?: number }>();
      if (body.action === "reset-progress") return ok(mutated({ reset: resetProgress(parseScope(sp), ACTOR) }));
      if (body.action === "vacuum") { getDb().exec("VACUUM"); return ok(mutated({ done: "vacuum" })); }
      if (body.action === "collect-media") {
        const orphans = getDb().prepare("SELECT filename FROM media WHERE id NOT IN (SELECT media_id FROM card_media)").all() as { filename: string }[];
        for (const m of orphans) await mediaStore().remove(m.filename);
        getDb().prepare("DELETE FROM media WHERE id NOT IN (SELECT media_id FROM card_media)").run();
        return ok(mutated({ removed: orphans.length }));
      }
      if (body.action === "prune-logs") {
        const cutoff = Date.now() - Math.max(1, body.days ?? 90) * 86_400_000;
        return ok(mutated({ removed: getDb().prepare("DELETE FROM event_log WHERE ts < ?").run(cutoff).changes }));
      }
      // reveal-key / rotate-key are agent-API concepts; there is no API here.
      return fail(400, "unsupported", "That action isn't available on this device.");
    }

    /* ---------------- media ---------------- */
    if (route === "/media" && method === "POST") {
      const files = (await form()).getAll("file").filter((f): f is File => f instanceof File);
      if (!files.length) return fail(400, "no_file", "No files found under the `file` field.");
      const saved = [];
      for (const file of files) {
        const { media } = await saveUpload(file);
        saved.push({ ...media, url: (await import("../mediaStore")).mediaUrlFor(media.filename, media.id), deduped: false });
      }
      return ok(mutated({ media: saved, errors: [] }), 201);
    }

    /* ---------------- export ---------------- */
    if (route === "/backup" && method === "GET") {
      const { bytes } = await buildBackup(sp.get("history") !== "0");
      return binary(bytes, `flashcards-${new Date().toISOString().slice(0, 10)}.fcbackup`);
    }
    if (route === "/export/deck" && method === "GET") {
      const chapterId = sp.get("chapterId");
      const courseId = sp.get("courseId");
      let course, chapters, scope: "course" | "chapter", label;
      if (chapterId) {
        const chapter = getChapter(chapterId);
        if (!chapter) return fail(404, "not_found", "No chapter with that id.");
        course = getCourse(chapter.course_id); chapters = [chapter]; scope = "chapter";
        label = `${course?.name ?? "Deck"} - ${chapter.name}`;
      } else if (courseId) {
        course = getCourse(courseId);
        if (!course) return fail(404, "not_found", "No course with that id.");
        chapters = listChapters(courseId, true); scope = "course"; label = course.name;
      } else return fail(400, "missing_param", "Pass either ?courseId= or ?chapterId=.");
      const { bytes, deck } = await buildDeckZip(course!, chapters, scope);
      if (countCards(deck.chapters) === 0) return fail(400, "empty", "Nothing to export yet.");
      return binary(bytes, deckFilename(label));
    }

    /* ---------------- import ---------------- */
    if (route === "/import/analyze" && method === "POST") {
      const file = (await form()).get("file");
      if (!(file instanceof File)) return fail(400, "no_file", "No file found.");
      const workbook = await parseAnySpreadsheet(file);
      if (!workbook.sheets.length) return fail(400, "empty_file", "That file has no readable rows.");
      return ok(workbook);
    }
    if (route === "/import/commit" && method === "POST") {
      const body = await json<{ courseId?: string; newCourseName?: string; sheets: Array<{ chapterName: string; include: boolean; frontColumn: number; backColumn: number; hintColumn?: number; tagsColumn?: number; notesColumn?: number; skipFirstRow: boolean; rows: string[][] }> }>();
      const courseId = body.courseId ?? createCourse({ name: body.newCourseName || "Imported" }, "import").id;
      let created = 0;
      for (const sheet of body.sheets.filter((s) => s.include)) {
        const chapter = createChapter({ courseId, name: sheet.chapterName }, "import");
        if (!chapter) continue;
        const rows = sheet.skipFirstRow ? sheet.rows.slice(1) : sheet.rows;
        const at = (r: string[], i?: number) => (i !== undefined && i >= 0 && i < r.length ? (r[i] ?? "").trim() : "");
        const cards: CardInput[] = rows
          .filter((r) => at(r, sheet.frontColumn) || at(r, sheet.backColumn))
          .map((r) => ({
            chapterId: chapter.id, front: at(r, sheet.frontColumn), back: at(r, sheet.backColumn),
            hint: at(r, sheet.hintColumn), notes: at(r, sheet.notesColumn),
            tags: at(r, sheet.tagsColumn) ? at(r, sheet.tagsColumn).split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [],
          }));
        created += createCards(cards, "import", "import").length;
      }
      return ok(mutated({ courseId, created }), 201);
    }
    if (route === "/import/deck/analyze" && method === "POST") {
      const file = (await form()).get("file");
      if (!(file instanceof File)) return fail(400, "no_file", "No file found.");
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = readDeckZip(buffer);
      const existing = listCourses(true).find((c) => c.name.toLowerCase() === parsed.deck.course.name.toLowerCase());
      return ok({
        stagingId: stageDevice(buffer), filename: file.name, exportedAt: parsed.deck.exportedAt,
        scope: parsed.deck.scope, course: parsed.deck.course, totalNotes: parsed.totalNotes,
        totalCards: parsed.totalCards, mediaCount: parsed.media.size,
        existingCourse: existing ? { id: existing.id, name: existing.name } : null,
        chapters: parsed.deck.chapters.map((c) => ({
          name: c.name, cards: countCards([c]),
          clozeCards: (c.cards ?? []).filter((x) => x?.cardType === "cloze").length,
          sampleFront: (c.cards?.[0]?.front ?? "").slice(0, 120),
          sampleBack: (c.cards?.[0]?.back ?? "").slice(0, 120),
        })),
      });
    }
    if (route === "/import/deck/commit" && method === "POST") {
      const body = await json<{ stagingId: string; courseName?: string }>();
      const staged = readDeviceStaged(body.stagingId);
      if (!staged) return fail(404, "staging_expired", "That upload is no longer staged.");
      const parsed = readDeckZip(Buffer.from(staged));
      const store = mediaStore();
      const idByName = new Map<string, string>();
      for (const [name, bytes] of parsed.media) {
        const { media } = await saveUpload(new File([bytes as BlobPart], name));
        idByName.set(name, media.id);
        void store;
      }
      const name = (body.courseName ?? parsed.deck.course.name).trim();
      const courseId = listCourses(true).find((c) => c.name.toLowerCase() === name.toLowerCase())?.id
        ?? createCourse({ name, description: parsed.deck.course.description, emoji: parsed.deck.course.emoji, color: parsed.deck.course.color }, "import").id;
      let cardsCreated = 0;
      for (const chapter of parsed.deck.chapters) {
        if (!chapter.cards?.length) continue;
        const chapterId = listChapters(courseId, true).find((c) => c.name.toLowerCase() === chapter.name.toLowerCase())?.id
          ?? createChapter({ courseId, name: chapter.name, description: chapter.description }, "import")?.id;
        if (!chapterId) continue;
        cardsCreated += createCards(chapter.cards.map((card) => ({
          chapterId, front: card.front ?? "", back: card.back ?? "", hint: card.hint, notes: card.notes,
          tags: card.tags, starred: card.starred, cardType: card.cardType,
          mediaIds: (card.media ?? []).map((m) => { const id = idByName.get(m.file); return id ? { id, side: m.side } : null; })
            .filter((m): m is { id: string; side: "front" | "back" } => m !== null),
        })), "import", "deck").length;
      }
      discardDeviceStaged(body.stagingId);
      return ok(mutated({ courseId, cardsCreated, mediaImported: idByName.size, mediaFailures: 0, results: [] }), 201);
    }

    /* ---------------- device backup ---------------- */
    if (route === "/backup/analyze" && method === "POST") {
      const file = (await form()).get("file");
      if (!(file instanceof File)) return fail(400, "no_file", "No file found.");
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = readBackup(buffer);
      return ok({
        stagingId: stageDevice(buffer), filename: file.name, exportedAt: parsed.meta.exportedAt,
        includesHistory: parsed.meta.includesHistory, schemaVersion: parsed.meta.schemaVersion,
        sizeBytes: buffer.length,
        incoming: {
          courses: parsed.meta.counts.courses ?? 0, chapters: parsed.meta.counts.chapters ?? 0,
          cards: parsed.meta.counts.cards ?? 0, mediaFiles: parsed.meta.counts.mediaFiles ?? 0,
          reviews: parsed.meta.counts.review_log ?? 0,
        },
        current: { cards: countCardsInScope({ kind: "all" }).total },
      });
    }
    if (route === "/backup/restore" && method === "POST") {
      const body = await json<{ stagingId: string; mode: "replace" | "merge"; dryRun?: boolean }>();
      const staged = readDeviceStaged(body.stagingId);
      if (!staged) return fail(404, "staging_expired", "That upload is no longer staged.");
      const parsed = readBackup(Buffer.from(staged));
      if (body.dryRun) return ok({ dryRun: true, mode: body.mode, wouldRestore: parsed.meta.counts });
      const result = await restoreBackup(parsed, body.mode);
      discardDeviceStaged(body.stagingId);
      return ok(mutated(result));
    }

    return fail(404, "not_found", `No route for ${method} ${route} on this device.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[flashcards] device dispatch failed", route, err);
    return fail(500, "internal_error", message);
  }
}

function binary(bytes: Buffer | Uint8Array, filename: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
