"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import { ExportDeckButton } from "@/components/ExportDeckButton";
import { api, useApi } from "@/lib/client";
import type { Chapter, Counts, Course } from "@/lib/types";

type ChapterRow = Chapter & {
  totalCards: number;
  dueCards: number;
  newCards: number;
};

type CourseDetail = Course & { chapters: ChapterRow[]; counts: Counts };

export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const { data, loading, reload } = useApi<CourseDetail>(`/courses/${courseId}`);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ChapterRow | null>(null);
  const { push } = useToast();

  const createChapter = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/chapters", {
        method: "POST",
        json: { courseId, name: name.trim() },
      });
      setName("");
      setCreating(false);
      await reload();
      push("Chapter added", "success");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not create", "error");
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!newName.trim()) return;
    await api(`/courses/${courseId}`, {
      method: "PATCH",
      json: { name: newName.trim() },
    });
    setRenaming(false);
    await reload();
    push("Renamed", "success");
  };

  const removeChapter = async (ch: ChapterRow) => {
    await api(`/chapters/${ch.id}`, { method: "DELETE" });
    await reload();
    push(`Deleted “${ch.name}”`, "success");
  };

  if (loading && !data) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="w-6 h-6 text-[var(--text-faint)]" />
      </div>
    );
  }
  if (!data) {
    return (
      <EmptyState
        title="Course not found"
        body="It may have been deleted."
        action={
          <Link href="/courses">
            <Button>Back to courses</Button>
          </Link>
        }
      />
    );
  }

  const ready = data.counts.due + data.counts.new;

  return (
    <>
      <PageHeader
        back={
          <Link
            href="/courses"
            className="inline-flex items-center gap-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors mb-2"
          >
            <Icon name="chevronLeft" className="w-3.5 h-3.5" />
            Courses
          </Link>
        }
        title={
          <span
            onDoubleClick={() => {
              setNewName(data.name);
              setRenaming(true);
            }}
            title="Double-click to rename"
          >
            {data.emoji && <span className="mr-2">{data.emoji}</span>}
            {data.name}
          </span>
        }
        subtitle={`${data.counts.total} cards across ${data.chapters.length} ${
          data.chapters.length === 1 ? "chapter" : "chapters"
        }`}
        actions={
          <>
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" className="w-4 h-4" />
              Chapter
            </Button>
            {ready > 0 && (
              <Link href={`/review?courseId=${courseId}`}>
                <Button variant="primary">
                  <Icon name="play" className="w-4 h-4" />
                  Review {ready}
                </Button>
              </Link>
            )}
          </>
        }
      />

      {/* Whole-course actions, available regardless of what's due. */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link href={`/review?courseId=${courseId}&mode=cram`}>
          <Button size="sm" variant="ghost">
            <Icon name="shuffle" className="w-3.5 h-3.5" />
            Practise all (no schedule change)
          </Button>
        </Link>
        {data.counts.new > 0 && (
          <Link href={`/review?courseId=${courseId}&mode=new`}>
            <Button size="sm" variant="ghost">
              <Icon name="inbox" className="w-3.5 h-3.5" />
              Learn {data.counts.new} new
            </Button>
          </Link>
        )}
        {data.counts.total > 0 && (
          <ExportDeckButton courseId={courseId} label="Export course" />
        )}
      </div>

      {data.chapters.length === 0 ? (
        <EmptyState
          icon={<Icon name="book" className="w-5 h-5" />}
          title="No chapters yet"
          body="Chapters keep a course navigable — “Week 1”, “Irregular verbs”, “Chapter 3”. You can also import a spreadsheet where each sheet becomes a chapter."
          action={
            <div className="flex gap-2">
              <Link href="/import">
                <Button>Import</Button>
              </Link>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Add chapter
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-2 anim-fade-up">
          {data.chapters.map((ch) => (
            <Panel
              key={ch.id}
              className="p-3.5 flex items-center gap-3 group transition-colors hover:border-[var(--border-strong)]"
            >
              <Link
                href={`/courses/${courseId}/${ch.id}`}
                className="min-w-0 grow flex items-center gap-3"
              >
                <div className="min-w-0 grow">
                  <p className="font-medium text-sm truncate">{ch.name}</p>
                  <p className="text-xs text-[var(--text-faint)] mt-0.5">
                    {ch.totalCards} {ch.totalCards === 1 ? "card" : "cards"}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {ch.dueCards > 0 && <Badge tone="due">{ch.dueCards} due</Badge>}
                  {ch.newCards > 0 && <Badge tone="new">{ch.newCards} new</Badge>}
                </div>
              </Link>

              <div className="flex items-center gap-1 shrink-0">
                {ch.dueCards + ch.newCards > 0 && (
                  <Link href={`/review?chapterId=${ch.id}`}>
                    <Button size="sm">Review</Button>
                  </Link>
                )}
                <button
                  onClick={() => setConfirmDelete(ch)}
                  aria-label={`Delete ${ch.name}`}
                  className="text-[var(--text-faint)] hover:text-[var(--again)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5"
                >
                  <Icon name="trash" className="w-4 h-4" />
                </button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <div className="mt-10 pt-5 border-t border-[var(--border)]">
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            if (
              !window.confirm(
                `Delete the entire course “${data.name}” and all ${data.counts.total} cards? This cannot be undone.`,
              )
            )
              return;
            await api(`/courses/${courseId}`, { method: "DELETE" });
            router.push("/courses");
          }}
        >
          <Icon name="trash" className="w-3.5 h-3.5" />
          Delete this course
        </Button>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New chapter"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={createChapter} loading={busy}>
              Add
            </Button>
          </>
        }
      >
        <Field label="Name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createChapter()}
            placeholder="Week 1, Irregular verbs, Chapter 3…"
            className="field"
            autoFocus
          />
        </Field>
      </Modal>

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename course"
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button variant="primary" onClick={rename}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Name">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void rename()}
            className="field"
            autoFocus
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void removeChapter(confirmDelete)}
        title={`Delete “${confirmDelete?.name}”?`}
        body={`This removes ${confirmDelete?.totalCards ?? 0} card(s) and their history. This cannot be undone.`}
      />
    </>
  );
}
