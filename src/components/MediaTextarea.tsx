"use client";

import { useRef, useState } from "react";
import { cx } from "@/lib/client";
import { filesFromTransfer, hasPlainText } from "@/lib/clipboard";
import { Icon, Spinner } from "./ui";

/**
 * A textarea you can paste or drop anything into.
 *
 * The point is that the cursor is already here. Making someone move to a
 * separate "attach" control to add the screenshot they just took is exactly
 * the kind of small detour that ends with the card never getting made.
 *
 * Text pastes behave completely normally; files are intercepted and uploaded.
 * A paste carrying both (copying a region of a web page, say) does both.
 */
export function MediaTextarea({
  onFiles,
  uploading,
  className,
  hint,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  onFiles: (files: File[]) => void;
  uploading?: boolean;
  hint?: string;
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  const [dragging, setDragging] = useState(false);
  // Drag events fire for every child element; counting keeps the highlight
  // from flickering as the pointer crosses the textarea's own bounds.
  const depth = useRef(0);

  return (
    <div className="relative">
      <textarea
        {...props}
        className={cx(className, dragging && "ring-2 ring-[var(--accent)]")}
        onPaste={(e) => {
          const files = filesFromTransfer(e.clipboardData);
          if (files.length === 0) return; // plain text — nothing to do

          // Only swallow the event when there's no text to insert, so a mixed
          // paste still drops its text in at the cursor.
          if (!hasPlainText(e.clipboardData)) e.preventDefault();
          onFiles(files);
          props.onPaste?.(e);
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer?.types?.includes("Files")) return;
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          const files = filesFromTransfer(e.dataTransfer);
          depth.current = 0;
          setDragging(false);
          if (files.length === 0) return;
          e.preventDefault();
          onFiles(files);
        }}
      />

      {dragging && (
        <div className="absolute inset-0 rounded-[var(--radius)] bg-[var(--accent-soft)] border-2 border-dashed border-[var(--accent)] grid place-items-center pointer-events-none anim-fade">
          <span className="text-[13px] font-medium text-[var(--accent)] inline-flex items-center gap-1.5">
            <Icon name="plus" className="w-4 h-4" />
            Drop to attach {hint ? `to the ${hint}` : ""}
          </span>
        </div>
      )}

      {uploading && (
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded-md pointer-events-none">
          <Spinner className="w-3 h-3" />
          Uploading…
        </span>
      )}
    </div>
  );
}
