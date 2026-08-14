"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Badge, Button, Icon, Panel, Spinner } from "@/components/ui";
import { api, cx, useApi } from "@/lib/client";
import type { Counts } from "@/lib/types";

interface Stats {
  counts: Counts;
  today: { reviews: number; ms_spent: number; new_cards: number };
  streak: number;
  history: { day: string; reviews: number }[];
  settings: { dailyGoal: number; sessionSize: number };
  totalReviews: number;
}

interface CourseSummary {
  id: string;
  name: string;
  emoji: string;
  totalCards: number;
  dueCards: number;
  newCards: number;
}

export default function TodayPage() {
  const stats = useApi<Stats>("/stats");
  const courses = useApi<CourseSummary[]>("/courses");

  // Quick-add and other flows announce changes; refresh rather than go stale.
  useEffect(() => {
    const onChange = () => {
      void stats.reload();
      void courses.reload();
    };
    window.addEventListener("fc:data-changed", onChange);
    return () => window.removeEventListener("fc:data-changed", onChange);
  }, [stats, courses]);

  if (stats.loading && !stats.data) {
    return (
      <div className="grid place-items-center py-32">
        <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
      </div>
    );
  }

  const s = stats.data;
  const totalCards = s?.counts.total ?? 0;
  const ready = (s?.counts.due ?? 0) + Math.min(s?.counts.new ?? 0, 20);
  const goal = s?.settings.dailyGoal ?? 40;
  const doneToday = s?.today.reviews ?? 0;
  const goalPct = Math.min(100, (doneToday / goal) * 100);

  /* ---- First run: one instruction, two ways forward -------------------- */
  if (totalCards === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 anim-fade-up">
        <div className="w-14 h-14 rounded-[16px] bg-[var(--accent)] grid place-items-center mx-auto mb-6">
          <Icon
            name="layers"
            className="w-7 h-7 text-[var(--accent-text)]"
            strokeWidth={2}
          />
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] mb-2.5">
          Let&apos;s make your first cards
        </h1>
        <p className="text-[15px] text-[var(--text-muted)] mb-8 leading-relaxed">
          Bring a spreadsheet you already have, or write a card by hand. Either
          takes under a minute.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 text-left">
          <StartCard
            href="/import"
            icon="upload"
            title="Import a file"
            body="Excel or CSV. Each sheet becomes a chapter."
          />
          <StartCard
            href="/add"
            icon="plus"
            title="Write one"
            body="Front, back, done. Attach anything you like."
          />
        </div>

        <p className="text-xs text-[var(--text-faint)] mt-8">
          Prefer to have an AI fill this in?{" "}
          <Link href="/docs#agents" className="text-[var(--accent)] hover:underline">
            Point it at the API
          </Link>
          .
        </p>
      </div>
    );
  }

  /* ---- Normal day ------------------------------------------------------ */
  return (
    <div className="anim-fade-up">
      <header className="mb-8">
        <p className="text-sm text-[var(--text-muted)] mb-1">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">
          {ready > 0 ? "Ready when you are" : "You're all caught up"}
        </h1>
      </header>

      {/* The one big decision on this page. */}
      {ready > 0 ? (
        <Link href="/review" className="block group mb-4">
          <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-[var(--accent)] text-[var(--accent-text)] p-6 sm:p-7 transition-transform duration-200 group-hover:scale-[1.004] group-active:scale-[0.997]">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-[44px] sm:text-[52px] leading-none font-semibold tabular-nums tracking-[-0.03em]">
                  {ready}
                </div>
                <div className="text-[15px] opacity-85 mt-1.5">
                  {ready === 1 ? "card waiting" : "cards waiting"}
                  {(s?.counts.new ?? 0) > 0 && (
                    <span className="opacity-75">
                      {" "}
                      · {Math.min(s?.counts.new ?? 0, 20)} new
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[15px] font-medium shrink-0">
                Start
                <span className="w-9 h-9 rounded-full bg-white/18 grid place-items-center transition-transform duration-200 group-hover:translate-x-0.5">
                  <Icon name="play" className="w-4 h-4 ml-0.5" strokeWidth={2.2} />
                </span>
              </div>
            </div>
            <p className="text-xs opacity-70 mt-4">
              About {Math.max(1, Math.round(ready * 0.12))} minutes ·{" "}
              {s?.settings.sessionSize ?? 20} per round
            </p>
          </div>
        </Link>
      ) : (
        <Panel className="p-6 mb-4 flex items-center gap-4">
          <div className="w-11 h-11 rounded-full bg-[var(--good-soft)] grid place-items-center shrink-0">
            <Icon name="check" className="w-5 h-5 text-[var(--good)]" strokeWidth={2.2} />
          </div>
          <div className="grow min-w-0">
            <p className="font-medium text-[15px]">Nothing due today</p>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              Next cards come back tomorrow. Resting is part of it.
            </p>
          </div>
          <Link href="/review?mode=cram" className="shrink-0">
            <Button>Practise anyway</Button>
          </Link>
        </Panel>
      )}

      {/* Today's numbers — small, factual, no guilt if empty. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-9">
        <MiniStat
          label="Reviewed today"
          value={String(doneToday)}
          foot={
            <div className="mt-2">
              <div className="h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-500"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--text-faint)] mt-1.5">
                goal {goal}
              </p>
            </div>
          }
        />
        <MiniStat
          label="Day streak"
          value={String(s?.streak ?? 0)}
          icon={(s?.streak ?? 0) > 0 ? "flame" : undefined}
        />
        <MiniStat label="Cards total" value={String(totalCards)} />
        <MiniStat
          label="All-time reviews"
          value={String(s?.totalReviews ?? 0)}
        />
      </div>

      {/* Courses, ordered by what needs attention. */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold">Your courses</h2>
        <Link
          href="/courses"
          className="text-[13px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          Manage
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {(courses.data ?? [])
          .slice()
          .sort((a, b) => b.dueCards - a.dueCards)
          .slice(0, 6)
          .map((c) => (
            <Link key={c.id} href={`/courses/${c.id}`} className="group">
              <Panel className="p-4 transition-colors hover:border-[var(--border-strong)] h-full">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {c.emoji && <span className="mr-1.5">{c.emoji}</span>}
                      {c.name}
                    </p>
                    <p className="text-xs text-[var(--text-faint)] mt-1">
                      {c.totalCards} {c.totalCards === 1 ? "card" : "cards"}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {c.dueCards > 0 && <Badge tone="due">{c.dueCards} due</Badge>}
                    {c.newCards > 0 && <Badge tone="new">{c.newCards} new</Badge>}
                  </div>
                </div>
              </Panel>
            </Link>
          ))}
      </div>

      <p className="text-xs text-[var(--text-faint)] mt-8 text-center">
        Press <span className="kbd">n</span> to write a card ·{" "}
        <span className="kbd">⌘K</span> to jump anywhere
      </p>
    </div>
  );
}

/* ========================================================================== */

function StartCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <Link href={href}>
      <Panel className="p-5 h-full transition-colors hover:border-[var(--accent)] group">
        <Icon
          name={icon}
          className="w-5 h-5 text-[var(--accent)] mb-3"
          strokeWidth={2}
        />
        <p className="font-medium text-sm">{title}</p>
        <p className="text-[13px] text-[var(--text-muted)] mt-1 leading-relaxed">
          {body}
        </p>
      </Panel>
    </Link>
  );
}

function MiniStat({
  label,
  value,
  icon,
  foot,
}: {
  label: string;
  value: string;
  icon?: string;
  foot?: React.ReactNode;
}) {
  return (
    <Panel className="p-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p
        className={cx(
          "text-2xl font-semibold tabular-nums tracking-[-0.02em] mt-1 flex items-center gap-1.5",
        )}
      >
        {value}
        {icon && <Icon name={icon} className="w-4 h-4 text-[var(--hard)]" strokeWidth={2} />}
      </p>
      {foot}
    </Panel>
  );
}
