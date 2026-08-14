import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, clientIp } from "./auth";
import { logEvent, type Actor } from "./log";

export interface Ctx {
  actor: Actor;
  ip: string | null;
  req: Request;
}

export const ok = <T>(data: T, init?: ResponseInit) =>
  NextResponse.json({ ok: true, data }, init);

export const fail = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
) =>
  NextResponse.json(
    { ok: false, error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );

/**
 * Wrap a route handler with auth, logging and uniform error shapes.
 *
 * Every response is `{ ok: true, data }` or `{ ok: false, error: {...} }`.
 * That predictability is deliberate: an AI agent calling this API should never
 * have to guess whether something worked.
 */
export function handler<A extends unknown[]>(
  fn: (ctx: Ctx, ...args: A) => Promise<Response> | Response,
) {
  return async (req: Request, ...args: A): Promise<Response> => {
    const auth = authenticate(req);
    if (!auth.ok) {
      logEvent({
        actor: auth.actor,
        level: "warn",
        action: "auth.denied",
        summary: `Rejected ${req.method} ${new URL(req.url).pathname}`,
        meta: { reason: auth.reason },
        ip: clientIp(req),
      });
      return fail(
        401,
        auth.reason === "locked" ? "locked" : "unauthorized",
        auth.reason === "locked"
          ? "This instance is locked. Unlock the UI or send your API key."
          : "Missing or invalid API key. Send `Authorization: Bearer <key>`.",
      );
    }

    try {
      return await fn({ actor: auth.actor, ip: clientIp(req), req }, ...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[flashcards] api error", err);
      logEvent({
        actor: auth.actor,
        level: "error",
        action: "api.error",
        summary: `${req.method} ${new URL(req.url).pathname} failed`,
        meta: { message },
        ip: clientIp(req),
      });
      return fail(500, "internal_error", message);
    }
  };
}

/**
 * Read a bounded integer from the query string.
 * Floors and clamps rather than erroring — these are pagination knobs, and a
 * float reaching a SQL LIMIT is a crash waiting to happen.
 */
export function intParam(
  sp: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number(sp.get(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), min), max);
}

/** Parse a JSON body against a schema, returning a 400 with field details. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: fail(400, "invalid_json", "Request body must be valid JSON."),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: fail(
        400,
        "invalid_body",
        "Request body failed validation.",
        result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      ),
    };
  }
  return { ok: true, data: result.data };
}
