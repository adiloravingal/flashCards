import { getDb } from "../db";
import { registerMediaUrlResolver } from "../mediaStore";
import { initDeviceDatabase } from "./db-browser";
import { dispatch } from "./dispatch";
import { MEDIA_STORE, idbGet } from "./idb";
import { registerDeviceMediaStore } from "./mediaStore-idb";

/**
 * Brings the device data layer up, once, before the first request.
 *
 * Media needs a little care. `repo.hydrate()` is synchronous and has to hand
 * the UI something an <img src> can load, but reading bytes out of IndexedDB
 * is not. So every known file gets a blob: URL up front, and newly uploaded
 * ones are registered as they arrive.
 */

let ready: Promise<void> | null = null;
const objectUrls = new Map<string, string>();

function resolver(filename: string): string {
  return objectUrls.get(filename) ?? "";
}

async function cacheUrl(filename: string, mime: string): Promise<void> {
  if (objectUrls.has(filename)) return;
  const bytes = await idbGet<Uint8Array | ArrayBuffer>(MEDIA_STORE, filename);
  if (!bytes) return;
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  objectUrls.set(
    filename,
    URL.createObjectURL(new Blob([view.slice().buffer as ArrayBuffer], { type: mime })),
  );
}

/** Give every stored file a blob: URL so synchronous reads can use it. */
async function primeMediaUrls(): Promise<void> {
  const rows = getDb()
    .prepare("SELECT filename, mime FROM media")
    .all() as { filename: string; mime: string }[];
  for (const row of rows) await cacheUrl(row.filename, row.mime);
}

async function boot(): Promise<void> {
  registerDeviceMediaStore();
  registerMediaUrlResolver(resolver);
  await initDeviceDatabase();
  await primeMediaUrls();
}

export async function dispatchOnDevice(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  ready ??= boot();
  await ready;

  const response = await dispatch(path, init);

  // An upload just added rows the resolver has never seen; refresh so the
  // image appears immediately rather than after a reload.
  if (path.startsWith("/api/v1/media") && response.ok) {
    await primeMediaUrls();
  }
  return response;
}
