"use client";

import { useEffect, useRef, useState } from "react";
import { api, cx } from "@/lib/client";
import { clozeIndices, renderCloze, wrapSelection } from "@/lib/cloze";
import type { Card, Chapter, Course } from "@/lib/types";
import {
  MediaAttachments,
  toAttachments,
  useAttachmentUpload,
  type Attachment,
} from "./MediaAttachments";
import {
  burnMasks,
  OcclusionEditor,
  recallMask,
  rememberMask,
  type Rect,
} from "./ImageOcclusion";
import { MediaTextarea } from "./MediaTextarea";
import { Button, Icon, useToast } from "./ui";

export interface CardDraft {
  front: string;
  back: string;
  hint: string;
  notes: string;
  tags: string[];
  starred: boolean;
  attachments: Attachment[];
  chapterId: string;
}

export const emptyDraft = (chapterId = ""): CardDraft => ({
  front: "",
  back: "",
  hint: "",
  notes: "",
  tags: recallTags(),
  starred: false,
  attachments: [],
  chapterId,
});

export const draftFromCard = (card: Card): CardDraft => ({
  front: card.front,
  back: card.back,
  hint: card.hint,
  notes: card.notes,
  tags: card.tags,
  starred: !!card.starred,
  attachments: toAttachments(card.media),
  chapterId: card.chapter_id,
});

