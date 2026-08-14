export interface Course {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  position: number;
  archived: 0 | 1;
  created_at: number;
  updated_at: number;
}

export interface Chapter {
  id: string;
  course_id: string;
  name: string;
  description: string;
  position: number;
  archived: 0 | 1;
  created_at: number;
  updated_at: number;
}

export type MediaKind = "image" | "audio" | "video" | "pdf" | "file";

export interface MediaRow {
  id: string;
  filename: string;
  original_name: string;
  mime: string;
  kind: MediaKind;
  size: number;
  sha256: string;
  created_at: number;
}

export interface CardMediaRef extends MediaRow {
  side: "front" | "back";
  position: number;
  url: string;
}

export type CardType = "basic" | "cloze";

export interface CardRow {
  id: string;
  chapter_id: string;
  /** "basic" = one card. "cloze" = one card per deletion index. */
  card_type: CardType;
  /** Groups cloze siblings. Equals `id` for basic cards. */
  note_id: string;
  /** Which deletion this card asks for. NULL on basic cards. */
  cloze_index: number | null;
  front: string;
  back: string;
  hint: string;
  notes: string;
  tags: string;
  starred: 0 | 1;
  suspended: 0 | 1;
  source: string;
  position: number;
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
  created_at: number;
  updated_at: number;
}

/** A card as the API and UI see it: tags parsed, media attached. */
export interface Card extends Omit<CardRow, "tags"> {
  tags: string[];
  media: CardMediaRef[];
  courseId?: string;
  courseName?: string;
  chapterName?: string;
}

/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. Matches FSRS ratings. */
export type Rating = 1 | 2 | 3 | 4;

export const CARD_STATE = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const;

export type ReviewScope =
  | { kind: "all" }
  | { kind: "course"; id: string }
  | { kind: "chapter"; id: string }
  | { kind: "starred" }
  | { kind: "tag"; tag: string };

export type ReviewMode = "due" | "cram" | "new";

export interface Counts {
  total: number;
  due: number;
  new: number;
  learning: number;
  suspended: number;
}
