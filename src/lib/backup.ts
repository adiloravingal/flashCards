import { unzipSync, zipSync } from "fflate";
import { getDb } from "./db";
import { mediaStore } from "./mediaStore";
import { MIGRATIONS } from "./schema";

/**
 * `.fcbackup` — a complete, exact copy of one device.
 *
 * This is deliberately different from `.fcdeck`:
 *
 *   .fcdeck    content only, no scheduling, for giving a deck to someone else
 *   .fcbackup  everything including schedules and history, for *being* you
 *              on another device
 *
 * Rows are dumped table-by-table with their real primary keys rather than
 * re-derived on import. Preserving ids is what makes a restore a mirror
 * instead of a copy: import the same file twice and nothing duplicates, and a
 * card you exported keeps its identity when it lands on the other machine.
 *
 * The agent API key is never included. A backup is a file you might hand to
 * someone, put on a USB stick or sync to a phone, and it must not carry the
 * credential that grants full read/write access to your collection.
 */

/**
 * Where a pre-restore safety copy gets written.
 *
 * Registered per environment — a file beside the database on a server, an
 * IndexedDB entry on a phone. If nothing is registered the restore still
 * runs, and the caller is told no copy was taken.
 */
export type SafetyWriter = (
  filename: string,
  bytes: Uint8Array,
) => Promise<string | null>;

let safetyWriter: SafetyWriter | null = null;

export function registerSafetyWriter(writer: SafetyWriter): void {
  safetyWriter = writer;
}

export const BACKUP_FORMAT = "flashcards.io/backup";
export const BACKUP_VERSION = 1;

/** Tables restored in this order, so foreign keys always have their parents. */
const CONTENT_TABLES = [
  "courses",
  "chapters",
  "cards",
  "media",
  "card_media",
  "settings",
] as const;

const HISTORY_TABLES = ["review_log", "daily_stats", "event_log"] as const;

type TableName = (typeof CONTENT_TABLES)[number] | (typeof HISTORY_TABLES)[number];

export interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  /** Which migration the source database was on, so we can refuse newer files. */
  schemaVersion: number;
  includesHistory: boolean;
  counts: Record<string, number>;
  tables: Partial<Record<TableName, Record<string, unknown>[]>>;
}

const columnsOf = (table: string): string[] =>
  (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );

/* ==========================================================================
 * Writing
 * ========================================================================== */

export async function buildBackup(includeHistory = true): Promise<{
  bytes: Buffer;
  meta: BackupFile;
}> {
  const db = getDb();
  const tables: BackupFile["tables"] = {};
  const counts: Record<string, number> = {};

  const wanted: TableName[] = includeHistory
    ? [...CONTENT_TABLES, ...HISTORY_TABLES]
    : [...CONTENT_TABLES];

  for (const table of wanted) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<
      string,
      unknown
    >[];
    tables[table] = rows;
    counts[table] = rows.length;
  }

  // Media is gathered *before* the manifest is serialised. Counting it
  // afterwards mutates an object that has already been turned into JSON, so
  // the file on disk would forever claim zero media files while actually
  // containing them.
  const store = mediaStore();
  const mediaEntries: Record<string, Uint8Array> = {};
  let mediaFiles = 0;
  for (const row of (tables.media ?? []) as { filename?: string }[]) {
    if (!row.filename) continue;
    const bytes = await store.read(row.filename);
    if (!bytes) continue; // row restores; the reference just won't resolve
    mediaEntries[`media/${row.filename}`] = bytes;
    mediaFiles++;
  }
  counts.mediaFiles = mediaFiles;

  const meta: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    schemaVersion: db.pragma("user_version", { simple: true }) as number,
    includesHistory: includeHistory,
    counts,
    tables,
  };

  const entries: Record<string, Uint8Array> = {
    "backup.json": new TextEncoder().encode(JSON.stringify(meta)),
    ...mediaEntries,
  };

  return { bytes: Buffer.from(zipSync(entries)), meta };
}

export function backupFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `flashcards-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.fcbackup`
  );
}

/* ==========================================================================
 * Reading
 * ========================================================================== */

export interface ParsedBackup {
  meta: BackupFile;
  media: Map<string, Uint8Array>;
}

