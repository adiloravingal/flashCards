import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import type { Rating } from "./types";

/**
 * Thin wrapper over ts-fsrs. Everything the rest of the app knows about
 * scheduling goes through here, so swapping the algorithm later touches
 * exactly one file.
 */

export interface SchedulingState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

function engine(targetRetention: number) {
  return fsrs(
    generatorParameters({
      request_retention: clamp(targetRetention, 0.7, 0.97),
      enable_fuzz: true, // spreads reviews out so days don't clump
      enable_short_term: true,
    }),
  );
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi);

/** Scheduling fields for a brand-new card, due immediately. */
export function freshState(at: number = Date.now()): SchedulingState {
  const c = createEmptyCard(new Date(at));
  return toState(c);
}

function toFsrsCard(row: SchedulingState): FsrsCard {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  } as FsrsCard;
}

function toState(c: FsrsCard): SchedulingState {
  return {
    due: new Date(c.due).getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: (c as { learning_steps?: number }).learning_steps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as number,
    last_review: c.last_review ? new Date(c.last_review).getTime() : null,
  };
}

/** Apply a rating and return the card's next scheduling state. */
export function applyRating(
  current: SchedulingState,
  rating: Rating,
  at: number,
  targetRetention: number,
): SchedulingState {
  const f = engine(targetRetention);
  const result = f.next(toFsrsCard(current), new Date(at), rating as Grade);
  return toState(result.card);
}

/**
 * What each button will do, without committing to it — used to print
 * "Good · 4d" under the buttons so you can see the consequence before choosing.
 */
export function previewIntervals(
  current: SchedulingState,
  at: number,
  targetRetention: number,
): Record<Rating, number> {
  const f = engine(targetRetention);
  const card = toFsrsCard(current);
  const out = {} as Record<Rating, number>;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    try {
      const next = f.next(card, new Date(at), r as Grade);
      out[r] = new Date(next.card.due).getTime() - at;
    } catch {
      out[r] = 0;
    }
  }
  return out;
}

/** "10m", "4d", "2.1mo" — short enough to sit inside a button. */
export function humanInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const min = ms / 60_000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30.44;
  if (months < 12) return `${months < 10 ? months.toFixed(1) : Math.round(months)}mo`;
  const years = days / 365.25;
  return `${years < 10 ? years.toFixed(1) : Math.round(years)}y`;
}

/** Pull just the scheduling fields off a card row (or a hydrated Card). */
export function stateFromRow(row: SchedulingState): SchedulingState {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review,
  };
}
