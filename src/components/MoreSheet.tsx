"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cx, useHotkeys } from "@/lib/client";
import { Icon } from "./ui";

export interface SheetItem {
  href: string;
  label: string;
  icon: string;
  /** One line saying what this is for, so nothing needs to be guessed at. */
  hint: string;
}

/**
 * The destinations that don't earn a permanent slot in a five-target bottom
 * bar. On desktop these live in the sidebar's lower group; on a phone they'd
 * otherwise be unreachable entirely.
 *
 * A bottom sheet rather than a full page: it keeps you where you were, closes
 * by tapping anywhere, and costs one tap. Rarely-used destinations shouldn't
 * take up permanent screen furniture, but they must never be *missing*.
 */
export function MoreSheet({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: SheetItem[];
}) {
  const pathname = usePathname();

  useHotkeys([{ key: "escape", allowInInput: true, run: onClose }], open);

  // Navigating away should dismiss the sheet, otherwise it would still be
  // sitting there over the page you just asked for.
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Don't let the page behind scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="md:hidden fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] anim-fade"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="More"
        className="absolute inset-x-0 bottom-0 anim-sheet-up bg-[var(--surface)] border-t border-[var(--border)] rounded-t-[var(--radius-lg)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-[var(--shadow-lg)]"
      >
        {/* Grabber: says "this slides away" without spending a row on a title
            bar and a close button. */}
        <div className="pt-2.5 pb-1.5 grid place-items-center">
          <span className="w-9 h-1 rounded-full bg-[var(--border)]" />
        </div>

        <nav className="px-2 pb-1">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cx(
                  "flex items-center gap-3.5 px-3 py-3 rounded-[var(--radius)] transition-colors",
                  active
                    ? "bg-[var(--surface-2)]"
                    : "active:bg-[var(--surface-2)]",
                )}
              >
                <span
                  className={cx(
                    "w-9 h-9 rounded-[10px] grid place-items-center shrink-0",
                    active
                      ? "bg-[var(--accent)] text-[var(--accent-text)]"
                      : "bg-[var(--surface-2)] text-[var(--text-muted)]",
                  )}
                >
                  <Icon name={item.icon} className="w-[18px] h-[18px]" />
                </span>
                <span className="min-w-0">
                  <span
                    className={cx(
                      "block text-[15px] leading-tight",
                      active
                        ? "font-medium text-[var(--text)]"
                        : "text-[var(--text)]",
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="block text-[12.5px] text-[var(--text-faint)] mt-0.5 truncate">
                    {item.hint}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
