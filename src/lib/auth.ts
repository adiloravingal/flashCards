import { timingSafeEqual } from "node:crypto";
import { getAgentKey } from "./db";
import type { Actor } from "./log";

export const UNLOCK_COOKIE = "fc_unlock";

/** True when the app is configured to require the key for the web UI too. */
export function uiIsLocked(): boolean {
  const v = (process.env.FC_LOCK_UI || "0").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface AuthResult {
  ok: boolean;
  actor: Actor;
  reason?: string;
}

/**
 * Decide whether a request may touch the API, and who to blame in the logs.
 *
 * Three ways in:
 *   1. `Authorization: Bearer <agent key>`  -> actor "agent"   (what AI agents use)
 *   2. `X-Api-Key: <agent key>`             -> actor "agent"   (convenience)
 *   3. the unlock cookie                    -> actor "you"     (the web UI)
 *
 * When FC_LOCK_UI is off (the default, i.e. running on your own machine) a
 * request with no credentials at all is accepted as "you". That is the
 * zero-friction path: open localhost, start studying, no login screen.
 */
export function authenticate(req: Request): AuthResult {
  const key = getAgentKey();

  const header = req.headers.get("authorization");
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const apiKeyHeader = req.headers.get("x-api-key")?.trim();
  const presented = bearer || apiKeyHeader;

  if (presented) {
    if (key && constantTimeEquals(presented, key)) {
      return { ok: true, actor: "agent" };
    }
    return { ok: false, actor: "agent", reason: "invalid_key" };
  }

  const cookie = readCookie(req, UNLOCK_COOKIE);
  if (cookie && key && constantTimeEquals(cookie, key)) {
    return { ok: true, actor: "you" };
  }

  if (!uiIsLocked()) return { ok: true, actor: "you" };

  return { ok: false, actor: "you", reason: "locked" };
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}
