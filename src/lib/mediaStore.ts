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

/**
 * How a media row turns into something an <img src> can load.
 *
 * On a server that's a URL the media route serves. On a device there is no
 * server, so the bootstrap registers a resolver returning blob: URLs it made
 * up front. This stays synchronous because `hydrate()` is synchronous, and
 * making it async would ripple through every read path in repo.ts.
 */
type UrlResolver = (filename: string, mediaId: string) => string;

let urlResolver: UrlResolver | null = null;

export function registerMediaUrlResolver(fn: UrlResolver): void {
  urlResolver = fn;
}

export function mediaUrlFor(filename: string, mediaId: string): string {
  return urlResolver
    ? urlResolver(filename, mediaId)
    : `/api/v1/media/${mediaId}/raw`;
}

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
