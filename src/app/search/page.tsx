"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CardForm, draftFromCard, type CardDraft } from "@/components/CardForm";
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  useToast,
} from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { cardPreview } from "@/lib/cloze";
import type { Card } from "@/lib/types";

type Hit = Card & {
  courseId?: string;
  courseName?: string;
  chapterName?: string;
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: CardDraft } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const tags = useApi<{ tag: string; count: number }[]>("/tags");
  const { push } = useToast();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 160);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api<{ results: Hit[] }>(
      `/search?q=${encodeURIComponent(debounced)}&limit=60`,
    )
      .then((r) => !cancelled && setResults(r.results))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const saveEdit = async () => {
    if (!editing) return;
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
    setDebounced((d) => d + " ");
    setTimeout(() => setDebounced(query), 0);
    push("Card updated", "success");
  };

  return (
    <>
      <PageHeader
        title="Search"
        subtitle="Looks inside the front, back, notes and tags of every card."
      />

      <div className="relative mb-6">
        <Icon
          name="search"
          className="w-[18px] h-[18px] absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type at least two letters…"
          className="field h-12 pl-11 text-[15px]"
          aria-label="Search cards"
        />
        {loading && (
          <Spinner className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
        )}
      </div>

      {/* Tags double as saved searches, and each can be reviewed directly. */}
      {query.length < 2 && (tags.data?.length ?? 0) > 0 && (
        <div className="mb-8">
          <h2 className="text-[13px] font-semibold text-[var(--text-muted)] mb-2.5">
            Browse by tag
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {tags.data!.slice(0, 30).map((t) => (
              <Link
                key={t.tag}
                href={`/review?tag=${encodeURIComponent(t.tag)}&mode=cram`}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[13px] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
              >
                {t.tag}
                <span className="text-[11px] text-[var(--text-faint)] tabular-nums">
                  {t.count}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {query.trim().length >= 2 && results.length === 0 && !loading && (
        <EmptyState
          icon={<Icon name="search" className="w-5 h-5" />}
          title={`Nothing matches “${query}”`}
          body="Try a shorter word — search matches word beginnings, so “mito” finds “mitochondria”."
        />
      )}

      {results.length > 0 && (
        <>
          <p className="text-[13px] text-[var(--text-muted)] mb-3">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-1.5 anim-fade">
            {results.map((card) => (
              <Panel
                key={card.id}
                className="p-3.5 group hover:border-[var(--border-strong)] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 grow">
                    <p className="text-sm font-medium preserve-lines line-clamp-2">
                      {cardPreview(card) || "(media only)"}
                    </p>
                    <p className="text-sm text-[var(--text-muted)] mt-1 preserve-lines line-clamp-2">
                      {card.back}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {card.courseName && (
                        <Link
                          href={`/courses/${card.courseId}`}
                          className="text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
                        >
                          {card.courseName} › {card.chapterName}
                        </Link>
                      )}
                      {card.tags.map((t) => (
                        <Badge key={t} tone="accent">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setEditing({ id: card.id, draft: draftFromCard(card) })
                    }
                    aria-label="Edit card"
                    className="w-8 h-8 grid place-items-center rounded-lg text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                  >
                    <Icon name="edit" className="w-4 h-4" />
                  </button>
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}

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
    </>
  );
}
