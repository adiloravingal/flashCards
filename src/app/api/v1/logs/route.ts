import { handler, ok } from "@/lib/api";
import { queryLogs, type Actor, type LogLevel } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = handler(async (ctx) => {
  const sp = new URL(ctx.req.url).searchParams;
  return ok(
    queryLogs({
      limit: Number(sp.get("limit") ?? 200) || 200,
      before: sp.get("before") ? Number(sp.get("before")) : undefined,
      actor: (sp.get("actor") as Actor) || undefined,
      level: (sp.get("level") as LogLevel) || undefined,
      action: sp.get("action") || undefined,
      search: sp.get("q") || undefined,
    }),
  );
});
