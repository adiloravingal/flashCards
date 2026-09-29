"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/client";
import { Button, Icon, Modal } from "./ui";

/**
 * Blocking parts of an image out.
 *
 * A diagram with three labels covered is three questions you already own —
 * retyping them as text cards is the friction that stops people making them at
 * all. So: paste the screenshot, drag over what you want hidden, done.
 *
 * The masks are *burned into a new image* rather than stored as geometry the
 * reviewer has to re-render. That keeps the whole feature inside the existing
 * model — a card with a picture on the front and a picture on the back — so
 * review, cloze, `.fcdeck` export, Anki import and the Android build all keep
 * working without knowing this feature exists. The cost is that a saved mask
 * can only be adjusted by redrawing it, which is why the rectangles are also
 * kept locally (see `rememberMask`) and offered back to you on re-open.
 */

/** Fractions of the image's own width and height, so scale never matters. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Anything smaller than this is a stray click, not a rectangle. */
const MIN_SIDE = 0.012;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The mask colour, taken from the theme so it can't clash with it. */
function maskColor(): string {
  if (typeof window === "undefined") return "#6d5efc";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return v || "#6d5efc";
}

/* ========================================================================== *
 * Remembering what was drawn
 * ========================================================================== */

const MASK_KEY = "fc-image-masks";

type MaskMemory = Record<string, { sourceUrl: string; rects: Rect[] }>;

const readMemory = (): MaskMemory => {
  try {
    const raw = localStorage.getItem(MASK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as MaskMemory) : {};
  } catch {
    return {};
  }
};

/**
 * Keeps the last 50 masks, so re-opening the editor on a card you made last
 * week starts from the rectangles you drew rather than from scratch. Local to
 * the device and purely an accelerator: losing it costs a redraw, nothing more.
 */
export function rememberMask(maskedId: string, sourceUrl: string, rects: Rect[]) {
  try {
    const all = readMemory();
    all[maskedId] = { sourceUrl, rects };
    const keys = Object.keys(all);
    if (keys.length > 50) for (const k of keys.slice(0, keys.length - 50)) delete all[k];
    localStorage.setItem(MASK_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export const recallMask = (maskedId: string) => readMemory()[maskedId] ?? null;

/* ========================================================================== *
 * Burning the masks in
 * ========================================================================== */

/** Draw the image with its rectangles filled in, and hand back a PNG. */
export async function burnMasks(src: string, rects: Rect[]): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser won't give us a canvas to draw on.");

  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = maskColor();
  for (const r of rects) {
    ctx.fillRect(
      r.x * canvas.width,
      r.y * canvas.height,
      r.w * canvas.width,
      r.h * canvas.height,
    );
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Couldn't turn the masked image into a file.");
  return blob;
}

/* ========================================================================== *
 * The editor
 * ========================================================================== */

export function OcclusionEditor({
  open,
  src,
  initialRects = [],
  busy = false,
  onCancel,
  onSave,
}: {
  open: boolean;
  src: string;
  initialRects?: Rect[];
  busy?: boolean;
  onCancel: () => void;
  onSave: (rects: Rect[]) => void;
}) {
  const [rects, setRects] = useState<Rect[]>(initialRects);
  const [drawing, setDrawing] = useState<Rect | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  // Re-opening on a different image must not inherit the last one's boxes.
  useEffect(() => {
    if (open) setRects(initialRects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, src]);

  const pointToFraction = (e: React.PointerEvent) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return {
      x: clamp01((e.clientX - box.left) / box.width),
      y: clamp01((e.clientY - box.top) / box.height),
    };
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = pointToFraction(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = p;
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const move = (e: React.PointerEvent) => {
    if (!origin.current) return;
    const p = pointToFraction(e);
    if (!p) return;
    const o = origin.current;
    setDrawing({
      x: Math.min(o.x, p.x),
      y: Math.min(o.y, p.y),
      w: Math.abs(p.x - o.x),
      h: Math.abs(p.y - o.y),
    });
  };

  const up = () => {
    if (drawing && drawing.w > MIN_SIDE && drawing.h > MIN_SIDE) {
      setRects((r) => [...r, drawing]);
    }
    origin.current = null;
    setDrawing(null);
  };

  const asStyle = (r: Rect) => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  });

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Block out parts of the image"
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-[var(--text-muted)]">
            {rects.length === 0
              ? "Drag across anything you want hidden"
              : `${rects.length} block${rects.length === 1 ? "" : "s"}`}
          </span>
          {rects.length > 0 && (
            <>
              <Button
                variant="ghost"
                onClick={() => setRects((r) => r.slice(0, -1))}
                disabled={busy}
              >
                Undo
              </Button>
              <Button variant="ghost" onClick={() => setRects([])} disabled={busy}>
                Clear
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave(rects)}
            disabled={busy || rects.length === 0}
            loading={busy}
          >
            Use as front
          </Button>
        </>
      }
    >
      <div className="flex justify-center">
        <div
          ref={surface}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="relative inline-block touch-none select-none cursor-crosshair"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Image being masked"
            draggable={false}
            className="block max-h-[58vh] max-w-full rounded-[10px]"
          />

          {rects.map((r, i) => (
            <div
              key={i}
              style={asStyle(r)}
              className="absolute bg-[var(--accent)] group/mask"
            >
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setRects((all) => all.filter((_, n) => n !== i))}
                aria-label={`Remove block ${i + 1}`}
                className={cx(
                  "absolute -top-2 -right-2 w-5 h-5 rounded-full bg-black/75 text-white",
                  "grid place-items-center opacity-0 group-hover/mask:opacity-100",
                  "focus:opacity-100 transition-opacity",
                )}
              >
                <Icon name="x" className="w-3 h-3" strokeWidth={2.5} />
              </button>
            </div>
          ))}

          {drawing && (
            <div
              style={asStyle(drawing)}
              className="absolute bg-[var(--accent)]/60 outline-2 outline-dashed outline-[var(--accent)]"
            />
          )}
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--text-muted)] text-center">
        The blocked version becomes the question. Tick{" "}
        <span className="text-[var(--text)]">Show the full image as the answer</span>{" "}
        to keep the original on the back.
      </p>
    </Modal>
  );
}
