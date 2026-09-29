/**
 * Two-step imports need the uploaded bytes to survive between the preview and
 * the commit. On a server that means a temp file; here the two calls happen
 * milliseconds apart in the same process, so a Map is enough — and it avoids
 * writing a second copy of a large deck into storage just to read it back.
 */
const staged = new Map<string, Uint8Array>();

export function stageDevice(bytes: Uint8Array): string {
  const id = globalThis.crypto.randomUUID();
  staged.set(id, bytes);
  return id;
}

export const readDeviceStaged = (id: string): Uint8Array | undefined => staged.get(id);
export const discardDeviceStaged = (id: string): void => void staged.delete(id);
