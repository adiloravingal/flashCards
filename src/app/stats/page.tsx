"use client";

import Link from "next/link";
import { PeriodReport } from "@/components/PeriodReport";
import { Badge, Icon, PageHeader, Panel, Spinner } from "@/components/ui";
import { cx, formatDuration, useApi } from "@/lib/client";
import type { Card, Counts } from "@/lib/types";

interface Stats {
  counts: Counts;
  today: { reviews: number; ms_spent: number; new_cards: number };
  streak: number;
  history: {
    day: string;
    reviews: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
    ms_spent: number;
  }[];
  forecast: { day: string; count: number }[];
  retention30d: number | null;
  hardestCards: Card[];
  totalReviews: number;
  settings: { dailyGoal: number };
}

export default function StatsPage() {
  const { data, loading } = useApi<Stats>("/stats");

  if (loading && !data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
      </div>
    );
  }
  if (!data) return null;

  const totalTime = data.history.reduce((n, d) => n + d.ms_spent, 0);

  return (
    <>
      <PageHeader
        title="Progress"
        subtitle="What you've actually done, without the guilt-trip."
      />

      <PeriodReport />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
        <Metric
          label="Day streak"
          value={String(data.streak)}
          sub={data.streak === 0 ? "start one today" : "consecutive days"}
        />
        <Metric
          label="Recall rate"
          value={
            data.retention30d === null
              ? "—"
              : `${Math.round(data.retention30d * 100)}%`
          }
          sub="last 30 days"
        />
        <Metric
          label="Total reviews"
          value={data.totalReviews.toLocaleString()}
          sub="all time"
        />
        <Metric
          label="Time studied"
          value={totalTime > 0 ? formatDuration(totalTime) : "—"}
          sub="all time"
        />
      </div>

      {/* Activity heatmap — a year at a glance, no numbers to parse. */}
      <Panel className="p-5 mb-4">
        <h2 className="text-[15px] font-semibold mb-1">Activity</h2>
        <p className="text-[13px] text-[var(--text-muted)] mb-4">
          Last 26 weeks. Darker means more reviews.
        </p>
        <Heatmap history={data.history} />
      </Panel>

      {/* Upcoming workload — knowing tomorrow is light is motivating.
          The "reviews per day" chart that used to sit beside this is gone:
          the period report above says the same thing, and better. */}
      <Panel className="p-5 mb-4">
        <h2 className="text-[15px] font-semibold mb-1">Coming up</h2>
        <p className="text-[13px] text-[var(--text-muted)] mb-5">
          Cards due over the next two weeks
        </p>
        <BarChart
          data={data.forecast.map((d) => ({ label: d.day, value: d.count }))}
          color="var(--good)"
        />
      </Panel>

      {/* Card state breakdown */}
      <Panel className="p-5 mb-4">
        <h2 className="text-[15px] font-semibold mb-4">Your collection</h2>
        <div className="flex flex-wrap gap-6">
          <Stat label="Total cards" value={data.counts.total} />
          <Stat label="Due now" value={data.counts.due} tone="var(--good)" />
          <Stat label="Not started" value={data.counts.new} tone="var(--easy)" />
          <Stat label="Learning" value={data.counts.learning} tone="var(--hard)" />
          <Stat label="Paused" value={data.counts.suspended} />
        </div>
      </Panel>

      {/* The cards that keep tripping you up. */}
      {data.hardestCards.length > 0 && (
        <Panel className="p-5">
          <h2 className="text-[15px] font-semibold mb-1">Sticking points</h2>
          <p className="text-[13px] text-[var(--text-muted)] mb-4">
            Cards you&apos;ve forgotten most often. Often a sign the card is
            trying to hold too much — consider splitting it.
          </p>
          <div className="space-y-1.5">
            {data.hardestCards.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-3 py-2 rounded-[10px] bg-[var(--surface-2)]"
              >
                <span className="text-sm truncate grow">
                  {c.front || "(media only)"}
                </span>
                <Badge tone="neutral">
                  {c.lapses} lapse{c.lapses === 1 ? "" : "s"}
                </Badge>
              </div>
            ))}
          </div>
          <Link
            href="/search"
            className="inline-block mt-4 text-[13px] text-[var(--accent)] hover:underline"
          >
            Find and edit these cards
          </Link>
        </Panel>
      )}
    </>
  );
}

/* ========================================================================== */

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Panel className="p-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] mt-1 leading-none">
        {value}
      </p>
      {sub && <p className="text-[11px] text-[var(--text-faint)] mt-2">{sub}</p>}
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div>
      <p
        className="text-xl font-semibold tabular-nums"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </p>
      <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
    </div>
  );
}

function BarChart({
  data,
  color,
}: {
  data: { label: string; value: number }[];
  color: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.every((d) => d.value === 0)) {
    return (
      <p className="text-sm text-[var(--text-faint)] py-8 text-center">
        Nothing to show yet.
      </p>
    );
  }

  return (
    <div className="flex items-end gap-[3px] h-32">
      {data.map((d) => (
        <div
          key={d.label}
          className="flex-1 flex flex-col justify-end group relative min-w-0"
          title={`${d.label}: ${d.value}`}
        >
          <div
            className="rounded-[3px] transition-all duration-300 min-h-[2px]"
            style={{
              height: `${(d.value / max) * 100}%`,
              background: d.value === 0 ? "var(--surface-3)" : color,
              opacity: d.value === 0 ? 1 : 0.85,
            }}
          />
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[11px] font-medium tabular-nums opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)] whitespace-nowrap z-10">
            {d.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ history }: { history: { day: string; reviews: number }[] }) {
  const byDay = new Map(history.map((h) => [h.day, h.reviews]));
  const max = Math.max(1, ...history.map((h) => h.reviews));

  // 26 weeks ending with the current week, laid out column-per-week.
  const weeks: { day: string; reviews: number }[][] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - cursor.getDay()); // back to Sunday

  for (let w = 25; w >= 0; w--) {
    const start = new Date(cursor);
    start.setDate(start.getDate() - w * 7);
    const week: { day: string; reviews: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + d);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      week.push({ day: key, reviews: byDay.get(key) ?? 0 });
    }
    weeks.push(week);
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="overflow-x-auto no-scrollbar">
      <div className="flex gap-[3px] min-w-max">
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {week.map((d) => {
              const intensity = d.reviews === 0 ? 0 : 0.25 + (d.reviews / max) * 0.75;
              const future = d.day > todayKey;
              return (
                <div
                  key={d.day}
                  title={
                    future
                      ? ""
                      : `${d.day}: ${d.reviews} review${d.reviews === 1 ? "" : "s"}`
                  }
                  className={cx(
                    "w-[11px] h-[11px] rounded-[2.5px]",
                    d.day === todayKey && "ring-1 ring-[var(--accent)]",
                  )}
                  style={{
                    background: future
                      ? "transparent"
                      : d.reviews === 0
                        ? "var(--surface-3)"
                        : `color-mix(in srgb, var(--accent) ${intensity * 100}%, var(--surface-3))`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
