import { registerDatabase, runMigrations } from "../db";
import { initWasmSqlite, openWasmDatabase } from "../sqlite/wasm";
import { META_STORE, idbGet, idbSet, requestPersistence } from "./idb";

/**
 * Device driver: SQLite compiled to WASM, held in memory, written back to
 * IndexedDB as a single file.
 *
 * "In memory" sounds alarming for the thing holding your cards, so to be
 * precise: every write goes into a real SQLite database immediately, and the
 * whole database is serialised to durable storage shortly afterwards. What is
 * in memory is the *file*, not the durability.
 */

const DB_KEY = "sqlite";
/** Long enough to coalesce a burst of writes, short enough to be invisible. */
const SAVE_DEBOUNCE_MS = 400;

let handle: (ReturnType<typeof openWasmDatabase>) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let dirty = false;

export function isDeviceDatabaseReady(): boolean {
  return handle !== null;
}

/** Open the database, restoring whatever was saved last time. */
export async function initDeviceDatabase(): Promise<void> {
  if (handle) return;

  await initWasmSqlite();
  const saved = await idbGet<Uint8Array | ArrayBuffer>(META_STORE, DB_KEY);
  const bytes =
    saved instanceof ArrayBuffer ? new Uint8Array(saved) : (saved ?? null);

  try {
    handle = openWasmDatabase(bytes);
  } catch (err) {
    // A corrupt save must not brick the app. Start clean and say so — the
    // user still has whatever .fcbackup they made.
    console.error("[flashcards] saved database unreadable, starting fresh", err);
    handle = openWasmDatabase(null);
  }

  registerDatabase(handle);
  runMigrations(handle, false);

  void requestPersistence();
  installFlushHooks();

  // A brand-new database has nothing saved yet; do it now so a crash before
  // the first write still leaves a valid file behind.
  if (!bytes) await flush();
}

/** Note that something changed and schedule a save. */
export function markDirty(): void {
  if (!handle) return;
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

/** Write the database out now. Safe to call concurrently. */
export async function flush(): Promise<void> {
  if (!handle || !dirty) return;
  if (saving) return saving;

  saving = (async () => {
    try {
      // Snapshot first: serialising is synchronous, so the bytes cannot be
      // torn by a write that lands while IndexedDB is busy.
      const bytes = handle!.export();
      dirty = false;
      await idbSet(META_STORE, DB_KEY, bytes);
    } catch (err) {
      dirty = true; // try again on the next change
      console.error("[flashcards] could not save the database", err);
    } finally {
      saving = null;
    }
  })();
  return saving;
}

/**
 * Android kills backgrounded apps without warning, and `pagehide` is the last
 * reliable moment to write. `visibilitychange` covers the common case of
 * switching away.
 */
function installFlushHooks(): void {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => void flush());
}
