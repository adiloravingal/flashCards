import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { fail, ok } from "@/lib/api";
import { UNLOCK_COOKIE, uiIsLocked } from "@/lib/auth";
import { getAgentKey } from "@/lib/db";
import { logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/unlock { key } — exchange the API key for a long-lived cookie.
 * Only relevant when FC_LOCK_UI=1 (i.e. you are hosting this on a network).
 */
export async function POST(req: Request) {
  let key = "";
  try {
    key = ((await req.json()) as { key?: string })?.key ?? "";
  } catch {
    return fail(400, "invalid_json", "Body must be JSON: { \"key\": \"...\" }");
  }

  const expected = getAgentKey();
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  const matches = a.length === b.length && timingSafeEqual(a, b);

  if (!matches) {
    logEvent({
      actor: "you",
      level: "warn",
      action: "unlock.failed",
      summary: "Wrong key entered on the unlock screen",
    });
    return fail(401, "bad_key", "That key doesn't match.");
  }

  const res = NextResponse.json({ ok: true, data: { unlocked: true } });
  res.cookies.set(UNLOCK_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  logEvent({ actor: "you", action: "unlock.success", summary: "Unlocked the UI" });
  return res;
}

export async function GET() {
  return ok({ locked: uiIsLocked() });
}
