"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, cx, useHotkeys } from "@/lib/client";
import { cardPreview } from "@/lib/cloze";
import type { Card } from "@/lib/types";
import { Icon } from "./ui";

/**
 * ⌘K palette.
 *
 * The point is that you never have to remember where anything lives: type a
 * few letters of a course, a card, or an action and press Enter. Removing the
 * need to navigate is the single biggest friction saving in the app.
 */

interface Cmd {
  id: string;
  label: string;
  sub?: string;
  icon: string;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string; emoji: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
    setCards([]);
  }, []);

  useHotkeys([
    { key: "k", meta: true, allowInInput: true, run: () => setOpen((o) => !o) },
  ]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("fc:open-command-palette", onOpen);
    return () => window.removeEventListener("fc:open-command-palette", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    void api<{ id: string; name: string; emoji: string }[]>("/courses")
      .then(setCourses)
      .catch(() => {});
  }, [open]);

  // Search cards as you type, debounced so a fast typist doesn't fire ten
  // requests before finishing a word.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setCards([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<{ results: Card[] }>(
        `/search?q=${encodeURIComponent(query)}&limit=6`,
      )
        .then((r) => setCards(r.results))
        .catch(() => setCards([]));
    }, 140);
    return () => clearTimeout(timer);
  }, [query, open]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const commands = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      { id: "review", label: "Start reviewing", sub: "Everything that's due", icon: "play", keywords: "study session practice", run: () => go("/review") },
      { id: "cram", label: "Cram everything", sub: "Ignores the schedule", icon: "shuffle", keywords: "exam quick practice", run: () => go("/review?mode=cram") },
      { id: "add", label: "New card", icon: "plus", keywords: "create write make", run: () => go("/add") },
      { id: "import", label: "Import a spreadsheet", sub: "Excel or CSV", icon: "upload", keywords: "excel xlsx csv upload file", run: () => go("/import") },
      { id: "courses", label: "Courses", icon: "layers", keywords: "decks subjects chapters", run: () => go("/courses") },
      { id: "stats", label: "Progress", icon: "chart", keywords: "statistics streak heatmap retention", run: () => go("/stats") },
      { id: "logs", label: "Activity log", icon: "list", keywords: "history audit agent events", run: () => go("/logs") },
      { id: "docs", label: "Guide", sub: "How everything works", icon: "help", keywords: "help documentation manual shortcuts api", run: () => go("/docs") },
      { id: "settings", label: "Settings", icon: "settings", keywords: "preferences theme dark api key", run: () => go("/settings") },
    ];

    for (const c of courses) {
      base.push({
        id: `course-${c.id}`,
        label: c.name,
        sub: "Course",
        icon: "book",
        keywords: "course deck",
        run: () => go(`/course?id=${c.id}`),
      });
    }
    return base;
  }, [courses, go]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 9);
    return commands
      .filter((c) =>
        `${c.label} ${c.sub ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [commands, query]);

  const total = filtered.length + cards.length;

  useEffect(() => setCursor(0), [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const activate = useCallback(
    (index: number) => {
      if (index < filtered.length) {
        filtered[index]?.run();
      } else {
        const card = cards[index - filtered.length];
        if (card) go(`/courses?card=${card.id}`);
      }
    },
    [filtered, cards, go],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] anim-fade" onClick={close} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg bg-[var(--surface)] border border-[var(--border-strong)] rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] overflow-hidden anim-slide-in"
      >
        <div className="flex items-center gap-3 px-4 border-b border-[var(--border)]">
          <Icon name="search" className="w-[18px] h-[18px] text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => (total ? (c + 1) % total : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => (total ? (c - 1 + total) % total : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                activate(cursor);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            placeholder="Search cards, courses, or type a command…"
            className="grow bg-transparent h-13 py-4 outline-none text-[15px] placeholder:text-[var(--text-faint)]"
            aria-label="Search"
          />
          <span className="kbd">esc</span>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {total === 0 && (
            <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              Nothing matches “{query}”.
            </p>
          )}

          {filtered.map((c, i) => (
            <Row
              key={c.id}
              index={i}
              active={cursor === i}
              icon={c.icon}
              label={c.label}
              sub={c.sub}
              onSelect={() => c.run()}
              onHover={() => setCursor(i)}
            />
          ))}

          {cards.length > 0 && (
            <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Cards
            </p>
          )}
          {cards.map((card, i) => {
            const index = filtered.length + i;
            return (
              <Row
                key={card.id}
                index={index}
                active={cursor === index}
                icon="book"
                label={cardPreview(card) || "(no front)"}
                sub={card.back}
                onSelect={() => activate(index)}
                onHover={() => setCursor(index)}
              />
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-[var(--border)] flex items-center gap-3 text-[11px] text-[var(--text-faint)]">
          <span className="flex items-center gap-1">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span className="flex items-center gap-1">
            <span className="kbd">↵</span> open
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({
  index,
  active,
  icon,
  label,
  sub,
  onSelect,
  onHover,
}: {
  index: number;
  active: boolean;
  icon: string;
  label: string;
  sub?: string;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      data-index={index}
      onClick={onSelect}
      onMouseMove={onHover}
      className={cx(
        "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
        active ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]",
      )}
    >
      <Icon
        name={icon}
        className={cx(
          "w-[17px] h-[17px]",
          active ? "text-[var(--accent)]" : "text-[var(--text-faint)]",
        )}
      />
      <span className="min-w-0 grow">
        <span className="block text-sm truncate">{label}</span>
        {sub && (
          <span className="block text-xs text-[var(--text-faint)] truncate">
            {sub}
          </span>
        )}
      </span>
    </button>
  );
}
