import { runMigrations } from "./migrate";
import type { SqliteDb } from "./sqlite/types";
import { DEFAULT_SETTINGS, type Settings } from "./settings-shared";

/**
 * The database, wherever it happens to live.
 *
 * This module is deliberately environment-neutral — no `node:` imports, no
 * filesystem, no better-sqlite3. That is what lets `repo.ts` and everything
 * built on it run unchanged on a server *and* inside a phone, with only the
 * driver swapped underneath.
 *
 * Whoever boots the app registers a driver:
 *   server  →  src/lib/db-node.ts     (better-sqlite3, file on disk)
 *   device  →  src/lib/db-browser.ts  (SQLite compiled to WASM, one saved file)
 */

const globalForDb = globalThis as unknown as { __fcDb?: SqliteDb };

export function registerDatabase(db: SqliteDb): void {
  globalForDb.__fcDb = db;
}

export function isDatabaseReady(): boolean {
  return !!globalForDb.__fcDb;
}

export function getDb(): SqliteDb {
  const db = globalForDb.__fcDb;
  if (!db) {
    throw new Error(
      "No database registered. Import db-node (server) or db-browser (device) before using the app.",
    );
  }
  return db;
}

export { runMigrations };

export const newId = (): string => globalThis.crypto.randomUUID();
export const now = (): number => Date.now();

/* --------------------------------------------------------------------------
 * Settings: small key/value store for user preferences. Values are JSON.
 * ------------------------------------------------------------------------ */

export { DEFAULT_SETTINGS, type Settings } from "./settings-shared";

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt rows rather than crashing the app */
    }
  }
  return out as Settings;
}

export function setSettings(patch: Partial<Settings>) {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [k, v] of entries) stmt.run(k, JSON.stringify(v));
  });
  tx(Object.entries(patch));
}

export function getAgentKey(): string {
  const row = getDb()
    .prepare("SELECT value FROM meta WHERE key = 'agent_key'")
    .get() as { value: string } | undefined;
  return row?.value ?? "";
}

/** Store a key. Persisting it outside the database is the caller's business. */
export function setAgentKey(key: string): void {
  getDb()
    .prepare(
      "INSERT INTO meta (key, value) VALUES ('agent_key', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key);
}
