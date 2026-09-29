/**
 * Where uploaded files actually live.
 *
 * The database only ever holds a row describing a file — its name, type, size
 * and hash. The bytes sit behind this interface so the same code path works
 * against a folder on a server and IndexedDB on a phone.
 */
export interface MediaStore {
  read(filename: string): Promise<Uint8Array | null>;
  write(filename: string, bytes: Uint8Array): Promise<void>;
  remove(filename: string): Promise<void>;
}

let store: MediaStore | null = null;

export function registerMediaStore(next: MediaStore): void {
  store = next;
}

export function mediaStore(): MediaStore {
  if (!store) {
    throw new Error(
      "No media store registered. Import db-node (server) or the device bootstrap first.",
    );
  }
  return store;
}