/** Remembers the last chapter you wrote into, so the next card needs no setup. */
const LAST_CHAPTER_KEY = "fc-last-chapter";
const LAST_TAGS_KEY = "fc-last-tags";
export const rememberChapter = (id: string) => {
  try {
    localStorage.setItem(LAST_CHAPTER_KEY, id);
  } catch {
    /* ignore */
  }
};
export const recallChapter = (): string => {
  try {
    return localStorage.getItem(LAST_CHAPTER_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * Tags carry over to the next card, and across reloads.
 *
 * Cards get written in runs — twenty on one topic, then twenty on another —
 * so retyping the same tag every time is pure friction. They are shown at the
 * top rather than hidden in an optional section precisely because they arrive
 * pre-filled: something applied on your behalf has to be visible, and one
 * click from gone.
 */
/** Matches the server's own limit, so a tag can never fail validation. */
export const MAX_TAG_LENGTH = 60;
const MAX_TAGS = 30;

/** Trim, lowercase, hyphenate, and cut to a length the API will accept. */
export const normalizeTag = (raw: string) =>
  raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_TAG_LENGTH);

export const rememberTags = (tags: string[]) => {
  try {
    localStorage.setItem(LAST_TAGS_KEY, JSON.stringify(tags.slice(0, 10)));
  } catch {
    /* ignore */
  }
};

export const recallTags = (): string[] => {
  try {
    const raw = localStorage.getItem(LAST_TAGS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => typeof t === "string" && t.length <= MAX_TAG_LENGTH)
      .slice(0, MAX_TAGS);
  } catch {
    return [];
  }
};

type CourseWithCounts = Course & { totalCards: number };

/**
 * The single card editor, shared by the quick-add modal, the full Add page and
 * inline editing during review. Optional fields stay collapsed until asked for:
 * the default state is two boxes and nothing else.
 */
export function CardForm({
  draft,
  onChange,
  autoFocus = true,
  showChapterPicker = true,
  onSubmit,
}: {
  draft: CardDraft;
  onChange: (next: CardDraft) => void;
  autoFocus?: boolean;
  showChapterPicker?: boolean;
  onSubmit?: () => void;
}) {
  const { push } = useToast();
  const [showMore, setShowMore] = useState(!!(draft.hint || draft.notes));
  const [tagInput, setTagInput] = useState("");
  const frontRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) frontRef.current?.focus();
  }, [autoFocus]);

  const set = <K extends keyof CardDraft>(key: K, value: CardDraft[K]) =>
    onChange({ ...draft, [key]: value });

  // An upload started from a paste can land while the user keeps typing, so
  // attachments must merge into whatever the draft looks like *then*, not the
  // version captured when the paste happened.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const setAttachments = (next: Attachment[]) =>
    onChange({ ...draftRef.current, attachments: next });

  const front = useAttachmentUpload({
    attachments: draft.attachments,
    onChange: setAttachments,
    side: "front",
  });
  const back = useAttachmentUpload({
    attachments: draft.attachments,
    onChange: setAttachments,
    side: "back",
  });

  /* ---------------------------------------------------------------- *
   * Blocking parts of an image out
   *
   * Masking produces a second image, so the two halves of the card stay
   * ordinary attachments: masked on the front, original on the back. The
   * pairing is held here only while the form is open — `originalOf` is what
   * lets the tick move the full image on and off the back without a re-upload.
   * ---------------------------------------------------------------- */
  const [masking, setMasking] = useState<{ source: Attachment; rects: Rect[] } | null>(
    null,
  );
  const [burning, setBurning] = useState(false);
  const [originalOf, setOriginalOf] = useState<Record<string, Attachment>>({});

  const frontImages = draft.attachments.filter(
    (a) => a.side === "front" && a.kind === "image",
  );
  const maskedFront = frontImages.find((a) => originalOf[a.id]);
  const original = maskedFront ? originalOf[maskedFront.id] : undefined;
  const answerShowsOriginal =
    !!original && draft.attachments.some((a) => a.side === "back" && a.id === original.id);

  /** Open the editor on an image, restoring whatever was drawn on it before. */
  const startMasking = (source: Attachment) => {
    const remembered = recallMask(source.id);
    setMasking({
      source: originalOf[source.id] ?? source,
      rects: remembered?.rects ?? [],
    });
  };

  const applyMask = async (rects: Rect[]) => {
    if (!masking) return;
    const source = masking.source;
    setBurning(true);
    try {
      const blob = await burnMasks(source.url, rects);
      const file = new File([blob], `blocked-${source.name.replace(/\.\w+$/, "")}.png`, {
        type: "image/png",
      });
      // Snapshot before awaiting: the uploader appends the new file through
      // `onChange` itself, and `draftRef` only catches up on the next render —
      // so reading it afterwards would silently drop the masked image.
      const before = draftRef.current.attachments;
      const [added] = await front.upload([file]);
      if (!added) return;

      // Swap the masked image in for whatever it was made from, and offer the
      // original as the answer — which is the whole point of doing this.
      const next = [
        ...before.filter((a) => !(a.side === "front" && a.id === source.id)),
        { ...added, side: "front" as const },
      ];
      if (!before.some((a) => a.side === "back" && a.id === source.id)) {
        next.push({ ...source, side: "back" as const });
      }
      onChange({ ...draftRef.current, attachments: next });

      setOriginalOf((m) => ({ ...m, [added.id]: source }));
      rememberMask(added.id, source.url, rects);
    } catch (err) {
      push(err instanceof Error ? err.message : "Couldn't block out the image", "error");
    } finally {
      setBurning(false);
      setMasking(null);
    }
  };

  /** The tick above Back: keep the untouched image as the answer, or don't. */
  const setAnswerShowsOriginal = (on: boolean) => {
    if (!original) return;
    set(
      "attachments",
      on
        ? [...draft.attachments, { ...original, side: "back" as const }]
        : draft.attachments.filter((a) => !(a.side === "back" && a.id === original.id)),
    );
  };

  const commitTag = () => {
    const t = normalizeTag(tagInput);
    if (t && !draft.tags.includes(t) && draft.tags.length < MAX_TAGS) {
      set("tags", [...draft.tags, t]);
    }
    setTagInput("");
  };

  // ⌘/Ctrl+Enter saves from anywhere in the form.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    }
  };

  /**
   * Turn the selected words into the next deletion. Without this, cloze means
   * hand-typing `{{c1::}}` around text, which is enough friction that nobody
   * uses the feature.
   */
  const makeCloze = () => {
    const el = frontRef.current;
    if (!el) return;
    const result = wrapSelection(draft.front, el.selectionStart, el.selectionEnd);
    if (!result) return;
    set("front", result.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.cursor, result.cursor);
    });
  };

  const onFrontKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      makeCloze();
    }
  };

  const indices = clozeIndices(draft.front);
  const isCloze = indices.length > 0;

  return (
    <div className="space-y-4" onKeyDown={onKeyDown}>
      {showChapterPicker && (
        <ChapterPicker
          value={draft.chapterId}
          onChange={(id) => {
            set("chapterId", id);
            rememberChapter(id);
          }}
        />
      )}

      <div>
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <label
            htmlFor="card-tags"
            className="text-[13px] font-medium text-[var(--text-muted)]"
          >
            Tags
          </label>
          {draft.tags.length > 0 && (
            <button
              type="button"
              onClick={() => set("tags", [])}
              className="text-xs text-[var(--text-faint)] hover:text-[var(--again)] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {draft.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-medium"
            >
              {t}
              <button
                type="button"
                onClick={() => set("tags", draft.tags.filter((x) => x !== t))}
                aria-label={`Remove tag ${t}`}
                className="hover:opacity-60"
              >
                <Icon name="x" className="w-3 h-3" strokeWidth={2.4} />
              </button>
            </span>
          ))}
          <input
            id="card-tags"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            maxLength={MAX_TAG_LENGTH}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commitTag();
              } else if (e.key === "Backspace" && !tagInput && draft.tags.length) {
                set("tags", draft.tags.slice(0, -1));
              }
            }}
            onBlur={commitTag}
            placeholder={draft.tags.length ? "" : "Type and press Enter"}
            className="field flex-1 min-w-[10rem] h-8 py-0 text-xs"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label
            htmlFor="card-front"
            className="text-[13px] font-medium text-[var(--text-muted)]"
          >
            Front
          </label>
          <button
            type="button"
            onClick={() => set("starred", !draft.starred)}
            aria-pressed={draft.starred}
            title="Star this card"
            className={cx(
              "transition-colors",
              draft.starred
                ? "text-[var(--hard)]"
                : "text-[var(--text-faint)] hover:text-[var(--text-muted)]",
            )}
          >
            <Icon
              name="star"
              className="w-4 h-4"
              strokeWidth={draft.starred ? 2 : 1.7}
            />
          </button>
        </div>
        <MediaTextarea
          id="card-front"
          ref={frontRef}
          value={draft.front}
          onChange={(e) => set("front", e.target.value)}
          onKeyDown={onFrontKeyDown}
          onFiles={front.upload}
          uploading={front.uploading}
          hint="front"
          placeholder="The question, term, or prompt — paste an image or drop a file right here"
          rows={2}
          className="field"
        />

        {/* Cloze affordance: a button when there's nothing yet, a plain
            statement of consequence once there is. */}
        <div className="flex items-center gap-2 mt-1.5 min-h-[1.25rem]">
          <button
            type="button"
            onClick={makeCloze}
            title="Select text first, then blank it out"
            className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
          >
            <Icon name="edit" className="w-3.5 h-3.5" />
            Blank out selection
            <span className="kbd ml-0.5">⌘⇧C</span>
          </button>
          {isCloze && (
            <span className="text-xs text-[var(--accent)] anim-fade">
              · makes {indices.length} card{indices.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {isCloze && (
          <div className="mt-2 p-2.5 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] anim-fade">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1.5">
              Preview
            </p>
            <div className="space-y-1">
              {indices.map((i) => (
                <p key={i} className="text-[13px] text-[var(--text-muted)]">
                  <span className="text-[var(--text-faint)] tabular-nums mr-1.5">
                    {i}.
                  </span>
                  {renderCloze(draft.front, i, "front")
                    .map((s) => s.text)
                    .join("")}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2">
          <MediaAttachments
            attachments={draft.attachments}
            onChange={(a) => set("attachments", a)}
            side="front"
            compact
            onEditImage={startMasking}
            editImageLabel="Block out"
          />
        </div>
      </div>

      <div>
        {original && (
          <label className="flex items-center gap-2 mb-2 cursor-pointer anim-fade w-fit">
            <input
              type="checkbox"
              checked={answerShowsOriginal}
              onChange={(e) => setAnswerShowsOriginal(e.target.checked)}
              className="accent-[var(--accent)] w-4 h-4"
            />
            <span className="text-[13px] text-[var(--text-muted)]">
              Show the full image as the answer
            </span>
          </label>
        )}
        <label
          htmlFor="card-back"
          className="block text-[13px] font-medium text-[var(--text-muted)] mb-1.5"
        >
          Back
          {isCloze && (
            <span className="text-[var(--text-faint)]"> · optional extra context</span>
          )}
        </label>
        <MediaTextarea
          id="card-back"
          value={draft.back}
          onChange={(e) => set("back", e.target.value)}
          onFiles={back.upload}
          uploading={back.uploading}
          hint="back"
          placeholder="The answer — paste an image or drop a file right here"
          rows={2}
          className="field"
        />
        <div className="mt-2">
          <MediaAttachments
            attachments={draft.attachments}
            onChange={(a) => set("attachments", a)}
            side="back"
            compact
          />
        </div>
      </div>

      {!showMore ? (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors inline-flex items-center gap-1"
        >
          <Icon name="chevronDown" className="w-3.5 h-3.5" />
          Add a hint or notes
        </button>
      ) : (
        <div className="space-y-4 pt-1 anim-fade">
          <div>
            <label
              htmlFor="card-hint"
              className="block text-[13px] font-medium text-[var(--text-muted)] mb-1.5"
            >
              Hint <span className="text-[var(--text-faint)]">· shown on request</span>
            </label>
            <input
              id="card-hint"
              value={draft.hint}
              onChange={(e) => set("hint", e.target.value)}
              placeholder="A nudge when you're stuck"
              className="field"
            />
          </div>

          <div>
            <label
              htmlFor="card-notes"
              className="block text-[13px] font-medium text-[var(--text-muted)] mb-1.5"
            >
              Notes <span className="text-[var(--text-faint)]">· shown after the answer</span>
            </label>
            <textarea
              id="card-notes"
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Context, mnemonics, a source link…"
              rows={2}
              className="field"
            />
          </div>

        </div>
      )}

      {masking && (
        <OcclusionEditor
          open
          src={masking.source.url}
          initialRects={masking.rects}
          busy={burning}
          onCancel={() => setMasking(null)}
          onSave={applyMask}
        />
      )}
    </div>
  );
}

/* ==========================================================================
 * Chapter picker — a flat "Course › Chapter" list with inline creation, so
 * you never have to leave the form to make a home for a card.
 * ========================================================================== */

export function ChapterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (chapterId: string) => void;
}) {
  const [options, setOptions] = useState<
    { id: string; label: string; courseName: string }[]
  >([]);
  const [creating, setCreating] = useState(false);
  const [newCourse, setNewCourse] = useState("");
  const [newChapter, setNewChapter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const courses = await api<CourseWithCounts[]>("/courses");
    const all: { id: string; label: string; courseName: string }[] = [];
    for (const c of courses) {
      const chapters = await api<Chapter[]>(`/chapters?courseId=${c.id}`);
      for (const ch of chapters) {
        all.push({
          id: ch.id,
          label: `${c.emoji ? c.emoji + " " : ""}${c.name} › ${ch.name}`,
          courseName: c.name,
        });
      }
    }
    setOptions(all);
    return all;
  };

  useEffect(() => {
    void load().then((all) => {
      if (!value && all.length > 0) {
        const remembered = recallChapter();
        onChange(all.some((o) => o.id === remembered) ? remembered : all[0].id);
      }
      if (all.length === 0) setCreating(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!newCourse.trim() && !newChapter.trim()) return;
    setBusy(true);
    try {
      const course = await api<Course>("/courses", {
        method: "POST",
        json: { name: newCourse.trim() || "My cards" },
      });
      const chapter = await api<Chapter>("/chapters", {
        method: "POST",
        json: { courseId: course.id, name: newChapter.trim() || "Chapter 1" },
      });
      await load();
      onChange(chapter.id);
      rememberChapter(chapter.id);
      setCreating(false);
      setNewCourse("");
      setNewChapter("");
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="p-3 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] space-y-2.5">
        <p className="text-[13px] font-medium">Where should this live?</p>
        <div className="flex gap-2">
          <input
            value={newCourse}
            onChange={(e) => setNewCourse(e.target.value)}
            placeholder="Course (e.g. Biology)"
            className="field"
          />
          <input
            value={newChapter}
            onChange={(e) => setNewChapter(e.target.value)}
            placeholder="Chapter (e.g. Cells)"
            className="field"
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={create} loading={busy}>
            Create
          </Button>
          {options.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Chapter"
        className="field h-9 py-0 grow"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Button size="sm" variant="ghost" onClick={() => setCreating(true)} title="New course or chapter">
        <Icon name="plus" className="w-4 h-4" />
      </Button>
    </div>
  );
}
