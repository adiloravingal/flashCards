"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  useToast,
} from "@/components/ui";
import { RenameButton, RenameDialog } from "@/components/RenameDialog";
import { api, useApi } from "@/lib/client";
import type { Course } from "@/lib/types";

type CourseRow = Course & {
  totalCards: number;
  dueCards: number;
  newCards: number;
};

export default function CoursesPage() {
  const { data, loading, reload } = useApi<CourseRow[]>("/courses");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CourseRow | null>(null);
  const [renaming, setRenaming] = useState<CourseRow | null>(null);
  const { push } = useToast();

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/courses", {
        method: "POST",
        json: { name: name.trim(), emoji: emoji.trim() },
      });
      setName("");
      setEmoji("");
      setCreating(false);
      await reload();
      push("Course created", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not create", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (course: CourseRow) => {
    try {
      await api(`/courses/${course.id}`, { method: "DELETE" });
      await reload();
      push(`Deleted “${course.name}”`, "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not delete", "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="Each course holds chapters. You can review at any level."
        actions={
          <>
            <Link href="/import">
              <Button>
                <Icon name="upload" className="w-4 h-4" />
                Import
              </Button>
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" className="w-4 h-4" />
              New course
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <div className="grid place-items-center py-24">
          <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Icon name="layers" className="w-5 h-5" />}
          title="No courses yet"
          body="A course is just a container — “Spanish”, “Anatomy”, “Guitar chords”. Make one, or import a spreadsheet and get both a course and chapters in one go."
          action={
            <div className="flex gap-2">
              <Link href="/import">
                <Button>Import a file</Button>
              </Link>
              <Button variant="primary" onClick={() => setCreating(true)}>
                New course
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 anim-fade-up">
          {data!.map((c) => (
            <Panel
              key={c.id}
              className="p-4 group transition-colors hover:border-[var(--border-strong)]"
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/course?id=${c.id}`} className="min-w-0 grow">
                  <p className="font-medium truncate">
                    {c.emoji && <span className="mr-1.5">{c.emoji}</span>}
                    {c.name}
                  </p>
                  <p className="text-xs text-[var(--text-faint)] mt-1">
                    {c.totalCards} {c.totalCards === 1 ? "card" : "cards"}
                  </p>
                  <div className="flex gap-1.5 mt-2.5">
                    {c.dueCards > 0 && <Badge tone="due">{c.dueCards} due</Badge>}
                    {c.newCards > 0 && <Badge tone="new">{c.newCards} new</Badge>}
                    {c.dueCards === 0 && c.newCards === 0 && c.totalCards > 0 && (
                      <Badge tone="muted">caught up</Badge>
                    )}
                  </div>
                </Link>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  {c.dueCards + c.newCards > 0 && (
                    <Link href={`/review?courseId=${c.id}`}>
                      <Button size="sm" variant="primary">
                        <Icon name="play" className="w-3.5 h-3.5" />
                        Review
                      </Button>
                    </Link>
                  )}
                  <div className="flex items-center gap-0.5">
                    <RenameButton
                      label={`Rename ${c.name}`}
                      onClick={() => setRenaming(c)}
                    />
                  <button
                    onClick={() => setConfirmDelete(c)}
                    aria-label={`Delete ${c.name}`}
                    className="text-[var(--text-faint)] hover:text-[var(--again)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 p-1"
                  >
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New course"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} loading={busy}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="Spanish, Anatomy, Music theory…"
              className="field"
              autoFocus
            />
          </Field>
          <Field label="Emoji" hint="Optional. Makes it easier to spot in a list.">
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="📚"
              maxLength={4}
              className="field w-20 text-center text-lg"
            />
          </Field>
        </div>
      </Modal>

      <RenameDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        label="course"
        current={renaming?.name ?? ""}
        onSave={async (name) => {
          await api(`/courses/${renaming!.id}`, { method: "PATCH", json: { name } });
          await reload();
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        title={`Delete “${confirmDelete?.name}”?`}
        body={
          <>
            This removes the course, its {confirmDelete?.totalCards ?? 0} card(s)
            and all their review history. This cannot be undone.
          </>
        }
      />
    </>
  );
}
