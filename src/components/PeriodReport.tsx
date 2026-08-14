"use client";

import { useEffect, useRef, useState } from "react";
import { api, cx, formatDuration } from "@/lib/client";
import { Icon, Panel, Spinner } from "./ui";

type Unit = "day" | "week" | "month";

interface Bucket {
  label: string;
  showLabel: boolean;
  reviews: number;
  ms: number;
  again: number;
  newCards: number;
  current: boolean;
}

interface Totals {
  reviews: number;
  ms: number;
  newCards: number;
  recall: number | null;
  activeDays: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface Period {
  unit: Unit;
  offset: number;
  label: string;
  isCurrent: boolean;
  hasEarlier: boolean;
  buckets: Bucket[];
  totals: Totals;
  previous: Totals;
  peak: { label: string; reviews: number } | null;
}

const UNITS: { key: Unit; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/**
 * Reviewing history, one period at a time.
 *
 * Deliberately shows a *single* period rather than an endless scroll: a bounded
 * window you step through is easier to read than a wall of every day you've
 * ever studied, and stepping back is a choice rather than something you fall
 * into.
 */
export function PeriodReport() {
  const [unit, setUnit] = useState<Unit>("week");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);
  // Direction the incoming period should animate from, so stepping back and
  // forward feel like moving along a timeline rather than a flicker.
  const [slideFrom, setSlideFrom] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Period>(`/stats/period?unit=${unit}&offset=${offset}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unit, offset]);

  const goBack = () => {
    if (data && !data.hasEarlier) return;
    setSlideFrom("left");
    setOffset((o) => o + 1);
  };
  const goForward = () => {
    if (offset === 0) return;
    setSlideFrom("right");
    setOffset((o) => Math.max(0, o - 1));
  };

  // Arrow keys mirror the swipe, so this works with a keyboard too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /input|textarea|select/i.test(el.tagName)) return;
      if (e.key === "ArrowLeft") goBack();
      if (e.key === "ArrowRight") goForward();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Swipe -------------------------------------------------------------
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const from = touch.current;
    touch.current = null;
    if (!from) return;
    const dx = e.changedTouches[0].clientX - from.x;
    const dy = e.changedTouches[0].clientY - from.y;
    // Ignore anything that's mostly vertical — that's the page scrolling.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0) goBack();
    else goForward();
  };

  if (!data) {
    return (
      <Panel className="p-5 mb-4 grid place-items-center h-64">
        <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
      </Panel>
    );
  }

  const max = Math.max(...data.buckets.map((b) => b.reviews), 1);
  const t = data.totals;
  const p = data.previous;

  return (
    <Panel className="p-4 sm:p-5 mb-4 overflow-hidden">
      {/* Unit switcher */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="inline-flex p-0.5 rounded-[10px] bg-[var(--surface-2)]">
          {UNITS.map((u) => (
            <button
              key={u.key}
              onClick={() => {
                setUnit(u.key);
                setOffset(0);
                setSlideFrom(null);
              }}
              className={cx(
                "px-3 h-7 rounded-lg text-[13px] font-medium transition-colors",
                unit === u.key
                  ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]",
              )}
            >
              {u.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5">
          <StepButton
            icon="chevronLeft"
            label="Earlier"
            onClick={goBack}
            disabled={!data.hasEarlier}
          />
          <StepButton
            icon="chevronRight"
            label="Later"
            onClick={goForward}
            disabled={offset === 0}
          />
        </div>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="touch-pan-y select-none"
      >
        <div
          key={`${unit}-${offset}`}
          className={cx(
            slideFrom === "left" && "anim-slide-from-left",
            slideFrom === "right" && "anim-slide-from-right",
          )}
        >
          {/* Headline */}
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[13px] text-[var(--text-muted)]">{data.label}</p>
              <p className="text-[34px] leading-[1.1] font-semibold tabular-nums mt-0.5">
                {t.reviews.toLocaleString()}
                <span className="text-base font-normal text-[var(--text-muted)] ml-1.5">
                  {t.reviews === 1 ? "review" : "reviews"}
                </span>
              </p>
            </div>
            <Delta current={t.reviews} previous={p.reviews} unit={data.unit} />
          </div>

          {/* Chart */}
          <div className="mt-5">
            <div className="flex items-end gap-[3px] h-36">
              {data.buckets.map((b, i) => {
                const height = b.reviews === 0 ? 0 : Math.max(4, (b.reviews / max) * 100);
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col justify-end h-full group relative"
                    title={`${b.label}: ${b.reviews} review${b.reviews === 1 ? "" : "s"}`}
                  >
                    {b.reviews > 0 && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {b.reviews}
                      </span>
                    )}
                    <div
                      className={cx(
                        "w-full rounded-[3px] transition-[height] duration-300 ease-out",
                        b.reviews === 0
                          ? "bg-[var(--surface-3)] h-[3px]"
                          : b.current
                            ? "bg-[var(--accent)]"
                            : "bg-[var(--accent)]/55 group-hover:bg-[var(--accent)]",
                      )}
                      style={{ height: b.reviews === 0 ? 3 : `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex gap-[3px] mt-2">
              {data.buckets.map((b, i) => (
                <span
                  key={i}
                  className={cx(
                    "flex-1 text-center text-[10px] tabular-nums",
                    b.current
                      ? "text-[var(--accent)] font-medium"
                      : "text-[var(--text-faint)]",
                  )}
                >
                  {b.showLabel ? b.label : ""}
                </span>
              ))}
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-6">
            <Stat
              label="Time"
              value={t.ms > 0 ? formatDuration(t.ms) : "—"}
              sub={p.ms > 0 ? `was ${formatDuration(p.ms)}` : undefined}
            />
            <Stat
              label="New cards"
              value={t.newCards.toLocaleString()}
              sub={p.newCards > 0 ? `was ${p.newCards}` : undefined}
            />
            <Stat
              label="Recall"
              value={t.recall === null ? "—" : `${Math.round(t.recall * 100)}%`}
              sub={
                p.recall === null ? undefined : `was ${Math.round(p.recall * 100)}%`
              }
            />
            <Stat
              label={data.unit === "day" ? "Busiest hour" : "Active days"}
              value={
                data.unit === "day"
                  ? (data.peak?.label ?? "—")
                  : String(t.activeDays)
              }
              sub={
                data.unit === "day"
                  ? data.peak
                    ? `${data.peak.reviews} reviews`
                    : undefined
                  : `of ${data.buckets.length}`
              }
            />
          </div>

          {/* How it went */}
          {t.reviews > 0 && (
            <div className="mt-5">
              <div className="flex h-2 rounded-full overflow-hidden bg-[var(--surface-2)]">
                {(
                  [
                    ["again", t.again, "var(--again)"],
                    ["hard", t.hard, "var(--hard)"],
                    ["good", t.good, "var(--good)"],
                    ["easy", t.easy, "var(--easy)"],
                  ] as const
                ).map(([key, value, color]) =>
                  value > 0 ? (
                    <div
                      key={key}
                      style={{
                        width: `${(value / t.reviews) * 100}%`,
                        background: color,
                      }}
                      title={`${key}: ${value}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                {(
                  [
                    ["Again", t.again, "var(--again)"],
                    ["Hard", t.hard, "var(--hard)"],
                    ["Good", t.good, "var(--good)"],
                    ["Easy", t.easy, "var(--easy)"],
                  ] as const
                ).map(([label, value, color]) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: color }}
                    />
                    {label}
                    <span className="tabular-nums text-[var(--text-faint)]">
                      {value}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {t.reviews === 0 && (
            <p className="text-[13px] text-[var(--text-muted)] mt-6 text-center py-4">
              {data.isCurrent
                ? "Nothing yet this " + data.unit + "."
                : "No reviews in this " + data.unit + "."}
            </p>
          )}
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-faint)] mt-5 text-center">
        Swipe or use <span className="kbd">←</span> <span className="kbd">→</span>{" "}
        to move between {data.unit}s
        {loading && <span className="ml-2 opacity-60">updating…</span>}
      </p>
    </Panel>
  );
}

function StepButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-8 h-8 rounded-lg grid place-items-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-[var(--radius)] bg-[var(--surface-2)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p className="text-[17px] font-semibold tabular-nums mt-0.5 leading-tight">
        {value}
      </p>
      <p className="text-[11px] text-[var(--text-faint)] tabular-nums h-4">
        {sub ?? ""}
      </p>
    </div>
  );
}

/** "+18% vs last week" — omitted entirely when there's nothing to compare. */
function Delta({
  current,
  previous,
  unit,
}: {
  current: number;
  previous: number;
  unit: Unit;
}) {
  if (previous === 0 && current === 0) return null;

  const noun = unit === "day" ? "day" : unit === "week" ? "week" : "month";

  if (previous === 0) {
    return (
      <span className="text-[13px] text-[var(--text-faint)]">
        nothing last {noun}
      </span>
    );
  }

  const change = Math.round(((current - previous) / previous) * 100);
  const flat = change === 0;
  const up = change > 0;

  return (
    <span
      className={cx(
        "text-[13px] font-medium tabular-nums",
        flat
          ? "text-[var(--text-faint)]"
          : up
            ? "text-[var(--good)]"
            : "text-[var(--text-muted)]",
      )}
    >
      {flat ? "same as" : `${up ? "+" : ""}${change}% vs`} last {noun}
    </span>
  );
}
