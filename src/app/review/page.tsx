"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CardFace } from "@/components/CardFace";
import { CardForm, draftFromCard, type CardDraft } from "@/components/CardForm";
import { useSettings } from "@/components/Providers";
import { Button, Icon, Modal, Spinner, useToast } from "@/components/ui";
import { api, cx, formatDuration, useHotkeys } from "@/lib/client";
import type { Card, Rating } from "@/lib/types";

type QueueCard = Card & { preview: Record<string, string> };

interface Queue {
  mode: string;
  sessionId: string;
  counts: { total: number; due: number; new: number };
  cards: QueueCard[];
}

const RATINGS: { rating: Rating; label: string; key: string; color: string; soft: string }[] = [
  { rating: 1, label: "Again", key: "1", color: "var(--again)", soft: "var(--again-soft)" },
  { rating: 2, label: "Hard", key: "2", color: "var(--hard)", soft: "var(--hard-soft)" },
  { rating: 3, label: "Good", key: "3", color: "var(--good)", soft: "var(--good-soft)" },
  { rating: 4, label: "Easy", key: "4", color: "var(--easy)", soft: "var(--easy-soft)" },
];

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh grid place-items-center">
          <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
        </div>
      }
    >
      <ReviewSession />
    </Suspense>
  );
}

function ReviewSession() {
  const params = useSearchParams();
  const router = useRouter();
  const { settings } = useSettings();
  const { push } = useToast();

  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [editing, setEditing] = useState<CardDraft | null>(null);
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [busy, setBusy] = useState(false);

  const startedAt = useRef(Date.now());
  const shownAt = useRef(Date.now());

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of ["courseId", "chapterId", "tag", "starred", "mode", "limit"]) {
      const v = params.get(key);
      if (v) sp.set(key, v);
    }
    return sp.toString();
  }, [params]);

  const mode = params.get("mode") ?? "due";
  const isCram = mode === "cram";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const q = await api<Queue>(`/review/queue?${query}`);
        if (!cancelled) {
          setQueue(q);
          setIndex(0);
          setFlipped(false);
          startedAt.current = Date.now();
          shownAt.current = Date.now();
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load cards");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const card = queue?.cards[index];
  const done = !!queue && index >= queue.cards.length;

  useEffect(() => {
    setFlipped(false);
    setShowHint(false);
    shownAt.current = Date.now();
  }, [index]);

  /* ---------------------------------------------------------------------- */

  const answer = useCallback(
    async (rating: Rating) => {
      if (!card || !queue || busy) return;
      setBusy(true);

      const duration = Date.now() - shownAt.current;
      setAnswered((n) => n + 1);
      if (rating > 1) setCorrect((n) => n + 1);

      // Advance immediately — waiting on the network between cards is exactly
      // the kind of micro-stall that ends a study session.
      const wasLast = index >= queue.cards.length - 1;
      if (rating === 1 && !isCram) {
        // Forgotten cards come back before the session ends.
        setQueue((q) =>
          q ? { ...q, cards: [...q.cards, { ...card }] } : q,
        );
      }
      setIndex((i) => i + 1);

      try {
        await api("/review/answer", {
          method: "POST",
          json: {
            cardId: card.id,
            rating,
            durationMs: duration,
            sessionId: queue.sessionId,
            cram: isCram,
          },
        });
      } catch (err) {
        push(err instanceof Error ? err.message : "Answer not saved", "error");
      } finally {
        setBusy(false);
      }
      void wasLast;
    },
    [card, queue, busy, index, isCram, push],
  );

  const undo = useCallback(async () => {
    if (!queue) return;
    try {
      const restored = await api<Card>("/review/undo", {
        method: "POST",
        json: { sessionId: queue.sessionId },
      });
      setIndex((i) => Math.max(0, i - 1));
      setAnswered((n) => Math.max(0, n - 1));
      setFlipped(true);
      setQueue((q) => {
        if (!q) return q;
        const cards = [...q.cards];
        const at = Math.max(0, index - 1);
        if (cards[at]) cards[at] = { ...cards[at], ...restored } as QueueCard;
        return { ...q, cards };
      });
      push("Undone", "info");
    } catch {
      push("Nothing to undo", "error");
    }
  }, [queue, index, push]);

  const toggleStar = useCallback(async () => {
    if (!card) return;
    const next = !card.starred;
    setQueue((q) => {
      if (!q) return q;
      const cards = [...q.cards];
      cards[index] = { ...cards[index], starred: next ? 1 : 0 };
      return { ...q, cards };
    });
    try {
      await api(`/cards/${card.id}`, { method: "PATCH", json: { starred: next } });
      push(next ? "Starred" : "Unstarred", "info");
    } catch {
      /* visual state already updated; not worth an error toast */
    }
  }, [card, index, push]);

  const saveEdit = useCallback(async () => {
    if (!editing || !card) return;
    try {
      const updated = await api<Card>(`/cards/${card.id}`, {
        method: "PATCH",
        json: {
          front: editing.front,
          back: editing.back,
          hint: editing.hint,
          notes: editing.notes,
          tags: editing.tags,
          starred: editing.starred,
          mediaIds: editing.attachments.map((a) => ({ id: a.id, side: a.side })),
        },
      });
      setQueue((q) => {
        if (!q) return q;
        const cards = [...q.cards];
        cards[index] = { ...cards[index], ...updated };
        return { ...q, cards };
      });
      setEditing(null);
      push("Card updated", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not save", "error");
    }
  }, [editing, card, index, push]);

  /* ---------------------------------------------------------------------- */

  const simple = settings.gradingMode === "simple";

  useHotkeys(
    [
      {
        key: " ",
        run: () => {
          if (!flipped) setFlipped(true);
          else if (simple) void answer(3);
        },
      },
      { key: "enter", run: () => !flipped && setFlipped(true) },
      { key: "1", run: () => flipped && void answer(1) },
      { key: "2", run: () => flipped && void answer(simple ? 3 : 2) },
      { key: "3", run: () => flipped && !simple && void answer(3) },
      { key: "4", run: () => flipped && !simple && void answer(4) },
      { key: "u", run: () => void undo() },
      { key: "s", run: () => void toggleStar() },
      { key: "h", run: () => setShowHint(true) },
      {
        key: "e",
        run: () => card && setEditing(draftFromCard(card)),
      },
      { key: "escape", run: () => router.push("/") },
    ],
    !editing,
  );

  /* ---------------------------------------------------------------------- */

  if (error) {
    return (
      <Centered>
        <p className="text-sm text-[var(--again)] mb-4">{error}</p>
        <Button onClick={() => router.push("/")}>Back to Today</Button>
      </Centered>
    );
  }

  if (!queue) {
    return (
      <Centered>
        <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
      </Centered>
    );
  }

  if (queue.cards.length === 0) {
    return (
      <Centered>
        <div className="w-14 h-14 rounded-full bg-[var(--good-soft)] grid place-items-center mb-5 mx-auto">
          <Icon name="check" className="w-7 h-7 text-[var(--good)]" strokeWidth={2.2} />
        </div>
        <h1 className="text-xl font-semibold mb-2">Nothing due right now</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6 max-w-sm">
          You&apos;re caught up. Come back later, or practise anyway without
          affecting your schedule.
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => router.push("/")}>Back to Today</Button>
          <Button
            variant="primary"
            onClick={() => router.push(`/review?${query}&mode=cram`)}
          >
            Practise anyway
          </Button>
        </div>
      </Centered>
    );
  }

  if (done) {
    const elapsed = Date.now() - startedAt.current;
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    return (
      <Centered>
        <div className="anim-pop">
          <div className="w-16 h-16 rounded-full bg-[var(--accent-soft)] grid place-items-center mb-6 mx-auto">
            <Icon name="check" className="w-8 h-8 text-[var(--accent)]" strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-semibold mb-2 tracking-[-0.02em]">
            Session complete
          </h1>
          <p className="text-sm text-[var(--text-muted)] mb-8">
            That&apos;s a real stopping point. You can close this.
          </p>

          <div className="flex items-center justify-center gap-8 mb-9">
            <Stat value={String(answered)} label="reviewed" />
            <Stat value={`${accuracy}%`} label="recalled" />
            <Stat value={formatDuration(elapsed)} label="spent" />
          </div>

          <div className="flex gap-2 justify-center">
            <Button variant="primary" size="lg" onClick={() => router.push("/")}>
              Done
            </Button>
            <Button size="lg" onClick={() => window.location.reload()}>
              Another round
            </Button>
          </div>
        </div>
      </Centered>
    );
  }

  if (!card) return null;

  const total = queue.cards.length;
  const progress = (index / total) * 100;
  const isCloze = card.card_type === "cloze" && card.cloze_index !== null;

  return (
    // `h-dvh`, not `min-h-screen`: the review screen must be exactly the
    // viewport and never taller, so the answer button is always reachable
    // without scrolling. `dvh` also tracks a mobile browser's collapsing
    // address bar, which `vh` does not.
    <div className="h-dvh flex flex-col overflow-hidden">
      {/* Top bar: progress, and the only two controls that matter mid-session */}
      <header className="shrink-0">
        <div className="h-[3px] bg-[var(--surface-3)]">
          <div
            className="h-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between px-4 sm:px-6 h-14">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <Icon name="chevronLeft" className="w-4 h-4" />
            <span className="hidden sm:inline">Exit</span>
          </button>

          <div className="flex items-center gap-3">
            {isCram && (
              <span className="text-[11px] font-medium text-[var(--hard)] bg-[var(--hard-soft)] px-2 h-5 rounded-md grid place-items-center">
                Practice · not scheduled
              </span>
            )}
            <span className="text-sm tabular-nums text-[var(--text-muted)]">
              {index + 1} <span className="text-[var(--text-faint)]">/ {total}</span>
            </span>
          </div>

          <div className="flex items-center gap-0.5">
            <IconButton
              icon="star"
              label="Star"
              active={!!card.starred}
              onClick={() => void toggleStar()}
            />
            <IconButton
              icon="edit"
              label="Edit"
              onClick={() => setEditing(draftFromCard(card))}
            />
            <IconButton
              icon="undo"
              label="Undo"
              disabled={answered === 0}
              onClick={() => void undo()}
            />
          </div>
        </div>
      </header>

      {/* The card. Scrolls internally when a card is genuinely too long for
          the screen, so the header and answer buttons stay put. */}
      <main className="grow min-h-0 overflow-y-auto overscroll-contain flex flex-col items-center px-5 sm:px-8 py-6">
        {/* `my-auto` rather than `justify-center` on the parent: centring a
            flex container's overflowing child makes its top unreachable, so
            this centres when the card is short and scrolls when it isn't. */}
        <div className="w-full max-w-2xl flex flex-col items-center gap-7 my-auto">
          <CardFace
            text={card.front}
            media={card.media}
            // A flipped cloze card shows its own source with the answer filled
            // in, so the sentence never jumps around between the two sides.
            side={isCloze && flipped ? "back" : "front"}
            clozeIndex={isCloze ? card.cloze_index : undefined}
            autoPlayAudio={settings.autoPlayAudio}
            speak={settings.speakText}
          />

          {!flipped && card.hint && settings.showHints && (
            <div className="min-h-[1.5rem]">
              {showHint ? (
                <p className="text-sm text-[var(--text-muted)] italic anim-fade">
                  {card.hint}
                </p>
              ) : (
                <button
                  onClick={() => setShowHint(true)}
                  className="text-xs text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors inline-flex items-center gap-1"
                >
                  <Icon name="eye" className="w-3.5 h-3.5" />
                  Hint <span className="kbd ml-1">h</span>
                </button>
              )}
            </div>
          )}

          {flipped && (card.back || card.notes || !isCloze) && (
            <>
              <div className="w-full h-px bg-[var(--border)] anim-fade" />
              <div className="anim-fade-up w-full flex flex-col items-center gap-5">
                {/* On a cloze card the answer is already in the sentence
                    above; `back` is optional extra context, shown smaller. */}
                {(card.back || !isCloze) && (
                  <CardFace
                    text={card.back}
                    media={card.media}
                    side="back"
                    small={isCloze}
                  />
                )}
                {card.notes && (
                  <p className="preserve-lines text-sm text-[var(--text-muted)] text-center max-w-md leading-relaxed border-t border-[var(--border)] pt-4">
                    {card.notes}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Answer controls — pinned, never scrolled past. The bottom padding
          clears a home indicator on tablets and phones. */}
      <footer className="shrink-0 px-5 sm:px-8 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-[var(--border)]/60">
        <div className="max-w-2xl mx-auto">
          {!flipped ? (
            // Wrapped in a flex row because auto margins don't centre an
            // inline-level box, which is what Button renders as.
            <div className="flex justify-center">
              <Button
                variant="primary"
                size="lg"
                full
                onClick={() => setFlipped(true)}
                className="max-w-sm"
              >
                Show answer
                <span className="kbd ml-1 bg-transparent border-current/30 text-current">
                  space
                </span>
              </Button>
            </div>
          ) : simple ? (
            <div className="grid grid-cols-2 gap-2.5 max-w-md mx-auto anim-fade">
              <GradeButton
                label="Missed it"
                sub={card.preview["1"]}
                color="var(--again)"
                soft="var(--again-soft)"
                shortcut="1"
                onClick={() => void answer(1)}
              />
              <GradeButton
                label="Got it"
                sub={card.preview["3"]}
                color="var(--good)"
                soft="var(--good-soft)"
                shortcut="2"
                onClick={() => void answer(3)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-w-xl mx-auto anim-fade">
              {RATINGS.map((r) => (
                <GradeButton
                  key={r.rating}
                  label={r.label}
                  sub={card.preview[String(r.rating)]}
                  color={r.color}
                  soft={r.soft}
                  shortcut={r.key}
                  onClick={() => void answer(r.rating)}
                />
              ))}
            </div>
          )}

          {/* Keyboard hints are a nicety, not a control. They need both a wide
              screen (so there's plausibly a keyboard) and a tall one (so they
              aren't stealing room from the buttons). */}
          <p className="text-center text-[11px] text-[var(--text-faint)] mt-4 hidden [@media(min-width:640px)_and_(min-height:640px)]:block">
            <span className="kbd">space</span> flip ·{" "}
            <span className="kbd">u</span> undo · <span className="kbd">e</span>{" "}
            edit · <span className="kbd">s</span> star ·{" "}
            <span className="kbd">esc</span> exit
          </p>
        </div>
      </footer>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit card"
        wide
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveEdit()}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <CardForm
            draft={editing}
            onChange={setEditing}
            showChapterPicker={false}
            onSubmit={() => void saveEdit()}
          />
        )}
      </Modal>
    </div>
  );
}

/* ========================================================================== */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <div className="text-center max-w-md">{children}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">
        {value}
      </div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">{label}</div>
    </div>
  );
}

function GradeButton({
  label,
  sub,
  color,
  soft,
  shortcut,
  onClick,
}: {
  label: string;
  sub?: string;
  color: string;
  soft: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center justify-center gap-0.5 h-16 rounded-[12px] border transition-all duration-150 active:scale-[0.97]"
      style={{ borderColor: color, background: soft, color }}
    >
      <span className="font-semibold text-sm flex items-center gap-1.5">
        {label}
        <span
          className="kbd opacity-50 group-hover:opacity-100 transition-opacity"
          style={{ borderColor: color, color, background: "transparent" }}
        >
          {shortcut}
        </span>
      </span>
      {sub && <span className="text-[11px] opacity-75 tabular-nums">{sub}</span>}
    </button>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cx(
        "w-9 h-9 grid place-items-center rounded-lg transition-colors disabled:opacity-30",
        active
          ? "text-[var(--hard)]"
          : "text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]",
      )}
    >
      <Icon name={icon} className="w-[18px] h-[18px]" strokeWidth={active ? 2.2 : 1.7} />
    </button>
  );
}
