"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./apiFetch";

/* ==========================================================================
 * A tiny typed fetch wrapper. Every API response is {ok,data} | {ok,error},
 * so this collapses that into "value or thrown Error" for callers.
 * ========================================================================== */

export class ApiError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  let body = rest.body;

  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const res = await apiFetch(`/api/v1${path}`, { ...rest, headers, body });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError("bad_response", `Server returned ${res.status}.`);
  }

  const p = payload as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; details?: unknown } };

  if (!p || typeof p !== "object" || !("ok" in p)) {
    throw new ApiError("bad_response", "Unexpected response shape.");
  }
  if (!p.ok) throw new ApiError(p.error.code, p.error.message, p.error.details);
  return p.data;
}

/* ==========================================================================
 * useApi — fetch on mount, expose { data, error, loading, reload }.
 * Deliberately minimal: this is a local app, there is no cache to invalidate.
 * ========================================================================== */

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/* ==========================================================================
 * Keyboard shortcuts
 * ========================================================================== */

const isTypingTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
};

export interface Hotkey {
  /** Lowercase key, e.g. "a", " ", "escape", "arrowright". */
  key: string;
  meta?: boolean;
  shift?: boolean;
  run: (e: KeyboardEvent) => void;
  /** Fire even while a text field has focus (used for Escape and ⌘K). */
  allowInInput?: boolean;
}

export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Older WebKit and some remote-input stacks report the space bar as
      // "Spacebar" rather than " ", so fall back to the physical code.
      const key =
        e.code === "Space" ? " " : (e.key ?? "").toLowerCase() === "spacebar"
          ? " "
          : (e.key ?? "").toLowerCase();
      for (const h of ref.current) {
        if (h.key !== key) continue;
        if (!!h.meta !== (e.metaKey || e.ctrlKey)) continue;
        if (h.shift !== undefined && h.shift !== e.shiftKey) continue;
        if (!h.allowInInput && isTypingTarget(e.target)) continue;
        e.preventDefault();
        h.run(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/* ==========================================================================
 * Formatting helpers used across screens
 * ========================================================================== */

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const future = diff < 0;

  const units: [number, string][] = [
    [60_000, "s"],
    [3_600_000, "m"],
    [86_400_000, "h"],
    [2_592_000_000, "d"],
  ];

  if (abs < 45_000) return future ? "in a moment" : "just now";
  if (abs < 3_600_000) {
    const n = Math.round(abs / 60_000);
    return future ? `in ${n}m` : `${n}m ago`;
  }
  if (abs < 86_400_000) {
    const n = Math.round(abs / 3_600_000);
    return future ? `in ${n}h` : `${n}h ago`;
  }
  if (abs < 2_592_000_000) {
    const n = Math.round(abs / 86_400_000);
    return future ? `in ${n}d` : `${n}d ago`;
  }
  void units;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Class-name joiner. Accepts numbers because SQLite booleans arrive as 0 | 1,
 * so `card.suspended && "..."` evaluates to 0 rather than false.
 */
export const cx = (
  ...parts: (string | number | false | null | undefined)[]
): string => parts.filter((p): p is string => typeof p === "string" && p !== "").join(" ");
