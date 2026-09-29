/**
 * One request function for both worlds.
 *
 * On a server build this is `fetch`. On a device build there is no server, so
 * the same path is answered locally by the dispatcher — which returns real
 * `Response` objects, so nothing downstream can tell the difference.
 *
 * The device module is imported lazily so the server bundle never pulls in
 * SQLite-WASM, and the static bundle only loads it when it is actually used.
 */

export const IS_DEVICE_BUILD = process.env.NEXT_PUBLIC_FC_TARGET === "device";

type Dispatch = (path: string, init?: RequestInit) => Promise<Response>;

let dispatcher: Promise<Dispatch> | null = null;

function deviceDispatcher(): Promise<Dispatch> {
  dispatcher ??= import("./device/bootstrap").then((m) => m.dispatchOnDevice);
  return dispatcher;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (IS_DEVICE_BUILD) {
    const dispatch = await deviceDispatcher();
    return dispatch(path, init);
  }
  return fetch(path, init);
}
