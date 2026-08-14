"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  Button,
  Icon,
  PageHeader,
  Panel,
  Spinner,
  useToast,
} from "@/components/ui";
import { api, cx, useApi } from "@/lib/client";
import type { Course } from "@/lib/types";

interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: string[][];
  guess: {
    frontColumn: number;
    backColumn: number;
    hintColumn: number;
    tagsColumn: number;
    notesColumn: number;
    skipFirstRow: boolean;
  };
  totalRows: number;
  nonEmptyRows: number;
}

interface DeckAnalysis {
  stagingId: string;
  filename: string;
  exportedAt: string;
  scope: "course" | "chapter";
  course: { name: string; description?: string; emoji?: string };
  totalCards: number;
  mediaCount: number;
  existingCourse: { id: string; name: string } | null;
  chapters: {
    name: string;
    cards: number;
    clozeCards: number;
    sampleFront: string;
    sampleBack: string;
  }[];
}

interface AnkiDeckSummary {
  name: string;
  course: string;
  chapter: string;
  notes: number;
  clozeNotes: number;
  sampleFront: string;
  sampleBack: string;
}

interface AnkiAnalysis {
  stagingId: string;
  filename: string;
  schema: string;
  totalNotes: number;
  skipped: number;
  mediaCount: number;
  decks: AnkiDeckSummary[];
}

interface AnkiDeckPlan {
  name: string;
  include: boolean;
  course: string;
  chapter: string;
}

interface SheetPlan {
  sheetName: string;
  chapterName: string;
  include: boolean;
  frontColumn: number;
  backColumn: number;
  hintColumn: number;
  tagsColumn: number;
  notesColumn: number;
  skipFirstRow: boolean;
  rows: string[][];
}

