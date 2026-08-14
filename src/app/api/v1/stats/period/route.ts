import { handler, intParam, ok } from "@/lib/api";
import { buildPeriod, type PeriodUnit } from "@/lib/periods";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stats/period?unit=day|week|month&offset=0
 *
 * `offset` counts backwards: 0 is the current period, 1 the one before it.
 * Returns buckets for the chart, totals, and the previous period's totals so
 * the screen can say "down 12% from last week" without a second request.
 */
export const GET = handler(async (ctx) => {
  const sp = new URL(ctx.req.url).searchParams;
  const raw = sp.get("unit");
  const unit: PeriodUnit =
    raw === "week" || raw === "month" ? raw : "day";
  // Two years back is further than anyone will swipe, and bounds the work.
  const offset = intParam(sp, "offset", 0, 0, 800);

  return ok(buildPeriod(unit, offset));
});
