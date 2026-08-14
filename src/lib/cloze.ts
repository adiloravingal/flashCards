/**
 * Cloze deletions.
 *
 * Syntax matches Anki's, so decks move between the two without rewriting:
 *
 *   The capital of France is {{c1::Paris}}.
 *   {{c1::Paris}} is the capital of {{c2::France}}.
 *   The mitochondrion is the {{c1::powerhouse::what kind of house}} of the cell.
 *
 * One note produces one card per distinct index. Repeating an index in the
 * same note groups those blanks onto a single card, which is how you ask for
 * two halves of one fact at once.
 */

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export interface Deletion {
  index: number;
  text: string;
  hint: string;
}

export function hasCloze(text: string): boolean {
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text);
}

/** Every deletion in the text, in the order written. */
export function parseCloze(text: string): Deletion[] {
  const out: Deletion[] = [];
  CLOZE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLOZE_RE.exec(text)) !== null) {
    const index = Number(m[1]);
    if (!Number.isFinite(index) || index < 1 || index > 99) continue;
    out.push({ index, text: m[2] ?? "", hint: (m[3] ?? "").trim() });
  }
  return out;
}

/** Sorted, de-duplicated list of the indices a note will produce cards for. */
export function clozeIndices(text: string): number[] {
  return [...new Set(parseCloze(text).map((d) => d.index))].sort((a, b) => a - b);
}

export type SegmentKind = "plain" | "blank" | "answer" | "revealed";

export interface Segment {
  kind: SegmentKind;
  text: string;
}

/**
 * Turn cloze source into display segments for one card.
 *
 * On the front, the card's own deletions become blanks and every *other*
 * deletion is shown in full — that surrounding context is the entire point of
 * cloze, and hiding it would just make the card harder for no benefit.
 */
export function renderCloze(
  source: string,
  index: number,
  side: "front" | "back",
): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  CLOZE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLOZE_RE.exec(source)) !== null) {
    if (m.index > cursor) {
      segments.push({ kind: "plain", text: source.slice(cursor, m.index) });
    }

    const thisIndex = Number(m[1]);
    const inner = m[2] ?? "";
    const hint = (m[3] ?? "").trim();

    if (thisIndex === index) {
      segments.push(
        side === "front"
          ? { kind: "blank", text: hint ? `[${hint}]` : "[…]" }
          : { kind: "answer", text: inner },
      );
    } else {
      segments.push({ kind: "revealed", text: inner });
    }

    cursor = m.index + m[0].length;
  }

  if (cursor < source.length) {
    segments.push({ kind: "plain", text: source.slice(cursor) });
  }
  return segments;
}

/**
 * What to show for a card in a list. Cloze markup is authoring syntax; it
 * should never leak into a browsing view.
 */
export function cardPreview(card: {
  front: string;
  card_type?: string;
  cloze_index?: number | null;
}): string {
  if (card.card_type !== "cloze") return card.front;
  return clozeToPlainText(card.front);
}

/** Flatten segments to plain text — used for search indexing and previews. */
export function clozeToPlainText(source: string): string {
  CLOZE_RE.lastIndex = 0;
  return source.replace(CLOZE_RE, (_all, _i, inner: string) => inner);
}

/**
 * Wrap a selection as the next unused deletion. Powers ⌘⇧C in the editor,
 * which is the difference between cloze being pleasant and being fiddly.
 */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
): { text: string; cursor: number } | null {
  if (start >= end) return null;
  const used = clozeIndices(text);
  const next = used.length ? Math.max(...used) + 1 : 1;
  const selected = text.slice(start, end);
  const wrapped = `{{c${next}::${selected}}}`;
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    cursor: start + wrapped.length,
  };
}

/**
 * Anki writes cloze markup with HTML inside it and uses `{{c1::text::hint}}`
 * identically, so imported notes need no conversion — but it also emits the
 * older `{{c1::text}}` inside fields that contain `&nbsp;` and friends. The
 * importer flattens HTML before this ever runs.
 */
export function normaliseClozeSource(text: string): string {
  // Collapse the accidental `{{ c1 :: … }}` spacing people type by hand.
  return text.replace(/\{\{\s*c(\d+)\s*::/g, "{{c$1::");
}
