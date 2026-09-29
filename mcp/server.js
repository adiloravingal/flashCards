#!/usr/bin/env node
/**
 * MCP server for flashCards.io.
 *
 * A translation layer, not a second implementation: every tool below is a
 * call to the app's existing /api/v1, which already does the hard parts —
 * validation, deduplication, dry runs, and writing every change to the
 * activity log attributed to "agent".
 *
 * Configure it in Claude Desktop or Claude Code:
 *
 *   {
 *     "mcpServers": {
 *       "flashcards": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/flashCards/mcp/server.js"],
 *         "env": { "FC_AGENT_KEY": "fc_..." }
 *       }
 *     }
 *   }
 *
 * The key is in Settings, or data/agent-key.txt.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.FC_URL ?? "http://localhost:3939").replace(/\/$/, "");
const KEY = process.env.FC_AGENT_KEY ?? "";

/* ========================================================================== *
 * Talking to the app
 * ========================================================================== */

class NotRunning extends Error {}

async function call(path, { method = "GET", body } = {}) {
  const headers = {};
  if (KEY) headers.Authorization = `Bearer ${KEY}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // The single most likely failure, and the one a raw ECONNREFUSED explains
    // worst. The app cannot be started from here, so say what to do instead.
    throw new NotRunning(
      `Can't reach flashCards at ${BASE}. Start it with \`npm start\` in the ` +
        `project folder, or set FC_URL if it runs somewhere else.` +
        (err?.name === "TimeoutError" ? " (The request timed out.)" : ""),
    );
  }

  if (res.status === 401) {
    throw new Error(
      "flashCards rejected the API key. Set FC_AGENT_KEY to the value in " +
        "Settings → AI agent access (or data/agent-key.txt).",
    );
  }

  const payload = await res.json().catch(() => null);
  if (!payload?.ok) {
    const error = payload?.error;
    throw new Error(
      error?.message ?? `flashCards returned ${res.status}.`,
    );
  }
  return payload.data;
}

/** MCP wants content blocks; everything here is JSON the model can read. */
const reply = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

/** Turn a thrown error into a tool error rather than crashing the server. */
function guard(handler) {
  return async (args) => {
    try {
      return reply(await handler(args));
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err?.message ?? String(err) }],
      };
    }
  };
}

/* ========================================================================== *
 * Tools
 * ========================================================================== */

const server = new McpServer({ name: "flashcards", version: "1.0.0" });

server.registerTool(
  "list_courses",
  {
    title: "List courses",
    description:
      "Every course with its chapter and card counts, and how many are due. " +
      "Call this first when the user names a subject, so cards land somewhere " +
      "that already exists instead of creating a near-duplicate course.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  guard(async () => {
    const courses = await call("/courses");
    const detailed = await Promise.all(
      courses.map(async (c) => ({
        name: c.name,
        cards: c.totalCards,
        due: c.dueCards,
        new: c.newCards,
        chapters: (await call(`/chapters?courseId=${c.id}`)).map((ch) => ch.name),
      })),
    );
    return detailed.length
      ? detailed
      : { courses: [], note: "No courses yet — creating cards will make one." };
  }),
);

server.registerTool(
  "create_cards",
  {
    title: "Create flashcards",
    description:
      "Add cards to a chapter, creating the course and chapter if they don't " +
      "exist. This is the main tool.\n\n" +
      "Write atomic cards: one fact each. If an answer is a list, it is " +
      "usually several cards. Put the answer in `back`; context and sources " +
      "go in `notes`.\n\n" +
      "For prose, prefer a cloze: write `front` as a full sentence with the " +
      "key term wrapped as {{c1::term}}. Each distinct number becomes its own " +
      "card with its own schedule.\n\n" +
      "Run with dryRun: true first and show the user the plan, then repeat " +
      "without it. Duplicate fronts are skipped automatically, so re-running " +
      "is safe.",
    inputSchema: {
      courseName: z.string().describe("Course to add to; created if absent."),
      chapterName: z.string().describe("Chapter within it; created if absent."),
      cards: z
        .array(
          z.object({
            front: z.string().describe("The question, or cloze sentence."),
            back: z.string().describe("The answer. Optional for cloze cards."),
            hint: z.string().optional(),
            notes: z.string().optional().describe("Shown after the answer."),
            tags: z.array(z.string()).optional(),
          }),
        )
        .max(500),
      dryRun: z
        .boolean()
        .optional()
        .describe("Report what would happen without writing. Use this first."),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  guard(({ courseName, chapterName, cards, dryRun }) =>
    call("/cards", {
      method: "POST",
      body: { courseName, chapterName, cards, dryRun: !!dryRun },
    }),
  ),
);

server.registerTool(
  "search_cards",
  {
    title: "Search cards",
    description:
      "Full-text search across fronts, backs, notes and tags. Use it to check " +
      "whether something is already covered before adding more.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ query, limit }) => {
    const found = await call(
      `/search?q=${encodeURIComponent(query)}&limit=${limit ?? 20}`,
    );
    return found.results.map((c) => ({
      id: c.id,
      front: c.front,
      back: c.back,
      where: `${c.courseName ?? "?"} › ${c.chapterName ?? "?"}`,
      tags: c.tags,
    }));
  }),
);

server.registerTool(
  "update_card",
  {
    title: "Edit a card",
    description:
      "Change a card's text, hint, notes or tags. Get the id from " +
      "search_cards. Only the fields you pass are changed. Editing any card " +
      "of a cloze note updates its siblings and keeps their review history.",
    inputSchema: {
      id: z.string(),
      front: z.string().optional(),
      back: z.string().optional(),
      hint: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  guard(({ id, ...patch }) =>
    call(`/cards/${id}`, { method: "PATCH", body: patch }),
  ),
);

server.registerTool(
  "review_stats",
  {
    title: "Study progress",
    description:
      "Streak, how much is due, recall rate and what is coming up. Useful for " +
      "answering 'how am I doing' or deciding what to study.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  guard(async () => {
    const s = await call("/stats");
    return {
      cards: s.counts,
      streakDays: s.streak,
      today: { reviews: s.today.reviews, newCards: s.today.new_cards },
      recall30d:
        s.retention30d === null ? null : `${Math.round(s.retention30d * 100)}%`,
      totalReviews: s.totalReviews,
      dueNext14Days: s.forecast,
      strugglingWith: s.hardestCards.slice(0, 5).map((c) => c.front),
    };
  }),
);

server.registerTool(
  "list_due",
  {
    title: "What's due now",
    description:
      "The cards waiting to be reviewed, optionally for one course. Reading " +
      "them does not affect scheduling — answering happens in the app.",
    inputSchema: {
      courseName: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ courseName, limit }) => {
    let query = `limit=${limit ?? 20}`;
    if (courseName) {
      const course = (await call("/courses")).find(
        (c) => c.name.toLowerCase() === courseName.toLowerCase(),
      );
      if (!course) throw new Error(`No course named "${courseName}".`);
      query += `&courseId=${course.id}`;
    }
    const queue = await call(`/review/queue?${query}`);
    return {
      due: queue.counts.due,
      new: queue.counts.new,
      cards: queue.cards.map((c) => ({ front: c.front, back: c.back })),
    };
  }),
);

/* ========================================================================== */

const transport = new StdioServerTransport();
await server.connect(transport);
