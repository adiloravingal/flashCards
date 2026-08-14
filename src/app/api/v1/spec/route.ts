import { handler, ok } from "@/lib/api";
import { getStats } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/spec — a machine-readable description of this API.
 *
 * Point an AI agent here first and it can discover everything it needs without
 * being told: endpoints, required fields, safety rails, and the exact shape of
 * the bulk-create call it will actually use.
 */
export const GET = handler(async () => {
  const stats = getStats();

  return ok({
    name: "flashCards.io local API",
    version: "1",
    baseUrl: "/api/v1",
    auth: {
      scheme: "bearer",
      header: "Authorization: Bearer <API_KEY>",
      alternative: "X-Api-Key: <API_KEY>",
      note: "Find the key in Settings, or in data/agent-key.txt.",
    },
    responseShape: {
      success: { ok: true, data: "<payload>" },
      failure: { ok: false, error: { code: "string", message: "string" } },
    },
    safety: {
      dryRun:
        "POST /cards and POST /import/commit accept `dryRun: true`. Nothing is written; you get a report of what would happen. Always dry-run first when acting on a user's behalf.",
      dedupe:
        "POST /cards defaults to `dedupe: true`, skipping cards whose front already exists in the target chapter. Re-running the same request is therefore safe.",
      limits: {
        cardsPerRequest: 500,
        filesPerUpload: 25,
        tagsPerCard: 30,
      },
      audit:
        "Every write is recorded in the event log with actor='agent' and is visible to the user at /logs.",
      destructive:
        "DELETE endpoints cascade (deleting a course deletes its chapters and cards). Prefer PATCH {archived: 1} over DELETE unless the user explicitly asked to delete.",
    },
    hierarchy: "Course > Chapter > Card. Every card belongs to exactly one chapter.",
    counting: {
      note: "A deck file stores notes, not cards. A cloze note becomes one card per deletion index on import, so `totalCards` in an analyze response is already expanded and will match what commit creates. `totalNotes` is the raw entry count.",
    },
    cardTypes: {
      basic: "One card: `front` asks, `back` answers.",
      cloze:
        "Written as `{{c1::hidden}}` inside `front`. One card is created per distinct index; siblings share a `note_id` and each keeps its own schedule. Repeating an index blanks both spots on the same card. `{{c1::text::hint}}` shows the hint in place of the blank. On a cloze note `back` is optional extra context, not the answer.",
      note: "PATCH /cards/{id} on any cloze sibling edits the whole note: shared text updates everywhere, new indices add cards, removed indices delete only their own card, and surviving cards keep their review history.",
    },
    endpoints: [
      { method: "GET", path: "/spec", purpose: "This document." },
      { method: "GET", path: "/health", purpose: "Liveness plus current totals." },

      { method: "GET", path: "/courses", purpose: "List courses with due/new counts." },
      { method: "POST", path: "/courses", body: { name: "string", description: "string?", emoji: "string?", color: "string?" } },
      { method: "GET", path: "/courses/{id}", purpose: "Course with its chapters." },
      { method: "PATCH", path: "/courses/{id}" },
      { method: "DELETE", path: "/courses/{id}", purpose: "Cascades to chapters and cards." },

      { method: "GET", path: "/chapters?courseId=", purpose: "List chapters of a course." },
      { method: "POST", path: "/chapters", body: { courseId: "string", name: "string" } },
      { method: "PATCH", path: "/chapters/{id}" },
      { method: "DELETE", path: "/chapters/{id}" },

      {
        method: "GET",
        path: "/cards?chapterId=|courseId=|tag=|starred=1&limit=&offset=",
        purpose: "List cards in a scope.",
      },
      {
        method: "POST",
        path: "/cards",
        purpose: "Bulk-create cards. The main endpoint for agents.",
        body: {
          chapterId: "string?  (or use courseName + chapterName)",
          courseName: "string?",
          chapterName: "string?",
          createMissing: "boolean, default true — create course/chapter if absent",
          dryRun: "boolean, default false",
          dedupe: "boolean, default true",
          cards: [
            {
              front: "string (required)",
              back: "string (required)",
              cardType:
                "'basic' | 'cloze' (optional). Omit and `{{c1::…}}` markup in `front` turns the note into a cloze note automatically, producing one card per deletion index. Pass 'basic' to keep the markup literal.",
              hint: "string?",
              notes: "string?",
              tags: ["string"],
              starred: "boolean?",
              mediaIds: [{ id: "string", side: "front|back" }],
            },
          ],
        },
        example: {
          courseName: "Pharmacology",
          chapterName: "Beta blockers",
          dryRun: true,
          cards: [
            { front: "Mechanism of propranolol?", back: "Non-selective beta-adrenergic antagonist", tags: ["cardio"] },
          ],
        },
      },
      { method: "GET", path: "/cards/{id}" },
      { method: "PATCH", path: "/cards/{id}" },
      { method: "DELETE", path: "/cards/{id}" },

      {
        method: "POST",
        path: "/media",
        purpose: "multipart/form-data upload, field name `file` (repeatable). Returns media ids for `mediaIds`.",
      },
      { method: "GET", path: "/media/{id}/raw", purpose: "Serve the file. Supports range requests." },

      { method: "GET", path: "/review/queue?courseId=&chapterId=&mode=due|cram|new&limit=" },
      { method: "POST", path: "/review/answer", body: { cardId: "string", rating: "1=Again 2=Hard 3=Good 4=Easy", durationMs: "number?", sessionId: "string?", cram: "boolean?" } },
      { method: "POST", path: "/review/undo", body: { sessionId: "string?" } },

      { method: "GET", path: "/search?q=&limit=" },
      { method: "GET", path: "/tags" },
      { method: "GET", path: "/stats" },
      { method: "GET", path: "/logs?limit=&actor=&level=&action=&q=" },
      { method: "GET", path: "/settings" },
      { method: "PATCH", path: "/settings" },

      { method: "POST", path: "/import/analyze", purpose: "multipart `file` (.xlsx/.csv/.tsv). Returns sheets + a column-mapping guess. Writes nothing." },
      { method: "POST", path: "/import/commit", purpose: "Commit a reviewed mapping. Supports dryRun." },
      { method: "POST", path: "/import/anki/analyze", purpose: "multipart `file` (.apkg). Returns decks + a stagingId. Writes nothing." },
      { method: "POST", path: "/import/anki/commit", purpose: "Body: { stagingId, decks: [{name, include, course, chapter}], dryRun? }." },

      { method: "GET", path: "/stats/period?unit=day|week|month&offset=0", purpose: "Bucketed review history for one period. `offset` counts backwards (0 = current). Includes the previous period's totals for comparison." },

      { method: "GET", path: "/export", purpose: "Full JSON backup of every course, chapter and card, scheduling included." },
      { method: "GET", path: "/export/deck?courseId=|chapterId=", purpose: "A shareable `.fcdeck` zip (deck.json + media). Content only — no scheduling, because it is meant for someone else." },
      { method: "POST", path: "/import/deck/analyze", purpose: "multipart `file` (.fcdeck). Returns a stagingId and what's inside. Writes nothing." },
      { method: "POST", path: "/import/deck/commit", purpose: "Body: { stagingId, courseName?, courseId?, chapters?, dryRun? }." },
    ],
    currentTotals: {
      cards: stats.counts.total,
      due: stats.counts.due,
      new: stats.counts.new,
    },
    guidanceForAgents: [
      "Ask the user which course/chapter to target if it is ambiguous — do not invent a taxonomy.",
      "Keep cards atomic: one fact per card. Split compound facts into separate cards.",
      "Prefer a cloze note when the user gives you prose: blanking the key term in their own sentence beats inventing a question around it.",
      "Put the answer in `back` only. Context and sources belong in `notes`.",
      "Call with dryRun: true first, show the user the plan, then repeat without it.",
      "Never call DELETE unless the user explicitly asked for deletion by name.",
    ],
  });
});
