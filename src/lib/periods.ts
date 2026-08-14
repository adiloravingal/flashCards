import { getDb } from "./db";

/**
 * Period aggregation for the Progress screen.
 *
 * Everything is computed from `review_log` rather than the denormalised
 * `daily_stats` table, because a day view needs hour-level buckets and only
 * the log knows exact timestamps. It also means undone reviews are excluded
 * for free.
 *
 * All boundaries are local-time: a "day" is your midnight, not UTC's, or the
 * chart would show you studying at 2am when you didn't.
 */

export type PeriodUnit = "day" | "week" | "month";

export interface Bucket {
  /** Short axis label, e.g. "9a", "Mon", "14". */
  label: string;
  /** Whether to print the label — hourly axes get too crowded otherwise. */
  showLabel: boolean;
  reviews: number;
  ms: number;
  again: number;
  newCards: number;
  /** True for the bucket containing "now", so today can be marked. */
  current: boolean;
}

export interface PeriodTotals {
  reviews: number;
  ms: number;
  newCards: number;
  /** Correct answers over reviews of already-learned cards, or null if none. */
  recall: number | null;
  /** Distinct local days with at least one review. */
  activeDays: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface PeriodResult {
  unit: PeriodUnit;
  offset: number;
  start: number;
  end: number;
  label: string;
  /** True when `offset` is 0 — used to disable the "forward" control. */
  isCurrent: boolean;
  /** False once we've scrolled back past the oldest review. */
  hasEarlier: boolean;
  buckets: Bucket[];
  totals: PeriodTotals;
  previous: PeriodTotals;
  /** Best bucket in the period, for the "most active" line. */
  peak: { label: string; reviews: number } | null;
}

const startOfDay = (d: Date): Date => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
};

/** Weeks start on Monday — the study week people actually think in. */
const startOfWeek = (d: Date): Date => {
  const out = startOfDay(d);
  const day = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - day);
  return out;
};

const startOfMonth = (d: Date): Date => {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
};

/** The [start, end) window for a unit, `offset` periods back from now. */
export function periodRange(unit: PeriodUnit, offset: number): {
  start: Date;
  end: Date;
} {
  const now = new Date();

  if (unit === "day") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  if (unit === "week") {
    const start = startOfWeek(now);
    start.setDate(start.getDate() - offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  const start = startOfMonth(now);
  start.setMonth(start.getMonth() - offset);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

function labelFor(unit: PeriodUnit, start: Date, offset: number): string {
  if (unit === "day") {
    if (offset === 0) return "Today";
    if (offset === 1) return "Yesterday";
    return start.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  if (unit === "week") {
    if (offset === 0) return "This week";
    if (offset === 1) return "Last week";
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const sameMonth = start.getMonth() === end.getMonth();
    return sameMonth
      ? `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString(undefined, { month: "short" })}`
      : `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }

  if (offset === 0) return "This month";
  if (offset === 1) return "Last month";
  return start.toLocaleDateString(undefined, {
    month: "long",
    ...(start.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

interface LogRow {
  reviewed_at: number;
  rating: number;
  duration_ms: number;
  prev_state: number;
}

function fetchLogs(start: number, end: number): LogRow[] {
  return getDb()
    .prepare(
      `SELECT reviewed_at, rating, duration_ms, prev_state
         FROM review_log
        WHERE undone = 0 AND reviewed_at >= ? AND reviewed_at < ?`,
    )
    .all(start, end) as LogRow[];
}

function summarise(rows: LogRow[]): PeriodTotals {
  const totals: PeriodTotals = {
    reviews: rows.length,
    ms: 0,
    newCards: 0,
    recall: null,
    activeDays: 0,
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  };

  const days = new Set<string>();
  let matureSeen = 0;
  let matureCorrect = 0;

  for (const row of rows) {
    totals.ms += row.duration_ms;
    if (row.prev_state === 0) totals.newCards++;

    if (row.rating === 1) totals.again++;
    else if (row.rating === 2) totals.hard++;
    else if (row.rating === 3) totals.good++;
    else if (row.rating === 4) totals.easy++;

    // Recall only counts cards that were already in review — grading a card
    // you're still learning says nothing about long-term retention.
    if (row.prev_state === 2) {
      matureSeen++;
      if (row.rating > 1) matureCorrect++;
    }

    const d = new Date(row.reviewed_at);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }

  totals.activeDays = days.size;
  totals.recall = matureSeen > 0 ? matureCorrect / matureSeen : null;
  return totals;
}

export function buildPeriod(unit: PeriodUnit, offset: number): PeriodResult {
  const { start, end } = periodRange(unit, offset);
  const rows = fetchLogs(start.getTime(), end.getTime());

  const prevRange = periodRange(unit, offset + 1);
  const previous = summarise(
    fetchLogs(prevRange.start.getTime(), prevRange.end.getTime()),
  );

  // ---- Buckets -----------------------------------------------------------
  const now = Date.now();
  const buckets: Bucket[] = [];

  const makeBucket = (
    label: string,
    showLabel: boolean,
    from: Date,
    to: Date,
  ): Bucket => {
    const inRange = rows.filter(
      (r) => r.reviewed_at >= from.getTime() && r.reviewed_at < to.getTime(),
    );
    return {
      label,
      showLabel,
      reviews: inRange.length,
      ms: inRange.reduce((n, r) => n + r.duration_ms, 0),
      again: inRange.filter((r) => r.rating === 1).length,
      newCards: inRange.filter((r) => r.prev_state === 0).length,
      current: now >= from.getTime() && now < to.getTime(),
    };
  };

  if (unit === "day") {
    for (let hour = 0; hour < 24; hour++) {
      const from = new Date(start);
      from.setHours(hour);
      const to = new Date(from);
      to.setHours(hour + 1);
      const label =
        hour === 0 ? "12a" : hour === 12 ? "12p" : hour < 12 ? `${hour}a` : `${hour - 12}p`;
      buckets.push(makeBucket(label, hour % 6 === 0, from, to));
    }
  } else {
    const days = unit === "week" ? 7 : Math.round((end.getTime() - start.getTime()) / 86_400_000);
    for (let i = 0; i < days; i++) {
      const from = new Date(start);
      from.setDate(from.getDate() + i);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      const label =
        unit === "week"
          ? from.toLocaleDateString(undefined, { weekday: "narrow" })
          : String(from.getDate());
      // A month has too many days to label every bar legibly.
      const showLabel = unit === "week" || i === 0 || (i + 1) % 5 === 0;
      buckets.push(makeBucket(label, showLabel, from, to));
    }
  }

  // ---- Is there anything further back? -----------------------------------
  const earliest = getDb()
    .prepare("SELECT MIN(reviewed_at) AS t FROM review_log WHERE undone = 0")
    .get() as { t: number | null };
  const hasEarlier = earliest.t !== null && earliest.t < start.getTime();

  const peakBucket = buckets.reduce<Bucket | null>(
    (best, b) => (b.reviews > (best?.reviews ?? 0) ? b : best),
    null,
  );

  return {
    unit,
    offset,
    start: start.getTime(),
    end: end.getTime(),
    label: labelFor(unit, start, offset),
    isCurrent: offset === 0,
    hasEarlier,
    buckets,
    totals: summarise(rows),
    previous,
    peak: peakBucket && peakBucket.reviews > 0
      ? { label: peakBucket.label, reviews: peakBucket.reviews }
      : null,
  };
}
