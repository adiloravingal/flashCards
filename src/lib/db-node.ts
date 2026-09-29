import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentKey, registerDatabase, runMigrations, setAgentKey } from "./db";
import { openNodeDatabase } from "./sqlite/node";
import type { SqliteDb } from "./sqlite/types";

/**
 * Server driver: a real SQLite file on disk, with media beside it.
 *
 * Importing this module registers the driver as a side effect, which is why
 * `api.ts` pulls it in — every route goes through that wrapper, so the
 * database is always ready by the time a handler runs.
 */

export const DATA_DIR = path.resolve(
  process.cwd(),
  process.env.FC_DATA_DIR || "./data",
);
export const MEDIA_DIR = path.join(DATA_DIR, "media");
/** Uploads held between an import's preview step and its commit step. */
export const STAGING_DIR = path.join(DATA_DIR, "staging");
const DB_PATH = path.join(DATA_DIR, "app.db");
const KEY_FILE = path.join(DATA_DIR, "agent-key.txt");

function open(): SqliteDb {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const db = openNodeDatabase(DB_PATH);
  registerDatabase(db);
  runMigrations(db);
  ensureAgentKey();
  return db;
}

/**
 * The agent key is what external AI agents present to use /api/v1.
 * If the user did not set FC_AGENT_KEY we mint one on first boot and persist
 * it, so the key is stable across restarts without any setup step.
 */
function ensureAgentKey(): void {
  const fromEnv = process.env.FC_AGENT_KEY?.trim();
  if (fromEnv) {
    setAgentKey(fromEnv);
    return;
  }
  if (getAgentKey()) return;

  const key = `fc_${randomBytes(24).toString("base64url")}`;
  setAgentKey(key);
  writeKeyFile(key);
  console.log(`[flashcards] generated agent API key -> data/agent-key.txt`);
}

function writeKeyFile(key: string): void {
  try {
    fs.writeFileSync(KEY_FILE, key + "\n", { mode: 0o600 });
  } catch {
    /* non-fatal — the key is also visible in Settings */
  }
}

export function rotateAgentKey(): string {
  const key = `fc_${randomBytes(24).toString("base64url")}`;
  setAgentKey(key);
  writeKeyFile(key);
  return key;
}

// Side effect: opening on import is what makes `getDb()` safe everywhere.
const globalForNode = globalThis as unknown as { __fcNodeDbOpen?: boolean };
if (!globalForNode.__fcNodeDbOpen) {
  open();
  globalForNode.__fcNodeDbOpen = true;
}
