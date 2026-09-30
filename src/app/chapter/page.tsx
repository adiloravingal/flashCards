"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { CardForm, draftFromCard, type CardDraft } from "@/components/CardForm";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  useToast,
} from "@/components/ui";
import { ExportDeckButton } from "@/components/ExportDeckButton";
import { RenameButton, RenameDialog } from "@/components/RenameDialog";
import { api, cx, relativeTime, useApi } from "@/lib/client";
import { cardPreview } from "@/lib/cloze";
import type { Card, Chapter, Counts, Course } from "@/lib/types";

type ChapterDetail = Chapter & { course: Course | null; counts: Counts };

const STATE_LABEL = ["New", "Learning", "Review", "Relearning"];

export default function ChapterPage() {
  return (
    <Suspense fallback={<div className="grid place-items-center py-24"><Spinner className="w-6 h-6 text-[var(--text-faint)]" /></div>}>
      <ChapterDetailView />
    </Suspense>
  );
}

function ChapterDetailView() {
  const search = useSearchParams();
  const courseId = search.get("course") ?? "";
  const chapterId = search.get("id") ?? "";

  const chapter = useApi<ChapterDetail>(`/chapters/${chapterId}`);
  const cards = useApi<{ cards: Card[]; total: number }>(
    `/cards?chapterId=${chapterId}&limit=500`,
  );

  const [renamingChapter, setRenamingChapter] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: CardDraft } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<Card | null>(null);
  const { push } = useToast();

  /* ------------------------------------------------------------------ *
   * Selecting cards, to move them somewhere else
   *
   * Cards land in the wrong chapter easily — the form carries the last one
   * over — so getting them out again has to be cheaper than re-typing them.
   * Selection appears only once you tick something: an empty list looks
   * exactly as it did before.
   * ------------------------------------------------------------------ */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [movingTo, setMovingTo] = useState(false);
  const [moving, setMoving] = useState(false);
  const lastTicked = useRef<string | null>(null);

  const siblings = useApi<Chapter[]>(
    courseId ? `/chapters?courseId=${courseId}` : null,
  );

  const toggle = (card: Card, index: number, withShift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const list = cards.data?.cards ?? [];

      // Shift-click takes the run between the last tick and this one, which is
      // the whole point when a mis-filed batch sits together in the list.
      if (withShift && lastTicked.current) {
        const from = list.findIndex((c) => c.id === lastTicked.current);
        if (from !== -1) {
          const [a, b] = from < index ? [from, index] : [index, from];
          const adding = !prev.has(card.id);
          for (let i = a; i <= b; i++) {
            if (adding) next.add(list[i].id);
            else next.delete(list[i].id);
          }
          lastTicked.current = card.id;
          return next;
        }
      }

      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      lastTicked.current = card.id;
      return next;
    });
  };

  const moveSelected = async (targetId: string) => {
    setMoving(true);
    try {
      const result = await api<{ moved: number; chapterName: string }>(
        "/cards/move",
        { method: "POST", json: { ids: [...selected], chapterId: targetId } },
      );
      setMovingTo(false);
      setSelected(new Set());
      lastTicked.current = null;
      await Promise.all([cards.reload(), chapter.reload()]);
      window.dispatchEvent(new CustomEvent("fc:data-changed"));
      push(
        `Moved ${result.moved} card${result.moved === 1 ? "" : "s"} to ${result.chapterName}`,
        "success",
      );
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not move", "error");
    } finally {
      setMoving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api(`/cards/${editing.id}`, {
        method: "PATCH",
        json: {
          front: editing.draft.front,
          back: editing.draft.back,
          hint: editing.draft.hint,
          notes: editing.draft.notes,
          tags: editing.draft.tags,
          starred: editing.draft.starred,
          mediaIds: editing.draft.attachments.map((a) => ({
            id: a.id,
            side: a.side,
          })),
        },
      });
      setEditing(null);
      await cards.reload();
      push("Card updated", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not save", "error");
    }
  };

  const remove = async (card: Card) => {
    await api(`/cards/${card.id}`, { method: "DELETE" });
    await Promise.all([cards.reload(), chapter.reload()]);
    push("Card deleted", "success");
  };

  const toggleSuspend = async (card: Card) => {
    await api(`/cards/${card.id}`, {
      method: "PATCH",
      json: { suspended: !card.suspended },
    });
    await Promise.all([cards.reload(), chapter.reload()]);
    push(card.suspended ? "Card resumed" : "Card paused", "info");
  };

  if (chapter.loading && !chapter.data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
      </div>
    );
  }
  if (!chapter.data) {
    return (
      <EmptyState
        title="Chapter not found"
        action={
          <Link href="/courses">
            <Button>Back to courses</Button>
          </Link>
        }
      />
    );
  }

  const list = cards.data?.cards ?? [];
  const ready = chapter.data.counts.due + chapter.data.counts.new;

  return (
    <>
      <PageHeader
        back={
          <Link
            href={`/course?id=${courseId}`}
            className="inline-flex items-center gap-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors mb-2"
          >
            <Icon name="chevronLeft" className="w-3.5 h-3.5" />
            {chapter.data.course?.name ?? "Course"}
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-1.5 group">
            {chapter.data.name}
            <RenameButton
              alwaysVisible
              label="Rename this chapter"
              onClick={() => setRenamingChapter(true)}
            />
          </span>
        }
        subtitle={`${chapter.data.counts.total} cards · ${chapter.data.counts.due} due · ${chapter.data.counts.new} new`}
        actions={
          <>
            <Button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("fc:quick-add", { detail: { chapterId } }),
                )
              }
            >
              <Icon name="plus" className="w-4 h-4" />
              Card
            </Button>
            {ready > 0 ? (
              <Link href={`/review?chapterId=${chapterId}`}>
                <Button variant="primary">
                  <Icon name="play" className="w-4 h-4" />
                  Review {ready}
                </Button>
              </Link>
            ) : (
              list.length > 0 && (
                <Link href={`/review?chapterId=${chapterId}&mode=cram`}>
                  <Button variant="primary">
                    <Icon name="shuffle" className="w-4 h-4" />
                    Practise
                  </Button>
                </Link>
              )
            )}
          </>
        }
      />

      {list.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <Link href={`/review?chapterId=${chapterId}&mode=cram`}>
            <Button size="sm" variant="ghost">
              <Icon name="shuffle" className="w-3.5 h-3.5" />
              Practise all
            </Button>
          </Link>
          <ExportDeckButton chapterId={chapterId} label="Export chapter" />
        </div>
      )}

      {selected.size > 0 && (
        <Panel className="sticky top-3 z-20 mb-3 px-3.5 py-2.5 flex flex-wrap items-center gap-2 anim-fade border-[var(--accent)] bg-[var(--surface)]">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={() => setSelected(new Set(list.map((c) => c.id)))}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Select all {list.length}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" variant="primary" onClick={() => setMovingTo(true)}>
              <Icon name="archive" className="w-3.5 h-3.5" />
              Move to chapter
            </Button>
          </div>
        </Panel>
      )}

      {cards.loading && !cards.data ? (
        <div className="grid place-items-center py-24">
          <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Icon name="book" className="w-5 h-5" />}
          title="This chapter is empty"
          body="Press n anywhere to write a card, or import a spreadsheet into this course."
          action={
            <Button
              variant="primary"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("fc:quick-add", { detail: { chapterId } }),
                )
              }
            >
              Write a card
            </Button>
          }
        />
      ) : (
        <div className="space-y-1.5 anim-fade-up">
          {list.map((card, index) => (
            <Panel
              key={card.id}
              className={cx(
                "p-3.5 group transition-colors hover:border-[var(--border-strong)]",
                card.suspended && "opacity-55",
                selected.has(card.id) && "border-[var(--accent)] bg-[var(--accent-soft)]",
              )}
            >
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  checked={selected.has(card.id)}
                  onChange={(e) =>
                    toggle(card, index, (e.nativeEvent as MouseEvent).shiftKey)
                  }
                  aria-label={`Select card ${index + 1}`}
                  title="Shift-click to select a run"
                  className={cx(
                    "mt-0.5 w-4 h-4 shrink-0 accent-[var(--accent)] cursor-pointer transition-opacity",
                    // Out of the way until it is useful, then it stays put.
                    selected.size > 0
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100",
                  )}
                />
                <div className="min-w-0 grow">
                  <div className="flex items-start gap-2">
                    {card.starred > 0 && (
                      <Icon
                        name="star"
                        className="w-3.5 h-3.5 text-[var(--hard)] mt-0.5 shrink-0"
                        strokeWidth={2}
                      />
                    )}
                    <p className="text-sm font-medium preserve-lines line-clamp-2">
                      {cardPreview(card) || (
                        <span className="text-[var(--text-faint)] italic">
                          (media only)
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] mt-1 preserve-lines line-clamp-2">
                    {card.back}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {card.card_type === "cloze" && (
                      <Badge tone="accent" title="Cloze deletion card">
                        cloze {card.cloze_index}
                      </Badge>
                    )}
                    <Badge tone={card.state === 0 ? "new" : "neutral"}>
                      {STATE_LABEL[card.state] ?? "?"}
                    </Badge>
                    {card.state !== 0 && (
                      <Badge tone="muted">
                        due {relativeTime(card.due)}
                      </Badge>
                    )}
                    {card.lapses > 0 && (
                      <Badge tone="muted">
                        {card.lapses} lapse{card.lapses === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {card.media.length > 0 && (
                      <Badge tone="muted">
                        <Icon name="image" className="w-3 h-3" /> {card.media.length}
                      </Badge>
                    )}
                    {card.tags.map((t) => (
                      <Badge key={t} tone="accent">
                        {t}
                      </Badge>
                    ))}
                    {card.suspended > 0 && <Badge tone="muted">paused</Badge>}
                  </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <IconBtn
                    icon="edit"
                    label="Edit"
                    onClick={() =>
                      setEditing({ id: card.id, draft: draftFromCard(card) })
                    }
                  />
                  <IconBtn
                    icon="clock"
                    label={card.suspended ? "Resume" : "Pause"}
                    onClick={() => void toggleSuspend(card)}
                  />
                  <IconBtn
                    icon="trash"
                    label="Delete"
                    danger
                    onClick={() => setConfirmDelete(card)}
                  />
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={movingTo}
        onClose={() => setMovingTo(false)}
        title={`Move ${selected.size} card${selected.size === 1 ? "" : "s"} to…`}
      >
        {(() => {
          const others = (siblings.data ?? []).filter((c) => c.id !== chapterId);
          if (siblings.loading && !siblings.data) {
            return (
              <div className="grid place-items-center py-8">
                <Spinner className="w-5 h-5 text-[var(--text-faint)]" />
              </div>
            );
          }
          if (others.length === 0) {
            return (
              <p className="text-sm text-[var(--text-muted)] py-2">
                This course has no other chapter yet. Make one from the course
                page, then move these across.
              </p>
            );
          }
          return (
            <div className="space-y-1.5">
              {others.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={moving}
                  onClick={() => void moveSelected(c.id)}
                  className={cx(
                    "w-full text-left px-3.5 py-3 rounded-[var(--radius)] border transition-colors",
                    "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--surface-2)]",
                    "disabled:opacity-50 disabled:pointer-events-none",
                  )}
                >
                  <span className="text-sm font-medium">{c.name}</span>
                </button>
              ))}
              <p className="text-xs text-[var(--text-faint)] pt-2">
                Review history moves with the cards. Cloze siblings travel
                together, since they are one note.
              </p>
            </div>
          );
        })()}
      </Modal>

      <RenameDialog
        open={renamingChapter}
        onClose={() => setRenamingChapter(false)}
        label="chapter"
        current={chapter.data?.name ?? ""}
        onSave={async (name) => {
          await api(`/chapters/${chapterId}`, { method: "PATCH", json: { name } });
          push("Renamed", "success");
          chapter.reload();
        }}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit card"
        wide
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <CardForm
            draft={editing.draft}
            onChange={(draft) => setEditing({ ...editing, draft })}
            showChapterPicker={false}
            onSubmit={saveEdit}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        title="Delete this card?"
        body="The card and its review history are removed permanently."
      />
    </>
  );
}

function IconBtn({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx(
        "w-8 h-8 grid place-items-center rounded-lg transition-colors text-[var(--text-faint)]",
        danger
          ? "hover:text-[var(--again)] hover:bg-[var(--again-soft)]"
          : "hover:text-[var(--text)] hover:bg-[var(--surface-2)]",
      )}
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  );
}
