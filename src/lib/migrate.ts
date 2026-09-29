import { MIGRATIONS } from "./schema";
import type { SqliteDb } from "./sqlite/types";

/**
 * Bring a database up to the current schema.
 *
 * Shared by every driver so a collection created on a laptop and one created
 * on a phone are structurally identical — which is the precondition for a
 * `.fcbackup` moving between them.
 */
/**
 * A synchronous pause. SQLite's own busy_timeout does not reliably cover
 * acquiring the write lock in WAL mode, so the retry below needs to wait
 * without an await — everything on this path is synchronous by design.
 */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Not permitted on a browser main thread — and not needed there, since
    // the WASM database has no other process to contend with.
  }
}

const isBusy = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "SQLITE_BUSY";

/**
 * Take the write lock, waiting for whoever else is migrating.
 *
 * Two servers started together will both try this. One wins and migrates;
 * the other waits here, then finds the work already done.
 */
function acquireWriteLock(db: SqliteDb, timeoutMs = 10_000): void {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      db.exec("BEGIN IMMEDIATE");
      return;
    } catch (err) {
      if (!isBusy(err) || Date.now() >= deadline) throw err;
      sleepSync(100);
    }
  }
}

export function runMigrations(db: SqliteDb, log = true): void {
  // Fast path: already current, and no lock needed to find that out.
  if ((db.pragma("user_version", { simple: true }) as number) >= MIGRATIONS.length) {
    return;
  }

  // BEGIN IMMEDIATE takes the write lock up front. A plain transaction is
  // deferred, so two processes starting together would both read
  // user_version, both decide the same migrations are outstanding, and the
  // slower one would fail on "table already exists".
  acquireWriteLock(db);
  try {
    // Re-read under the lock: another process may have finished while we
    // waited for it.
    const applied = db.pragma("user_version", { simple: true }) as number;

    for (let i = applied; i < MIGRATIONS.length; i++) {
      const m = MIGRATIONS[i];
      db.exec(m.sql);
      db.pragma(`user_version = ${i + 1}`);
      if (log) console.log(`[flashcards] applied migration ${m.name}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* the original failure is the one worth reporting */
    }
    throw err;
  }
}
