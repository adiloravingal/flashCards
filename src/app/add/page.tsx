"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CardForm,
  emptyDraft,
  rememberTags,
  recallChapter,
  type CardDraft,
} from "@/components/CardForm";
import { Button, Icon, PageHeader, Panel, useToast } from "@/components/ui";
import { api } from "@/lib/client";

/**
 * The full-page version of "write a card". Same form as the ⌘-anywhere modal,
 * but it stays put so you can sit and write a batch.
 */
export default function AddPage() {
  const [draft, setDraft] = useState<CardDraft>(() => emptyDraft(recallChapter()));
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<{ front: string; id: string }[]>([]);
  const { push } = useToast();

  const save = async () => {
    if (!draft.front.trim() && !draft.back.trim() && draft.attachments.length === 0) {
      push("Write something on the card first", "error");
      return;
    }
    if (!draft.chapterId) {
      push("Pick a chapter for this card", "error");
      return;
    }

    setSaving(true);
    try {
      const result = await api<{ cards: { id: string; front: string }[] }>(
        "/cards",
        {
          method: "POST",
          json: {
            chapterId: draft.chapterId,
            dedupe: false,
            cards: [
              {
                front: draft.front,
                back: draft.back,
                hint: draft.hint,
                notes: draft.notes,
                tags: draft.tags,
                starred: draft.starred,
                mediaIds: draft.attachments.map((a) => ({ id: a.id, side: a.side })),
              },
            ],
          },
        },
      );

      const made = result.cards[0];
      if (made) setSession((s) => [{ front: made.front, id: made.id }, ...s]);

      // Keep the chapter and the tags — consecutive cards usually share both,
      // and remembering them means a reload doesn't lose the run you're in.
      rememberTags(draft.tags);
      setDraft({
        ...emptyDraft(draft.chapterId),
        tags: draft.tags,
      });
      push("Saved", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  const undoLast = async () => {
    const last = session[0];
    if (!last) return;
    await api(`/cards/${last.id}`, { method: "DELETE" });
    setSession((s) => s.slice(1));
    push("Card removed", "info");
  };

  return (
    <>
      <PageHeader
        title="New card"
        subtitle="Front, back, save. Everything else is optional."
        actions={
          session.length > 0 ? (
            <Button variant="ghost" onClick={undoLast}>
              <Icon name="undo" className="w-4 h-4" />
              Undo last
            </Button>
          ) : undefined
        }
      />

      <Panel className="p-5">
        <CardForm draft={draft} onChange={setDraft} onSubmit={save} />

        <div className="flex items-center gap-3 mt-6 pt-5 border-t border-[var(--border)]">
          <Button variant="primary" onClick={save} loading={saving}>
            Save card
          </Button>
          <span className="text-xs text-[var(--text-faint)]">
            <span className="kbd">⌘</span> <span className="kbd">↵</span> saves
            without leaving the keyboard
          </span>
        </div>
      </Panel>

      {session.length > 0 && (
        <div className="mt-7 anim-fade">
          <h2 className="text-[13px] font-semibold text-[var(--text-muted)] mb-2.5">
            Added just now · {session.length}
          </h2>
          <div className="space-y-1">
            {session.slice(0, 8).map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] bg-[var(--surface-2)] text-sm"
              >
                <Icon
                  name="check"
                  className="w-3.5 h-3.5 text-[var(--good)] shrink-0"
                  strokeWidth={2.4}
                />
                <span className="truncate">{c.front || "(media only)"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--text-faint)] mt-8">
        Got a spreadsheet instead?{" "}
        <Link href="/import" className="text-[var(--accent)] hover:underline">
          Import it in one step
        </Link>
        .
      </p>
    </>
  );
}
