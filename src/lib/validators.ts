import { z } from "zod";

/**
 * Every write endpoint validates through one of these. Unknown keys are
 * stripped rather than rejected so a slightly-wrong agent payload still
 * succeeds for the fields it got right.
 */

const text = (max: number) => z.string().max(max);

export const courseCreate = z.object({
  name: z.string().min(1).max(200),
  description: text(2000).optional(),
  emoji: text(8).optional(),
  color: text(32).optional(),
});

export const courseUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  description: text(2000).optional(),
  emoji: text(8).optional(),
  color: text(32).optional(),
  position: z.number().int().optional(),
  archived: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
});

export const chapterCreate = z.object({
  courseId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: text(2000).optional(),
});

export const chapterUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  description: text(2000).optional(),
  position: z.number().int().optional(),
  archived: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
  courseId: z.string().min(1).optional(),
});

const mediaRef = z.object({
  id: z.string().min(1),
  side: z.enum(["front", "back"]).optional(),
});

export const cardCreate = z.object({
  chapterId: z.string().min(1).optional(),
  /**
   * Omit and cloze markup in `front` opts in automatically. Pass "basic"
   * explicitly to keep `{{c1::…}}` as literal text.
   */
  cardType: z.enum(["basic", "cloze"]).optional(),
  front: text(20_000),
  back: text(20_000),
  hint: text(4000).optional(),
  notes: text(20_000).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  starred: z.boolean().optional(),
  suspended: z.boolean().optional(),
  mediaIds: z.array(mediaRef).max(20).optional(),
});

/**
 * Bulk creation is the endpoint AI agents will use most. It supports:
 *   - `dryRun`     : validate and report, write nothing
 *   - `dedupe`     : silently skip cards whose front already exists in the chapter
 *   - path-based targeting via courseName/chapterName so an agent does not need
 *     to look up ids first (they are created on demand when `create: true`)
 */
export const cardsBulkCreate = z.object({
  chapterId: z.string().min(1).optional(),
  courseName: z.string().min(1).max(200).optional(),
  chapterName: z.string().min(1).max(200).optional(),
  createMissing: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false),
  dedupe: z.boolean().optional().default(true),
  cards: z.array(cardCreate).min(1).max(500),
});

export const cardUpdate = z.object({
  chapterId: z.string().min(1).optional(),
  cardType: z.enum(["basic", "cloze"]).optional(),
  front: text(20_000).optional(),
  back: text(20_000).optional(),
  hint: text(4000).optional(),
  notes: text(20_000).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  starred: z.boolean().optional(),
  suspended: z.boolean().optional(),
  position: z.number().int().optional(),
  mediaIds: z.array(mediaRef).max(20).optional(),
});

export const answerBody = z.object({
  cardId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  /**
   * Rounded rather than required-integer: timers produce fractional
   * milliseconds (performance.now(), Date.now() deltas across workers), and
   * refusing an answer over a decimal place in a telemetry field would lose
   * the user's actual review.
   */
  durationMs: z
    .number()
    .min(0)
    .max(3_600_000)
    .transform((n) => Math.round(n))
    .optional(),
  sessionId: z.string().max(100).optional(),
  cram: z.boolean().optional(),
});

export const settingsUpdate = z.object({
  sessionSize: z.number().int().min(1).max(500).optional(),
  newPerDay: z.number().int().min(0).max(500).optional(),
  dailyGoal: z.number().int().min(1).max(2000).optional(),
  gradingMode: z.enum(["simple", "full"]).optional(),
  autoPlayAudio: z.boolean().optional(),
  speakText: z.boolean().optional(),
  focusMode: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  targetRetention: z.number().min(0.7).max(0.97).optional(),
  showHints: z.boolean().optional(),
});

export const importCommit = z.object({
  courseId: z.string().min(1).optional(),
  newCourseName: z.string().min(1).max(200).optional(),
  dryRun: z.boolean().optional().default(false),
  sheets: z
    .array(
      z.object({
        sheetName: z.string(),
        chapterName: z.string().min(1).max(200),
        include: z.boolean(),
        frontColumn: z.number().int().min(0),
        backColumn: z.number().int().min(0),
        hintColumn: z.number().int().min(-1).optional(),
        tagsColumn: z.number().int().min(-1).optional(),
        notesColumn: z.number().int().min(-1).optional(),
        skipFirstRow: z.boolean(),
        rows: z.array(z.array(z.string())),
      }),
    )
    .min(1),
});
