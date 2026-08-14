import { handler, ok } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { getStats } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handler(async () =>
  ok({ ...getStats(), settings: getSettings() }),
);
