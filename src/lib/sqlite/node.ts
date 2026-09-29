import Database from "better-sqlite3";
import type { SqliteDb } from "./types";

/**
 * Server adapter. better-sqlite3 already implements this interface exactly,
 * so this is a type assertion rather than a wrapper — no behaviour changes,
 * nothing new to go wrong on the path that is already in use.
 */
export function openNodeDatabase(filePath: string): SqliteDb {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL"); // survives crashes, allows concurrent reads
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db as unknown as SqliteDb;
}
