import { handler, ok } from "@/lib/api";
import { DATA_DIR } from "@/lib/db";
import { countCardsInScope } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handler(async (ctx) =>
  ok({
    status: "ok",
    actor: ctx.actor,
    dataDir: DATA_DIR,
    time: Date.now(),
    counts: countCardsInScope({ kind: "all" }),
  }),
);
