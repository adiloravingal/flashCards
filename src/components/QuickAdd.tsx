"use client";

import { useCallback, useEffect, useState } from "react";
import { api, useHotkeys } from "@/lib/client";
import type { Card } from "@/lib/types";
import {
  CardForm,
  emptyDraft,
  recallChapter,
  rememberTags,
  type CardDraft,
} from "./CardForm";
import { Button, Modal, useToast } from "./ui";

/**
 * Press `n` anywhere to write a card. Stays open after saving so you can dump
 * five cards in a row without touching the mouse — capturing a thought must
 * never cost more than the thought itself.
 */
export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CardDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const { push } = useToast();

  useHotkeys([
    {
      key: "n",
      run: () => {
        setDraft(emptyDraft(recallChapter()));
        setSavedCount(0);
        setOpen(true);
      },
    },
  ]);

  useEffect(() => {
    const onOpen = () => {
      setDraft(emptyDraft(recallChapter()));
      setSavedCount(0);
      setOpen(true);
    };
    window.addEventListener("fc:quick-add", onOpen);
    return () => window.removeEventListener("fc:quick-add", onOpen);
  }, []);

  const save = useCallback(
    async (keepOpen: boolean) => {
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
        const result = await api<{ created: number; cards: Card[] }>("/cards", {
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
        });

        const next = savedCount + result.created;
        setSavedCount(next);

        if (keepOpen) {
          // Keep the chapter, clear everything else, refocus the front.
          rememberTags(draft.tags);
          setDraft({ ...emptyDraft(draft.chapterId), tags: draft.tags });
          push(`Saved · ${next} this session`, "success");
        } else {
          setOpen(false);
          push("Card saved", "success");
          window.dispatchEvent(new CustomEvent("fc:data-changed"));
        }
      } catch (err) {
        push(err instanceof Error ? err.message : "Could not save", "error");
      } finally {
        setSaving(false);
      }
    },
    [draft, push, savedCount],
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        setOpen(false);
        if (savedCount > 0) window.dispatchEvent(new CustomEvent("fc:data-changed"));
      }}
      title={
        savedCount > 0 ? `New card · ${savedCount} saved` : "New card"
      }
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-[var(--text-faint)] hidden sm:block">
            <span className="kbd">⌘</span> <span className="kbd">↵</span> save & add another
          </span>
          <Button onClick={() => void save(false)} loading={saving}>
            Save & close
          </Button>
          <Button variant="primary" onClick={() => void save(true)} loading={saving}>
            Save & add another
          </Button>
        </>
      }
    >
      <CardForm
        draft={draft}
        onChange={setDraft}
        onSubmit={() => void save(true)}
      />
    </Modal>
  );
}
