import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";
import { DEFAULT_SETTINGS, type Settings } from "./settings-shared";

/** Absolute path to the folder holding the database and all uploaded media. */
export const DATA_DIR = path.resolve(
  process.cwd(),
  process.env.FC_DATA_DIR || "./data",
);
export const MEDIA_DIR = path.join(DATA_DIR, "media");
/** Uploads held between an import's preview step and its commit step. */
export const STAGING_DIR = path.join(DATA_DIR, "staging");
const DB_PATH = path.join(DATA_DIR, "app.db");

/**
 * Next.js hot-reloads modules in dev, which would otherwise open a new SQLite
 * handle on every edit. Stash the connection on globalThis so we keep exactly
 * one per process.
 */
const globalForDb = globalThis as unknown as {
  __fcDb?: Database.Database;
};

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // survives crashes, allows concurrent reads
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db);
  ensureAgentKey(db);
  return db;
}

function migrate(db: Database.Database) {
  const applied = db.pragma("user_version", { simple: true }) as number;
  if (applied >= MIGRATIONS.length) return;

  for (let i = applied; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i];
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${i + 1}`);
    });
    run();
    console.log(`[flashcards] applied migration ${m.name}`);
  }
}

/**
 * The agent key is what external AI agents present to use /api/v1.
 * If the user did not set FC_AGENT_KEY we mint one on first boot and persist
 * it, so the key is stable across restarts without any setup step.
 */
function ensureAgentKey(db: Database.Database) {
  const fromEnv = process.env.FC_AGENT_KEY?.trim();
  if (fromEnv) {
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('agent_key', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(fromEnv);
    return;
  }

  const existing = db
    .prepare("SELECT value FROM meta WHERE key = 'agent_key'")
    .get() as { value: string } | undefined;
  if (existing) return;

  const key = `fc_${randomBytes(24).toString("base64url")}`;
  db.prepare("INSERT INTO meta (key, value) VALUES ('agent_key', ?)").run(key);
  try {
    fs.writeFileSync(path.join(DATA_DIR, "agent-key.txt"), key + "\n", {
      mode: 0o600,
    });
  } catch {
    /* non-fatal — the key is also visible in Settings */
  }
  console.log(`[flashcards] generated agent API key -> data/agent-key.txt`);
}

export function getDb(): Database.Database {
  if (!globalForDb.__fcDb) globalForDb.__fcDb = open();
  return globalForDb.__fcDb;
}

export const newId = (): string => randomUUID();
export const now = (): number => Date.now();

/* --------------------------------------------------------------------------
 * Settings: small key/value store for user preferences. Values are JSON.
 * ------------------------------------------------------------------------ */

export { DEFAULT_SETTINGS, type Settings } from "./settings-shared";

export function getSettings(): Settings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
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

export function rotateAgentKey(): string {
  const key = `fc_${randomBytes(24).toString("base64url")}`;
  getDb()
    .prepare(
      "INSERT INTO meta (key, value) VALUES ('agent_key', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key);
  try {
    fs.writeFileSync(path.join(DATA_DIR, "agent-key.txt"), key + "\n", {
      mode: 0o600,
    });
  } catch {
    /* non-fatal */
  }
  return key;
}
