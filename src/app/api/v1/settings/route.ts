import { handler, ok, parseBody } from "@/lib/api";
import { getSettings, setSettings } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { settingsUpdate } from "@/lib/validators";

export const dynamic = "force-dynamic";

export const GET = handler(async () => ok(getSettings()));

export const PATCH = handler(async (ctx) => {
  const body = await parseBody(ctx.req, settingsUpdate);
  if (!body.ok) return body.response;

  setSettings(body.data);
  logEvent({
    actor: ctx.actor,
    action: "settings.update",
    summary: `Changed ${Object.keys(body.data).join(", ") || "nothing"}`,
    meta: body.data,
  });
  return ok(getSettings());
});
