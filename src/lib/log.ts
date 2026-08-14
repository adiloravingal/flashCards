import { getDb, newId, now } from "./db";

export type Actor = "you" | "agent" | "system" | "import";
export type LogLevel = "info" | "warn" | "error";

export interface LogInput {
  actor: Actor;
  action: string;
  level?: LogLevel;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Append to the audit trail. Deliberately swallows its own errors: a logging
 * failure must never take down the action that was being logged.
 */
export function logEvent(input: LogInput): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO event_log (id, ts, level, actor, action, entity_type, entity_id, summary, meta, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId(),
        now(),
        input.level ?? "info",
        input.actor,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.summary ?? "",
        JSON.stringify(input.meta ?? {}),
        input.ip ?? null,
      );
  } catch (err) {
    console.error("[flashcards] failed to write event log", err);
  }
}

export interface LogQuery {
  limit?: number;
  before?: number;
  actor?: Actor;
  level?: LogLevel;
  action?: string;
  search?: string;
}

export function queryLogs(q: LogQuery = {}) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (q.before) {
    where.push("ts < ?");
    params.push(q.before);
  }
  if (q.actor) {
    where.push("actor = ?");
    params.push(q.actor);
  }
  if (q.level) {
    where.push("level = ?");
    params.push(q.level);
  }
  if (q.action) {
    where.push("action = ?");
    params.push(q.action);
  }
  if (q.search) {
    where.push("(summary LIKE ? OR action LIKE ? OR meta LIKE ?)");
    const like = `%${q.search}%`;
    params.push(like, like, like);
  }

  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const sql =
    `SELECT * FROM event_log` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY ts DESC LIMIT ${limit}`;

  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    meta: safeParse(r.meta as string),
  }));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Delete log entries older than `days`. Used by the Settings > Maintenance. */
export function pruneLogs(days: number): number {
  const cutoff = now() - days * 86_400_000;
  const info = getDb().prepare("DELETE FROM event_log WHERE ts < ?").run(cutoff);
  return info.changes;
}
