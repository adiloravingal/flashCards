"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/client";
import { Button, Icon, Modal, useToast } from "./ui";

/**
 * Rename a course or a chapter.
 *
 * One dialog for both, because they are the same interaction and having two
 * would mean two chances for them to drift apart. Opens with the current name
 * selected, so the common case — replace it entirely — is a single keystroke,
 * and Enter commits without reaching for the mouse.
 */
export function RenameDialog({
  open,
  onClose,
  label,
  current,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  /** "course" or "chapter" — used in the title and the field label. */
  label: string;
  current: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();

  // Re-seed whenever it reopens, otherwise the second rename starts from
  // whatever the first one typed.
  useEffect(() => {
    if (!open) return;
    setValue(current);
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open, current]);

  const save = async () => {
    const name = value.trim();
    if (!name) {
      push("A name can't be empty", "error");
      inputRef.current?.focus();
      return;
    }
    if (name === current) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(name);
      onClose();
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not rename", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={`Rename ${label}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <label
        htmlFor="rename-field"
        className="block text-[13px] font-medium text-[var(--text-muted)] mb-1.5"
      >
        {label[0].toUpperCase() + label.slice(1)} name
      </label>
      <input
        id="rename-field"
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        className="field"
        maxLength={200}
      />
      <p className="text-xs text-[var(--text-faint)] mt-2">
        Only the name changes — cards, media and review history stay exactly as
        they are.
      </p>
    </Modal>
  );
}

/**
 * The pencil that opens it. Quiet until you hover or tab to it, but always
 * visible on touch, where there is no hover to reveal anything.
 */
export function RenameButton({
  onClick,
  label,
  className,
  alwaysVisible,
}: {
  onClick: () => void;
  label: string;
  className?: string;
  alwaysVisible?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "shrink-0 p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--surface-2)] focus:opacity-100 transition-colors",
        alwaysVisible
          ? ""
          : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100",
        className,
      )}
    >
      <Icon name="edit" className="w-4 h-4" />
    </button>
  );
}
