import { MIGRATIONS } from "./schema";
import type { SqliteDb } from "./sqlite/types";

/**
 * Bring a database up to the current schema.
 *
 * Shared by every driver so a collection created on a laptop and one created
 * on a phone are structurally identical — which is the precondition for a
 * `.fcbackup` moving between them.
 */
export function runMigrations(db: SqliteDb, log = true): void {
  const applied = db.pragma("user_version", { simple: true }) as number;
  if (applied >= MIGRATIONS.length) return;

  for (let i = applied; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i];
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${i + 1}`);
    });
    run();
    if (log) console.log(`[flashcards] applied migration ${m.name}`);
  }
}