export function readBackup(buffer: Buffer): ParsedBackup {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("That file isn't a readable .fcbackup (it isn't a valid zip).");
  }

  const manifest = files["backup.json"];
  if (!manifest) {
    throw new Error(
      "No backup.json inside that file. If it's a .fcdeck, use Import instead — this screen restores whole devices.",
    );
  }

  let meta: BackupFile;
  try {
    meta = JSON.parse(new TextDecoder().decode(manifest)) as BackupFile;
  } catch {
    throw new Error("The backup.json inside that file is corrupt.");
  }

  if (meta?.format !== BACKUP_FORMAT) {
    throw new Error(
      meta?.format === "flashcards.io/deck"
        ? "That's a shared deck (.fcdeck), not a full backup. Use the Import screen for it."
        : "Unrecognised backup format.",
    );
  }
  if (typeof meta.version !== "number" || meta.version > BACKUP_VERSION) {
    throw new Error(
      `That backup was written by a newer version of the app (format v${meta.version}).`,
    );
  }
  if (typeof meta.schemaVersion === "number" && meta.schemaVersion > MIGRATIONS.length) {
    throw new Error(
      `That backup came from a newer database (schema v${meta.schemaVersion}, this app is on v${MIGRATIONS.length}). Update this copy first.`,
    );
  }

  const media = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith("media/") && bytes.length > 0) {
      media.set(name.slice("media/".length), bytes);
    }
  }

  return { meta, media };
}

/* ==========================================================================
 * Restoring
 * ========================================================================== */

export type RestoreMode = "replace" | "merge";

export interface RestoreResult {
  mode: RestoreMode;
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  mediaRestored: number;
  safetyBackup: string | null;
}

/**
 * Write the rows of one table.
 *
 * Only columns that exist in *both* the file and this database are written, so
 * a backup from an older schema restores cleanly and picks up defaults for
 * anything added since.
 */
function restoreTable(
  table: TableName,
  rows: Record<string, unknown>[],
  mode: RestoreMode,
): { inserted: number; skipped: number } {
  if (!rows?.length) return { inserted: 0, skipped: 0 };

  const db = getDb();
  const available = new Set(columnsOf(table));
  const cols = Object.keys(rows[0]).filter((c) => available.has(c));
  if (cols.length === 0) return { inserted: 0, skipped: rows.length };

  // In merge mode an existing row wins: the local copy may have been reviewed
  // more recently, and silently overwriting someone's schedule is the one
  // outcome a "merge" must never produce.
  const verb = mode === "merge" ? "INSERT OR IGNORE" : "INSERT OR REPLACE";
  const stmt = db.prepare(
    `${verb} INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
  );

  let inserted = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      const values = cols.map((c) => {
        const v = row[c];
        if (v === undefined || v === null) return null;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "object") return JSON.stringify(v);
        return v as string | number;
      });
      const info = stmt.run(...values);
      if (info.changes > 0) inserted++;
      else skipped++;
    }
  });
  run();

  return { inserted, skipped };
}

/**
 * Keep only the most recent few safety copies.
 *
 * They exist so a mistaken restore is recoverable, which needs the last one or
 * two — not every restore you have ever done quietly filling the disk with
 * copies of your entire collection.
 */

export async function restoreBackup(
  parsed: ParsedBackup,
  mode: RestoreMode,
): Promise<RestoreResult> {
  const db = getDb();
  const inserted: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  // Before destroying anything, write the current state next to the database.
  // A restore is the single most dangerous button in the app, and "I picked
  // the wrong file" should cost a minute, not a collection.
  let safetyBackup: string | null = null;
  if (mode === "replace" && safetyWriter) {
    try {
      const { bytes } = await buildBackup(true);
      safetyBackup = await safetyWriter(
        `before-restore-${Date.now()}.fcbackup`,
        new Uint8Array(bytes),
      );
    } catch {
      // If the safety copy fails we carry on, but the caller is told so the
      // UI can say plainly that this one is not undoable.
      safetyBackup = null;
    }
  }

  const present = Object.keys(parsed.meta.tables) as TableName[];
  const order: TableName[] = [...CONTENT_TABLES, ...HISTORY_TABLES].filter((t) =>
    present.includes(t),
  );

  const apply = db.transaction(() => {
    if (mode === "replace") {
      // Children first; `cards` cascades from chapters but event_log and
      // daily_stats stand alone.
      for (const table of [...order].reverse()) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
    }

    for (const table of order) {
      const result = restoreTable(table, parsed.meta.tables[table] ?? [], mode);
      inserted[table] = result.inserted;
      skipped[table] = result.skipped;
    }
  });

  // Foreign keys are enforced per-statement; rows arrive parent-first so this
  // holds, but a replace briefly has an empty parent table mid-transaction.
  db.pragma("foreign_keys = OFF");
  try {
    apply();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  // Media files last: a half-written image is recoverable, a half-written
  // database is not.
  let mediaRestored = 0;
  const restoreStore = mediaStore();
  for (const [name, bytes] of parsed.media) {
    try {
      await restoreStore.write(name, bytes);
      mediaRestored++;
    } catch {
      /* one unwritable file shouldn't abort the restore */
    }
  }

  // The FTS index is populated by triggers, which INSERT OR REPLACE bypasses
  // for rows that replaced an existing rowid. Rebuild so search isn't stale.
  try {
    db.prepare("INSERT INTO cards_fts(cards_fts) VALUES ('rebuild')").run();
  } catch {
    /* search still works via the LIKE fallback */
  }

  return { mode, inserted, skipped, mediaRestored, safetyBackup };
}
