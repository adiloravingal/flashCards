/**
 * A very small IndexedDB wrapper — the durable layer underneath the device
 * build.
 *
 * IndexedDB rather than OPFS or a Capacitor plugin because it works
 * identically in a plain browser and inside the Android WebView, so the same
 * bundle backs both the phone app and the browser demo with no branching and
 * no native dependency.
 *
 * Two stores, kept separate on purpose:
 *   meta   the serialised SQLite database
 *   media  one entry per uploaded file
 *
 * Keeping media out of the SQLite file matters: the database is written back
 * whole on every change, and folding images into it would mean rewriting
 * megabytes every time you answer a card.
 */

const DB_NAME = "flashcards";
const DB_VERSION = 1;
export const META_STORE = "meta";
export const MEDIA_STORE = "media";

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
    request.onblocked = () =>
      reject(new Error("Another tab is holding the database open."));
  });
  return connection;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = fn(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error ?? new Error("Write aborted"));
      }),
  );
}

export const idbGet = <T>(store: string, key: string): Promise<T | undefined> =>
  run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);

export const idbSet = (store: string, key: string, value: unknown): Promise<void> =>
  run(store, "readwrite", (s) => s.put(value, key) as IDBRequest<unknown>).then(
    () => undefined,
  );

export const idbDelete = (store: string, key: string): Promise<void> =>
  run(store, "readwrite", (s) => s.delete(key) as IDBRequest<undefined>).then(
    () => undefined,
  );

export const idbKeys = (store: string): Promise<string[]> =>
  run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()).then((keys) =>
    keys.map(String),
  );

/**
 * Ask the browser not to evict this data under storage pressure. Granted
 * without a prompt for an installed app; best-effort in a plain tab.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported — the data is still stored, just evictable */
  }
  return false;
}
