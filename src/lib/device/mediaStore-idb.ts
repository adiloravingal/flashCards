import { registerMediaStore, type MediaStore } from "../mediaStore";
import { MEDIA_STORE, idbDelete, idbGet, idbSet } from "./idb";

/**
 * Device media: one IndexedDB entry per file, keyed by the same generated
 * filename the database stores. Deliberately not inside the SQLite file —
 * that gets rewritten in full on every change, and images would make each
 * save enormous.
 */
const idbMediaStore: MediaStore = {
  async read(filename) {
    const value = await idbGet<Uint8Array | ArrayBuffer>(MEDIA_STORE, filename);
    if (!value) return null;
    return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  },
  async write(filename, bytes) {
    await idbSet(MEDIA_STORE, filename, bytes);
  },
  async remove(filename) {
    await idbDelete(MEDIA_STORE, filename);
  },
};

export function registerDeviceMediaStore(): void {
  registerMediaStore(idbMediaStore);
}