export default function ImportPage() {
  const router = useRouter();
  const { push } = useToast();
  const courses = useApi<(Course & { totalCards: number })[]>("/courses");

  const [file, setFile] = useState<File | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [plans, setPlans] = useState<SheetPlan[]>([]);
  const [anki, setAnki] = useState<AnkiAnalysis | null>(null);
  const [ankiPlan, setAnkiPlan] = useState<AnkiDeckPlan[]>([]);
  const [deck, setDeck] = useState<DeckAnalysis | null>(null);
  const [deckName, setDeckName] = useState("");
  const [target, setTarget] = useState<"new" | string>("new");
  const [courseName, setCourseName] = useState("");
  const [committing, setCommitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Anki packages take a different route through the API than spreadsheets. */
  /** A `.fcdeck` shared by another copy of this app. */
  const analyseDeck = async (f: File) => {
    setFile(f);
    setAnalysing(true);
    setDeck(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/v1/import/deck/analyze", {
        method: "POST",
        body: form,
      });
      const payload = (await res.json()) as
        | { ok: true; data: DeckAnalysis }
        | { ok: false; error: { message: string } };

      if (!payload.ok) {
        push(payload.error.message, "error");
        setFile(null);
        return;
      }
      setDeck(payload.data);
      setDeckName(payload.data.course.name);
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not read that deck", "error");
      setFile(null);
    } finally {
      setAnalysing(false);
    }
  };

  const commitDeck = async () => {
    if (!deck) return;
    setCommitting(true);
    try {
      const result = await api<{ courseId: string; cardsCreated: number; mediaImported: number }>(
        "/import/deck/commit",
        {
          method: "POST",
          json: { stagingId: deck.stagingId, courseName: deckName.trim() || undefined },
        },
      );
      push(
        `Imported ${result.cardsCreated} cards` +
          (result.mediaImported ? ` and ${result.mediaImported} files` : ""),
        "success",
      );
      router.push(`/courses/${result.courseId}`);
    } catch (err) {
      push(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setCommitting(false);
    }
  };

  const analyseAnki = async (f: File) => {
    setFile(f);
    setAnalysing(true);
    setAnki(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/v1/import/anki/analyze", {
        method: "POST",
        body: form,
      });
      const payload = (await res.json()) as
        | { ok: true; data: AnkiAnalysis }
        | { ok: false; error: { message: string } };

      if (!payload.ok) {
        push(payload.error.message, "error");
        setFile(null);
        return;
      }
      setAnki(payload.data);
      setAnkiPlan(
        payload.data.decks.map((d) => ({
          name: d.name,
          include: true,
          course: d.course,
          chapter: d.chapter,
        })),
      );
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not read that deck", "error");
      setFile(null);
    } finally {
      setAnalysing(false);
    }
  };

  const commitAnki = async () => {
    if (!anki) return;
    setCommitting(true);
    try {
      const result = await api<{ courseId?: string; cardsCreated: number; mediaImported: number }>(
        "/import/anki/commit",
        { method: "POST", json: { stagingId: anki.stagingId, decks: ankiPlan } },
      );
      push(
        `Imported ${result.cardsCreated} cards` +
          (result.mediaImported ? ` and ${result.mediaImported} files` : ""),
        "success",
      );
      router.push(result.courseId ? `/courses/${result.courseId}` : "/courses");
    } catch (err) {
      push(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setCommitting(false);
    }
  };

  const analyse = async (f: File) => {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".fcdeck")) return analyseDeck(f);
    if (lower.endsWith(".apkg")) return analyseAnki(f);
    setFile(f);
    setAnalysing(true);
    setSheets(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/v1/import/analyze", {
        method: "POST",
        body: form,
      });
      const payload = (await res.json()) as
        | { ok: true; data: { sheets: ParsedSheet[] } }
        | { ok: false; error: { message: string } };

      if (!payload.ok) {
        push(payload.error.message, "error");
        setFile(null);
        return;
      }

      setSheets(payload.data.sheets);
      setPlans(
        payload.data.sheets.map((s) => ({
          sheetName: s.sheetName,
          chapterName: s.sheetName,
          include: true,
          ...s.guess,
          rows: s.rows,
        })),
      );
      setCourseName(f.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not read that file", "error");
      setFile(null);
    } finally {
      setAnalysing(false);
    }
  };

  const commit = async () => {
    setCommitting(true);
    try {
      const result = await api<{ courseId: string; created: number }>(
        "/import/commit",
        {
          method: "POST",
          json: {
            ...(target === "new"
              ? { newCourseName: courseName.trim() || "Imported" }
              : { courseId: target }),
            sheets: plans,
          },
        },
      );
      push(`Imported ${result.created} cards`, "success");
      router.push(`/courses/${result.courseId}`);
    } catch (err) {
      push(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setCommitting(false);
    }
  };

  const totalCards = plans
    .filter((p) => p.include)
    .reduce(
      (n, p) => n + (p.skipFirstRow ? Math.max(0, p.rows.length - 1) : p.rows.length),
      0,
    );

  /* ---- Shared deck confirm screen -------------------------------------- */
  if (deck) {
    return (
      <>
        <PageHeader
          title="Shared deck"
          subtitle={`${deck.course.name} · ${deck.totalCards} cards in ${
            deck.chapters.length
          } ${deck.chapters.length === 1 ? "chapter" : "chapters"}${
            deck.mediaCount ? `, ${deck.mediaCount} files` : ""
          }`}
          actions={
            <>
              <Button
                onClick={() => {
                  setDeck(null);
                  setFile(null);
                }}
              >
                Start over
              </Button>
              <Button variant="primary" onClick={commitDeck} loading={committing}>
                Import {deck.totalCards} card{deck.totalCards === 1 ? "" : "s"}
              </Button>
            </>
          }
        />

        <Panel className="p-4 mb-5">
          <label
            htmlFor="deck-course-name"
            className="block text-[13px] font-medium text-[var(--text-muted)] mb-1.5"
          >
            Import into course
          </label>
          <input
            id="deck-course-name"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            className="field"
          />
          {deck.existingCourse &&
          deckName.trim().toLowerCase() ===
            deck.existingCourse.name.toLowerCase() ? (
            <p className="text-[13px] text-[var(--hard)] mt-2">
              You already have a course called “{deck.existingCourse.name}”.
              These chapters will be added to it — rename above to keep them
              separate.
            </p>
          ) : (
            <p className="text-[13px] text-[var(--text-faint)] mt-2">
              Cards arrive unseen, with no review history — the sender&apos;s
              schedule says nothing about your memory.
            </p>
          )}
        </Panel>

        <div className="space-y-2">
          {deck.chapters.map((chapter) => (
            <Panel key={chapter.name} className="p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium truncate">{chapter.name}</p>
                <p className="text-xs text-[var(--text-faint)] shrink-0">
                  {chapter.cards} card{chapter.cards === 1 ? "" : "s"}
                  {chapter.clozeCards > 0 && ` · ${chapter.clozeCards} cloze`}
                </p>
              </div>
              {chapter.sampleFront && (
                <div className="flex items-start gap-3 text-[13px] mt-3 py-1.5 px-2.5 rounded-lg bg-[var(--surface-2)]">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {chapter.sampleFront}
                  </span>
                  <Icon
                    name="chevronRight"
                    className="w-3.5 h-3.5 text-[var(--text-faint)] mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                    {chapter.sampleBack || "—"}
                  </span>
                </div>
              )}
            </Panel>
          ))}
        </div>
      </>
    );
  }

  /* ---- Anki confirm screen --------------------------------------------- */
  if (anki) {
    const selected = ankiPlan.filter((p) => p.include);
    const selectedNotes = anki.decks
      .filter((d) => selected.some((p) => p.name === d.name))
      .reduce((n, d) => n + d.notes, 0);

    return (
      <>
        <PageHeader
          title="Anki deck"
          subtitle={`${anki.filename} · ${anki.totalNotes} notes, ${anki.decks.length} deck${
            anki.decks.length === 1 ? "" : "s"
          }${anki.mediaCount ? `, ${anki.mediaCount} media files` : ""}`}
          actions={
            <>
              <Button
                onClick={() => {
                  setAnki(null);
                  setFile(null);
                }}
              >
                Start over
              </Button>
              <Button
                variant="primary"
                onClick={commitAnki}
                loading={committing}
                disabled={selected.length === 0}
              >
                Import {selectedNotes} note{selectedNotes === 1 ? "" : "s"}
              </Button>
            </>
          }
        />

        <Panel className="p-4 mb-5">
          <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
            Anki decks nest with <code className="text-[var(--accent)]">::</code>.
            The first level becomes a course and the rest becomes a chapter —
            edit either below. Cloze notes stay cloze, and formatting is
            flattened to plain text.
          </p>
        </Panel>

        <div className="space-y-2">
          {anki.decks.map((deck, i) => {
            const plan = ankiPlan[i];
            if (!plan) return null;
            const set = (patch: Partial<AnkiDeckPlan>) =>
              setAnkiPlan((ps) =>
                ps.map((p, j) => (j === i ? { ...p, ...patch } : p)),
              );

            return (
              <Panel
                key={deck.name}
                className={cx("p-4", !plan.include && "opacity-55")}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={plan.include}
                    onChange={(e) => set({ include: e.target.checked })}
                    className="w-4 h-4 accent-[var(--accent)] cursor-pointer mt-1"
                    aria-label={`Include ${deck.name}`}
                  />
                  <div className="min-w-0 grow">
                    <p className="text-sm font-medium truncate">{deck.name}</p>
                    <p className="text-xs text-[var(--text-faint)] mt-0.5">
                      {deck.notes} note{deck.notes === 1 ? "" : "s"}
                      {deck.clozeNotes > 0 && ` · ${deck.clozeNotes} cloze`}
                    </p>

                    {plan.include && (
                      <>
                        <div className="grid sm:grid-cols-2 gap-2.5 mt-3">
                          <label className="block">
                            <span className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                              Course
                            </span>
                            <input
                              value={plan.course}
                              onChange={(e) => set({ course: e.target.value })}
                              className="field h-8 py-0 text-[13px]"
                            />
                          </label>
                          <label className="block">
                            <span className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                              Chapter
                            </span>
                            <input
                              value={plan.chapter}
                              onChange={(e) => set({ chapter: e.target.value })}
                              className="field h-8 py-0 text-[13px]"
                            />
                          </label>
                        </div>

                        {deck.sampleFront && (
                          <div className="flex items-start gap-3 text-[13px] mt-3 py-1.5 px-2.5 rounded-lg bg-[var(--surface-2)]">
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {deck.sampleFront}
                            </span>
                            <Icon
                              name="chevronRight"
                              className="w-3.5 h-3.5 text-[var(--text-faint)] mt-0.5 shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                              {deck.sampleBack || "—"}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>

        {anki.skipped > 0 && (
          <p className="text-xs text-[var(--text-faint)] mt-5">
            {anki.skipped} empty note{anki.skipped === 1 ? "" : "s"} will be
            skipped.
          </p>
        )}
      </>
    );
  }

  /* ---- Step 1: drop a file --------------------------------------------- */
  if (!sheets) {
    return (
      <>
        <PageHeader
          title="Import"
          subtitle="Spreadsheets and Anki decks. You confirm what happens before anything is saved."
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void analyse(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={cx(
            "border-2 border-dashed rounded-[var(--radius-lg)] p-14 text-center cursor-pointer transition-colors",
            dragging
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--border-strong)] hover:border-[var(--accent)] hover:bg-[var(--surface-2)]",
          )}
        >
          {analysing ? (
            <>
              <Spinner className="w-7 h-7 mx-auto text-[var(--accent)] mb-4" />
              <p className="text-sm text-[var(--text-muted)]">
                Reading {file?.name}…
              </p>
            </>
          ) : (
            <>
              <Icon
                name="upload"
                className="w-8 h-8 mx-auto text-[var(--text-faint)] mb-4"
                strokeWidth={1.5}
              />
              <p className="font-medium">Drop a file here</p>
              <p className="text-sm text-[var(--text-muted)] mt-1.5">
                or click to choose · .fcdeck, .apkg, .xlsx, .csv, .tsv
              </p>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".fcdeck,.apkg,.xlsx,.xls,.csv,.tsv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void analyse(f);
            e.target.value = "";
          }}
        />

        <Panel className="mt-6 p-4">
          <p className="text-[13px] font-medium mb-2">Shared decks (.fcdeck)</p>
          <ul className="text-[13px] text-[var(--text-muted)] space-y-1.5 leading-relaxed mb-4">
            <li>
              · What you get from{" "}
              <strong className="font-medium text-[var(--text)]">
                Export course
              </strong>{" "}
              or{" "}
              <strong className="font-medium text-[var(--text)]">
                Export chapter
              </strong>
              . Cards, media and structure, ready to hand to someone else.
            </li>
            <li>
              · Cloze notes stay cloze. Cards arrive unseen — review history
              isn&apos;t shared, because it wouldn&apos;t mean anything.
            </li>
          </ul>

          <p className="text-[13px] font-medium mb-2">Anki decks (.apkg)</p>
          <ul className="text-[13px] text-[var(--text-muted)] space-y-1.5 leading-relaxed mb-4">
            <li>
              · Shared decks from AnkiWeb work, old and new export formats
              alike.
            </li>
            <li>
              · Subdecks map to courses and chapters —{" "}
              <code className="text-[var(--accent)]">Spanish::Verbs</code>{" "}
              becomes the course “Spanish”, chapter “Verbs”.
            </li>
            <li>· Cloze notes stay cloze. Images and audio come across too.</li>
            <li>
              · Formatting is flattened to plain text; note templates are not
              carried over.
            </li>
          </ul>

          <p className="text-[13px] font-medium mb-2">Spreadsheets</p>
          <ul className="text-[13px] text-[var(--text-muted)] space-y-1.5 leading-relaxed">
            <li>
              · Two columns is enough — the first becomes the front, the second
              the back.
            </li>
            <li>
              · Headers like <code className="text-[var(--accent)]">front</code>,{" "}
              <code className="text-[var(--accent)]">back</code>,{" "}
              <code className="text-[var(--accent)]">question</code>,{" "}
              <code className="text-[var(--accent)]">answer</code>,{" "}
              <code className="text-[var(--accent)]">term</code>,{" "}
              <code className="text-[var(--accent)]">definition</code> are detected
              automatically.
            </li>
            <li>· Extra columns for hint, notes and tags are picked up if present.</li>
            <li>· Multiple sheets become multiple chapters in one course.</li>
            <li>· Nothing is written until you press Import on the next screen.</li>
          </ul>
        </Panel>
      </>
    );
  }

  /* ---- Step 2: confirm the mapping ------------------------------------- */
  return (
    <>
      <PageHeader
        title="Check the columns"
        subtitle={`${file?.name} · ${sheets.length} sheet${sheets.length === 1 ? "" : "s"} found`}
        actions={
          <>
            <Button
              onClick={() => {
                setSheets(null);
                setFile(null);
              }}
            >
              Start over
            </Button>
            <Button
              variant="primary"
              onClick={commit}
              loading={committing}
              disabled={totalCards === 0}
            >
              Import {totalCards} card{totalCards === 1 ? "" : "s"}
            </Button>
          </>
        }
      />

      <Panel className="p-4 mb-5">
        <p className="text-[13px] font-medium mb-3">Put these cards in</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="field h-9 py-0 w-auto"
            aria-label="Destination course"
          >
            <option value="new">＋ A new course</option>
            {(courses.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.totalCards} cards)
              </option>
            ))}
          </select>
          {target === "new" && (
            <input
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="Course name"
              className="field h-9 py-0 w-64"
              aria-label="New course name"
            />
          )}
        </div>
      </Panel>

      <div className="space-y-4">
        {plans.map((plan, i) => (
          <SheetCard
            key={plan.sheetName + i}
            sheet={sheets[i]}
            plan={plan}
            onChange={(next) =>
              setPlans((ps) => ps.map((p, j) => (j === i ? next : p)))
            }
          />
        ))}
      </div>
    </>
  );
}

/* ========================================================================== */

function SheetCard({
  sheet,
  plan,
  onChange,
}: {
  sheet: ParsedSheet;
  plan: SheetPlan;
  onChange: (next: SheetPlan) => void;
}) {
  const set = <K extends keyof SheetPlan>(key: K, value: SheetPlan[K]) =>
    onChange({ ...plan, [key]: value });

  const dataRows = plan.skipFirstRow ? sheet.rows.slice(1) : sheet.rows;
  const preview = dataRows.slice(0, 3);
  const cellAt = (row: string[], idx: number) =>
    idx >= 0 && idx < row.length ? row[idx] : "";

  const columnOptions = sheet.headers.map((h, i) => ({ value: i, label: h }));

  return (
    <Panel className={cx("overflow-hidden", !plan.include && "opacity-55")}>
      <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--border)]">
        <input
          type="checkbox"
          checked={plan.include}
          onChange={(e) => set("include", e.target.checked)}
          className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
          aria-label={`Include sheet ${sheet.sheetName}`}
        />
        <div className="grow min-w-0">
          <input
            value={plan.chapterName}
            onChange={(e) => set("chapterName", e.target.value)}
            className="bg-transparent font-medium text-sm w-full outline-none focus:text-[var(--accent)]"
            aria-label="Chapter name"
          />
          <p className="text-xs text-[var(--text-faint)] mt-0.5">
            from sheet “{sheet.sheetName}” · {dataRows.length} row
            {dataRows.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {plan.include && (
        <>
          <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 border-b border-[var(--border)]">
            <ColumnSelect
              label="Front"
              value={plan.frontColumn}
              onChange={(v) => set("frontColumn", v)}
              options={columnOptions}
            />
            <ColumnSelect
              label="Back"
              value={plan.backColumn}
              onChange={(v) => set("backColumn", v)}
              options={columnOptions}
            />
            <ColumnSelect
              label="Hint"
              value={plan.hintColumn}
              onChange={(v) => set("hintColumn", v)}
              options={columnOptions}
              optional
            />
            <ColumnSelect
              label="Notes"
              value={plan.notesColumn}
              onChange={(v) => set("notesColumn", v)}
              options={columnOptions}
              optional
            />
            <ColumnSelect
              label="Tags"
              value={plan.tagsColumn}
              onChange={(v) => set("tagsColumn", v)}
              options={columnOptions}
              optional
            />
          </div>

          <div className="px-4 py-2.5 border-b border-[var(--border)]">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={plan.skipFirstRow}
                onChange={(e) => set("skipFirstRow", e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--accent)]"
              />
              First row is a header (skip it)
            </label>
          </div>

          <div className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
              Preview
            </p>
            {preview.length === 0 ? (
              <p className="text-sm text-[var(--text-faint)] italic">
                No rows to import.
              </p>
            ) : (
              <div className="space-y-1.5">
                {preview.map((row, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 text-[13px] py-1.5 px-2.5 rounded-lg bg-[var(--surface-2)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {cellAt(row, plan.frontColumn) || (
                        <span className="text-[var(--again)] italic">empty</span>
                      )}
                    </span>
                    <Icon
                      name="chevronRight"
                      className="w-3.5 h-3.5 text-[var(--text-faint)] mt-0.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                      {cellAt(row, plan.backColumn) || (
                        <span className="text-[var(--again)] italic">empty</span>
                      )}
                    </span>
                  </div>
                ))}
                {dataRows.length > 3 && (
                  <p className="text-xs text-[var(--text-faint)] pl-2.5 pt-1">
                    …and {dataRows.length - 3} more
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function ColumnSelect({
  label,
  value,
  onChange,
  options,
  optional,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="field h-8 py-0 text-[13px]"
      >
        {optional && <option value={-1}>— none —</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
