"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/lib/client";
import { clozeToPlainText, renderCloze } from "@/lib/cloze";
import type { CardMediaRef } from "@/lib/types";
import { Icon } from "./ui";

/**
 * Cloze text. The blank is a filled slab rather than an underline so it reads
 * as "something goes here" at a glance; on the back the same span turns into
 * the accent colour, so your eye lands on the answer without hunting.
 */
function ClozeText({
  source,
  index,
  side,
  small,
}: {
  source: string;
  index: number;
  side: "front" | "back";
  small?: boolean;
}) {
  return (
    <p
      className={cx(
        "preserve-lines text-center",
        small ? "card-text-sm" : "card-text",
      )}
    >
      {renderCloze(source, index, side).map((seg, i) => {
        if (seg.kind === "blank") {
          return (
            <span
              key={i}
              className="inline-block px-2.5 mx-0.5 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] font-medium align-baseline"
            >
              {seg.text}
            </span>
          );
        }
        if (seg.kind === "answer") {
          return (
            <span
              key={i}
              className="inline-block px-2.5 mx-0.5 rounded-md bg-[var(--accent)] text-[var(--accent-text)] font-medium align-baseline"
            >
              {seg.text}
            </span>
          );
        }
        if (seg.kind === "revealed") {
          // Other deletions stay legible but recede — they're context, not
          // the thing being asked.
          return (
            <span key={i} className="text-[var(--text-muted)]">
              {seg.text}
            </span>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </p>
  );
}

/**
 * Renders one side of a card: its text plus any attached media.
 * Audio can auto-play (useful for language cards where the prompt *is* the
 * sound), and text can be spoken with the browser voice.
 */
export function CardFace({
  text,
  media,
  side,
  autoPlayAudio,
  speak,
  small,
  clozeIndex,
}: {
  text: string;
  media: CardMediaRef[];
  side: "front" | "back";
  autoPlayAudio?: boolean;
  speak?: boolean;
  small?: boolean;
  /** Set on cloze cards: which deletion this card is asking for. */
  clozeIndex?: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const mine = media.filter((m) => m.side === side);
  const audio = mine.filter((m) => m.kind === "audio");
  const images = mine.filter((m) => m.kind === "image");
  const videos = mine.filter((m) => m.kind === "video");
  const files = mine.filter((m) => m.kind === "pdf" || m.kind === "file");

  useEffect(() => {
    if (autoPlayAudio && audioRef.current) {
      // Browsers block autoplay until the user has interacted; ignore refusals.
      audioRef.current.play().catch(() => {});
    }
  }, [autoPlayAudio, text]);

  useEffect(() => {
    if (!speak || !text.trim()) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Never read the markup aloud — "open brace open brace c one colon colon".
    const spoken =
      typeof clozeIndex === "number" ? clozeToPlainText(text) : text;
    const utter = new SpeechSynthesisUtterance(spoken);
    utter.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    return () => window.speechSynthesis.cancel();
  }, [speak, text, clozeIndex]);

  return (
    <div className="flex flex-col items-center gap-5 w-full">
      {images.length > 0 && (
        <div
          className={cx(
            "flex flex-wrap justify-center gap-3 w-full",
            images.length === 1 ? "" : "max-w-2xl",
          )}
        >
          {images.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={m.id}
              src={m.url}
              alt=""
              // Mid-review is the worst possible moment to show a broken-image
              // glyph. If it won't decode, take it out of the layout entirely
              // rather than let it sit there looking like a bug.
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              className={cx(
                // dvh so a collapsing mobile address bar doesn't push the
                // image past the fold it was sized to fit inside.
                "rounded-[var(--radius)] object-contain border border-[var(--border)]",
                images.length === 1
                  ? small
                    ? "max-h-40"
                    : "max-h-[34dvh]"
                  : "max-h-40",
              )}
            />
          ))}
        </div>
      )}

      {videos.map((m) => (
        <video
          key={m.id}
          src={m.url}
          controls
          className="rounded-[var(--radius)] max-h-[38vh] border border-[var(--border)]"
        />
      ))}

      {text.trim() &&
        (typeof clozeIndex === "number" ? (
          <ClozeText source={text} index={clozeIndex} side={side} small={small} />
        ) : (
          <p
            className={cx(
              "preserve-lines text-center",
              small ? "card-text-sm" : "card-text",
            )}
          >
            {text}
          </p>
        ))}

      {audio.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          {audio.map((m, i) => (
            <audio
              key={m.id}
              ref={i === 0 ? audioRef : undefined}
              src={m.url}
              controls
              className="h-9"
            />
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {files.map((m) => (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 h-9 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] text-sm hover:border-[var(--accent)] transition-colors"
            >
              <Icon name="file" className="w-4 h-4 text-[var(--text-faint)]" />
              <span className="max-w-[16rem] truncate">{m.original_name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
