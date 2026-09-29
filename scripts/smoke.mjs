#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 *   npm run smoke            # against http://localhost:3939
 *   FC_URL=… npm run smoke   # against somewhere else
 *
 * Talks to the running server exactly the way an external AI agent would:
 * over HTTP, with a bearer key, using no internal imports. It creates a
 * throwaway course prefixed "SMOKE " and deletes it on the way out, so it is
 * safe to run against a collection you care about.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { zipSync } from "fflate";
import { zstdCompressSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.FC_URL ?? "http://localhost:3939") + "/api/v1";

const KEY = (() => {
  if (process.env.FC_AGENT_KEY) return process.env.FC_AGENT_KEY.trim();
  const p = path.join(ROOT, "data", "agent-key.txt");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  console.error("No API key. Set FC_AGENT_KEY or start the app once.");
  process.exit(2);
})();

const H = { Authorization: `Bearer ${KEY}` };
const HJ = { ...H, "Content-Type": "application/json" };

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  \x1b[32m✓\x1b[0m", name);
  } else {
    fail++;
    failures.push(name);
    console.log("  \x1b[31m✗\x1b[0m", name);
    if (detail !== undefined) {
      console.log("      ", JSON.stringify(detail)?.slice(0, 300));
    }
  }
}
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const req = async (p, opts = {}) => {
  const res = await fetch(BASE + p, {
    method: opts.method ?? "GET",
    headers: opts.json ? HJ : H,
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = async (p) => (await req(p)).body?.data;

const upload = async (p, name, bytes) => {
  const fd = new FormData();
  fd.append("file", new File([bytes], name));
  const res = await fetch(BASE + p, { method: "POST", headers: H, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/* ========================================================================== */

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

/** Build a modern (.anki21b + zstd + protobuf) package in memory. */
function buildApkg() {
  const tmp = path.join(ROOT, "data", `.smoke-${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.rmSync(tmp, { force: true });

  const db = new Database(tmp);
  db.exec(`
    CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer,
      ver integer, dty integer, usn integer, ls integer, conf text, models text,
      decks text, dconf text, tags text);
    CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer,
      usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
    CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer,
      mod integer, usn integer, type integer, queue integer, due integer, ivl integer,
      factor integer, reps integer, lapses integer, left integer, odue integer,
      odid integer, flags integer, data text);
    CREATE TABLE decks (id integer primary key, name text, mtime_secs integer, usn integer);
  `);
  db.prepare("INSERT INTO col VALUES (1,0,0,0,18,0,0,0,'{}','','','{}','')").run();
  db.prepare("INSERT INTO decks VALUES (9001,?,0,0)").run("SMOKE Anki\x1fUnit 1");

  const notes = [
    ["<b>bonjour</b><br>casual", "hello &amp; hi", "greetings"],
    ["Gold is {{c1::Au}}, iron is {{c2::Fe}}.", "Periodic table.", ""],
    ['Picture: <img src="p.png">', "a pixel", ""],
  ];
  const insN = db.prepare("INSERT INTO notes VALUES (?,?,1,0,0,?,?,?,0,0,'')");
  const insC = db.prepare(
    "INSERT INTO cards VALUES (?,?,9001,0,0,0,0,0,0,0,2500,0,0,0,0,0,0,'')",
  );
  notes.forEach(([f, b, tags], i) => {
    insN.run(5000 + i, `g${i}`, tags ? ` ${tags} ` : "", `${f}\x1f${b}`, f);
    insC.run(6000 + i, 5000 + i);
  });
  db.close();

  const collection = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });

  // MediaEntries{ entries=1 : MediaEntry{ name=1, size=2 } }
  const varint = (n) => {
    const o = [];
    while (n > 127) {
      o.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    o.push(n);
    return Buffer.from(o);
  };
  const nb = Buffer.from("p.png");
  const inner = Buffer.concat([
    Buffer.from([0x0a]), varint(nb.length), nb,
    Buffer.from([0x10]), varint(PNG.length),
  ]);
  const manifest = Buffer.concat([Buffer.from([0x0a]), varint(inner.length), inner]);

  return Buffer.from(
    zipSync({
      "collection.anki21b": new Uint8Array(zstdCompressSync(collection)),
      media: new Uint8Array(manifest),
      0: new Uint8Array(zstdCompressSync(PNG)),
    }),
  );
}

/** Minimal .xlsx via a spreadsheet the importer must column-detect. */
async function buildXlsx() {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet("Chapter One");
  s1.addRow(["Term", "Definition", "Tags"]);
  s1.addRow(["alpha", "first letter", "greek"]);
  s1.addRow(["beta", "second letter", "greek"]);
  const s2 = wb.addWorksheet("No Headers");
  s2.addRow(["uno", "one"]);
  s2.addRow(["dos", "two"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ========================================================================== */

const createdCourses = new Set();

async function main() {
  section("Auth");
  {
    const bad = await fetch(BASE + "/courses", {
      headers: { Authorization: "Bearer nope" },
    });
    ok("rejects a wrong key", bad.status === 401, bad.status);
    ok("accepts the real key", (await req("/courses")).status === 200);
  }

  section("Agent card creation");
  let chapterId;
  {
    const dry = await req("/cards", {
      method: "POST",
      json: {
        courseName: "SMOKE Basics",
        chapterName: "Unit 1",
        dryRun: true,
        cards: [{ front: "Q1", back: "A1" }],
      },
    });
    ok("dryRun reports without writing", dry.body?.data?.wouldCreate === 1, dry.body);
    ok(
      "dryRun really wrote nothing",
      !(await get("/courses")).some((c) => c.name === "SMOKE Basics"),
    );

    const real = await req("/cards", {
      method: "POST",
      json: {
        courseName: "SMOKE Basics",
        chapterName: "Unit 1",
        cards: [
          { front: "Q1", back: "A1", tags: ["smoke"] },
          { front: "Q2", back: "A2" },
        ],
      },
    });
    ok("creates cards and their course", real.body?.data?.created === 2, real.body);
    chapterId = real.body.data.chapterId;
    createdCourses.add("SMOKE Basics");

    const dupe = await req("/cards", {
      method: "POST",
      json: { chapterId, cards: [{ front: "Q1", back: "dup" }, { front: "Q3", back: "A3" }] },
    });
    ok("dedupes an existing front", dupe.body?.data?.skipped?.length === 1, dupe.body?.data);
    ok("still adds the new one", dupe.body?.data?.created === 1);

    const bad = await req("/cards", { method: "POST", json: { chapterId, cards: [{ front: 1 }] } });
    ok("rejects malformed input with 400", bad.status === 400, bad.status);
    ok("names the bad field", JSON.stringify(bad.body).includes("front"));
  }

  section("Review loop");
  {
    const q = await get(`/review/queue?chapterId=${chapterId}`);
    ok("queue returns cards", q.cards.length === 3, q.cards.length);
    ok("cards carry interval previews", !!q.cards[0]?.preview?.["3"]);

    const card = q.cards[0];
    const a = await req("/review/answer", {
      method: "POST",
      // Deliberately fractional: timers produce floats.
      json: { cardId: card.id, rating: 3, durationMs: 1234.56, sessionId: q.sessionId },
    });
    ok("accepts a fractional duration", a.status === 200, a.body);
    ok("card leaves the New state", a.body.data.card.state !== 0);
    ok("next due is in the future", a.body.data.nextDue > Date.now());

    const u = await req("/review/undo", { method: "POST", json: { sessionId: q.sessionId } });
    ok("undo restores it exactly", u.body?.data?.state === 0 && u.body?.data?.reps === 0, u.body?.data);

    const before = await get(`/cards/${card.id}`);
    await req("/review/answer", { method: "POST", json: { cardId: card.id, rating: 4, cram: true } });
    const after = await get(`/cards/${card.id}`);
    ok("cram leaves the schedule alone", before.due === after.due && before.reps === after.reps);
  }

  section("Cloze");
  {
    const r = await req("/cards", {
      method: "POST",
      json: {
        chapterId,
        dedupe: false,
        cards: [{ front: "{{c1::Paris}} is in {{c2::France}}.", back: "Geography" }],
      },
    });
    ok("one note becomes one card per deletion", r.body?.data?.created === 2, r.body?.data);
    const siblings = r.body.data.cards;
    ok("siblings share a note", siblings[0].note_id === siblings[1].note_id);
    ok("indices are 1 and 2", siblings.map((c) => c.cloze_index).join() === "1,2");

    await req("/review/answer", { method: "POST", json: { cardId: siblings[1].id, rating: 3 } });
    await req(`/cards/${siblings[0].id}`, {
      method: "PATCH",
      json: { front: "{{c1::Paris}} is in {{c2::France}}, in {{c3::Europe}}." },
    });
    const c2 = await get(`/cards/${siblings[1].id}`);
    ok("editing keeps a sibling's history", c2?.reps === 1, c2?.reps);
    ok("editing propagates the new text", c2?.front.includes("Europe"));

    const all = (await get(`/cards?chapterId=${chapterId}&limit=100`)).cards.filter(
      (c) => c.note_id === siblings[0].note_id,
    );
    ok("adding a deletion adds a card", all.length === 3, all.map((c) => c.cloze_index));
    ok("the new card starts unseen", all.find((c) => c.cloze_index === 3)?.reps === 0);
  }

  section("Spreadsheet import");
  {
    const xlsx = await buildXlsx();
    const a = await upload("/import/analyze", "smoke.xlsx", xlsx);
    ok("analyses the workbook", a.status === 200, a.body);
    const sheets = a.body.data.sheets;
    ok("finds both sheets", sheets.length === 2, sheets.map((s) => s.sheetName));
    ok("detects the header row", sheets[0].guess.skipFirstRow === true);
    ok("maps Term/Definition", sheets[0].guess.frontColumn === 0 && sheets[0].guess.backColumn === 1);
    ok("maps the Tags column", sheets[0].guess.tagsColumn === 2);
    ok("does NOT eat row 1 of a headerless sheet", sheets[1].guess.skipFirstRow === false);

    const plans = sheets.map((s) => ({
      sheetName: s.sheetName,
      chapterName: s.sheetName,
      include: true,
      ...s.guess,
      rows: s.rows,
    }));
    const c = await req("/import/commit", {
      method: "POST",
      json: { newCourseName: "SMOKE Sheet", sheets: plans },
    });
    ok("imports every row", c.body?.data?.created === 4, c.body?.data);
    createdCourses.add("SMOKE Sheet");

    const cards = (await get(`/cards?courseId=${c.body.data.courseId}&limit=50`)).cards;
    ok("tags split on commas", cards.find((x) => x.front === "alpha")?.tags.includes("greek"));
    ok("headerless rows survive", !!cards.find((x) => x.front === "uno"));
  }

  section("Anki import");
  {
    const a = await upload("/import/anki/analyze", "smoke.apkg", buildApkg());
    ok("reads a modern .apkg", a.status === 200, a.body);
    const d = a.body.data;
    ok("uses the zstd collection", d.schema === "collection.anki21b", d.schema);
    ok("finds the notes", d.totalNotes === 3, d.totalNotes);
    ok("finds the media", d.mediaCount === 1, d.mediaCount);
    ok("splits deck into course + chapter", d.decks[0].course === "SMOKE Anki" && d.decks[0].chapter === "Unit 1", d.decks[0]);
    ok("counts cloze notes", d.decks[0].clozeNotes === 1, d.decks[0].clozeNotes);

    const c = await req("/import/anki/commit", {
      method: "POST",
      json: {
        stagingId: d.stagingId,
        decks: d.decks.map((x) => ({ name: x.name, include: true, course: x.course, chapter: x.chapter })),
      },
    });
    ok("commits the deck", c.status === 201, c.body);
    ok("cloze note expanded (3 notes -> 4 cards)", c.body.data.cardsCreated === 4, c.body.data);
    ok("media came across", c.body.data.mediaImported === 1 && c.body.data.mediaFailures === 0, c.body.data);
    createdCourses.add("SMOKE Anki");

    const cards = (await get(`/cards?courseId=${c.body.data.courseId}&limit=50`)).cards;
    const fr = cards.find((x) => x.front.startsWith("bonjour"));
    ok("HTML flattened", fr && !fr.front.includes("<b>"), fr?.front);
    ok("<br> became a newline", fr?.front === "bonjour\ncasual", JSON.stringify(fr?.front));
    ok("entities decoded", fr?.back === "hello & hi", fr?.back);
    ok("tags preserved", fr?.tags.includes("greetings"), fr?.tags);
    ok("Anki cloze stayed cloze", cards.filter((x) => x.card_type === "cloze").length === 2);
    const withImg = cards.find((x) => x.media.length > 0);
    ok("image attached to the front", withImg?.media[0]?.side === "front" && withImg?.media[0]?.kind === "image", withImg?.media);
    ok("<img> stripped from the text", !withImg?.front.includes("<img"));
  }

  section("Deck sharing");
  {
    const courses = await get("/courses");
    const source = courses.find((c) => c.name === "SMOKE Basics");

    const res = await fetch(`${BASE}/export/deck?courseId=${source.id}`, { headers: H });
    ok("exports a .fcdeck", res.status === 200 && res.headers.get("content-type") === "application/zip", res.status);
    ok("suggests a filename", /\.fcdeck"/.test(res.headers.get("content-disposition") ?? ""), res.headers.get("content-disposition"));

    const bytes = Buffer.from(await res.arrayBuffer());
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(bytes));
    ok("archive holds deck.json", !!entries["deck.json"], Object.keys(entries));

    const manifest = JSON.parse(new TextDecoder().decode(entries["deck.json"]));
    ok("tagged with the deck format", manifest.format === "flashcards.io/deck", manifest.format);
    ok("carries no scheduling state", !JSON.stringify(manifest).includes("stability"));
    ok("cloze stored once as a note", manifest.chapters.some((c) => c.cards.some((x) => x.cardType === "cloze")), manifest.chapters);

    const fd = new FormData();
    fd.append("file", new File([bytes], "smoke.fcdeck"));
    const analysed = await fetch(`${BASE}/import/deck/analyze`, { method: "POST", headers: H, body: fd })
      .then((r) => r.json());
    ok("analyses the deck", analysed.ok === true, analysed);
    ok("counts cards after cloze expansion", analysed.data.totalCards >= analysed.data.totalNotes, analysed.data);
    ok("warns about the existing course name", analysed.data.existingCourse?.name === "SMOKE Basics", analysed.data.existingCourse);

    const dry = await req("/import/deck/commit", {
      method: "POST",
      json: { stagingId: analysed.data.stagingId, courseName: "SMOKE Shared", dryRun: true },
    });
    ok("dry run writes nothing", !(await get("/courses")).some((c) => c.name === "SMOKE Shared"));

    const committed = await req("/import/deck/commit", {
      method: "POST",
      json: { stagingId: analysed.data.stagingId, courseName: "SMOKE Shared" },
    });
    ok("commits the deck", committed.status === 201, committed.body);
    ok("creates exactly what the preview promised",
      committed.body.data.cardsCreated === dry.body.data.wouldCreateCards,
      { promised: dry.body.data.wouldCreateCards, created: committed.body.data.cardsCreated });
    createdCourses.add("SMOKE Shared");

    const copied = (await get(`/cards?courseId=${committed.body.data.courseId}&limit=100`)).cards;
    ok("imported cards start unseen", copied.every((c) => c.reps === 0 && c.state === 0));
    ok("cloze siblings rebuilt", copied.filter((c) => c.card_type === "cloze").length >= 2);

    const stale = await req("/import/deck/commit", {
      method: "POST",
      json: { stagingId: "00000000-0000-4000-8000-000000000000", courseName: "x" },
    });
    ok("expired staging id is a clean 404", stale.status === 404, stale.status);
  }

  section("Progress periods");
  {
    const day = await get("/stats/period?unit=day&offset=0");
    ok("day has 24 hourly buckets", day.buckets.length === 24, day.buckets.length);
    ok("day is labelled Today", day.label === "Today", day.label);
    ok("cannot step past the current period", day.isCurrent === true);
    ok("buckets sum to the day total",
      day.buckets.reduce((n, b) => n + b.reviews, 0) === day.totals.reviews,
      { sum: day.buckets.reduce((n, b) => n + b.reviews, 0), total: day.totals.reviews });
    ok("exactly one bucket is the current hour", day.buckets.filter((b) => b.current).length === 1);

    const week = await get("/stats/period?unit=week&offset=0");
    ok("week has 7 buckets", week.buckets.length === 7, week.buckets.length);
    ok("week totals include today's reviews", week.totals.reviews >= day.totals.reviews, { week: week.totals.reviews, day: day.totals.reviews });

    const month = await get("/stats/period?unit=month&offset=0");
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    ok("month has one bucket per day", month.buckets.length === daysInMonth, month.buckets.length);
    ok("month thins its axis labels", month.buckets.filter((b) => b.showLabel).length < month.buckets.length);

    ok("previous period is reported for comparison", typeof week.previous?.reviews === "number", week.previous);
    ok("recall is null or a ratio", day.totals.recall === null || (day.totals.recall >= 0 && day.totals.recall <= 1), day.totals.recall);

    const far = await get("/stats/period?unit=day&offset=700");
    ok("far past is empty, not an error", far.totals.reviews === 0 && far.buckets.length === 24);
    ok("far past knows there is nothing earlier", far.hasEarlier === false, far.hasEarlier);
    const clamped = await get("/stats/period?unit=day&offset=99999");
    ok("absurd offset is clamped", clamped.buckets.length === 24);
    ok("unknown unit falls back to day", (await get("/stats/period?unit=decade")).unit === "day");
  }

  section("Search, stats, logs, export");
  {
    const s = await get("/search?q=alph");
    ok("prefix search works", s.results.length >= 1, s.results.length);
    ok("results carry breadcrumbs", !!s.results[0]?.courseName);
    ok("a malformed query doesn't 500", (await req(`/search?q=${encodeURIComponent('"))*')}`)).status === 200);

    const st = await get("/stats");
    ok("stats returns a 14-day forecast", st.forecast?.length === 14);
    ok("logs attribute agent writes", (await get("/logs?actor=agent")).some((l) => l.actor === "agent"));
    ok("import writes are attributed", (await get("/logs?actor=import")).length > 0);

    const spec = await get("/spec");
    ok("spec documents cloze", JSON.stringify(spec.cardTypes ?? {}).includes("cloze"));
    ok("spec lists the anki endpoints", JSON.stringify(spec.endpoints).includes("/import/anki/commit"));
    ok("spec lists deck sharing", JSON.stringify(spec.endpoints).includes("/export/deck"));
    ok("spec lists the period endpoint", JSON.stringify(spec.endpoints).includes("/stats/period"));
    ok("spec lists device backup", JSON.stringify(spec.endpoints).includes("/backup/restore"));

    const res = await fetch(BASE + "/export", { headers: H });
    const dump = await res.json();
    ok("export contains the tree", dump.courses?.some((c) => c.chapters?.[0]?.cards?.length > 0));
  }

  section("Device backup");
  {
    // Deliberately never exercises "replace" here: this suite runs against a
    // real collection, and a replace would wipe it. Merge is the safe mode and
    // still proves the round trip, because merging your own backup must be a
    // no-op.
    const res = await fetch(`${BASE}/backup`, { headers: H });
    ok("exports a .fcbackup", res.status === 200 && res.headers.get("content-type") === "application/zip", res.status);
    ok("suggests a dated filename", /\.fcbackup"/.test(res.headers.get("content-disposition") ?? ""), res.headers.get("content-disposition"));

    const bytes = Buffer.from(await res.arrayBuffer());
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(bytes));
    ok("archive holds backup.json", !!entries["backup.json"], Object.keys(entries).slice(0, 5));

    const meta = JSON.parse(new TextDecoder().decode(entries["backup.json"]));
    ok("tagged with the backup format", meta.format === "flashcards.io/backup", meta.format);
    ok("keeps scheduling, unlike a deck", JSON.stringify(meta.tables.cards ?? []).includes("stability") || (meta.counts.cards ?? 0) === 0);
    ok("never contains the API key", !JSON.stringify(meta).includes(KEY) && !JSON.stringify(meta).includes("agent_key"));
    ok("media file count is reported honestly",
      (meta.counts.mediaFiles ?? 0) === Object.keys(entries).filter((k) => k.startsWith("media/")).length,
      { reported: meta.counts.mediaFiles, inZip: Object.keys(entries).filter((k) => k.startsWith("media/")).length });

    const fd = new FormData();
    fd.append("file", new File([bytes], "smoke.fcbackup"));
    const analysed = await fetch(`${BASE}/backup/analyze`, { method: "POST", headers: H, body: fd })
      .then((r) => r.json());
    ok("analyses the backup", analysed.ok === true, analysed);
    ok("reports what is already here", typeof analysed.data.current.cards === "number", analysed.data.current);
    ok("incoming count matches the export", analysed.data.incoming.cards === (meta.counts.cards ?? 0), {
      incoming: analysed.data.incoming.cards, exported: meta.counts.cards });

    const before = (await get("/health")).counts.total;
    await req("/backup/restore", { method: "POST", json: { stagingId: analysed.data.stagingId, mode: "merge", dryRun: true } });
    ok("dry run changes nothing", (await get("/health")).counts.total === before);

    const merged = await req("/backup/restore", { method: "POST", json: { stagingId: analysed.data.stagingId, mode: "merge" } });
    ok("merge restore succeeds", merged.status === 200, merged.body);
    ok("merging your own backup duplicates nothing", (await get("/health")).counts.total === before,
      { before, after: (await get("/health")).counts.total });
    ok("merge writes no safety copy (nothing destroyed)", merged.body.data.safetyBackup === null, merged.body.data.safetyBackup);

    const stale = await req("/backup/restore", {
      method: "POST",
      json: { stagingId: "00000000-0000-4000-8000-000000000000", mode: "merge" },
    });
    ok("expired staging id is a clean 404", stale.status === 404, stale.status);
  }

  section("Cleanup");
  {
    const courses = await get("/courses");
    let removed = 0;
    for (const c of courses) {
      if (createdCourses.has(c.name)) {
        await req(`/courses/${c.id}`, { method: "DELETE" });
        removed++;
      }
    }
    ok(`removed ${removed} smoke course(s)`, removed === createdCourses.size, {
      removed,
      expected: createdCourses.size,
    });
    const left = (await get("/courses")).filter((c) => c.name.startsWith("SMOKE "));
    ok("no smoke data left behind", left.length === 0, left.map((c) => c.name));

    // Deleting a course cascades to its cards, which leaves any file those
    // cards referenced attached to nothing. That is the app behaving correctly
    // — media is shared, so it is swept separately — but it means this run has
    // left a file behind. Say so rather than leaking silently.
    console.log(
      "\n  note: the Anki fixture's image is now unreferenced.\n" +
        "        Settings → Maintenance → Clean up unused files removes it,\n" +
        "        along with any other file no card is using.",
    );
  }

  const line = "=".repeat(46);
  console.log(`\n${line}`);
  if (fail === 0) {
    console.log(`\x1b[32mPASS ${pass}\x1b[0m   FAIL 0`);
  } else {
    console.log(`PASS ${pass}   \x1b[31mFAIL ${fail}\x1b[0m`);
    console.log("\nFailed:");
    for (const f of failures) console.log("  -", f);
  }
  console.log(line);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("\nSmoke run crashed:", err);
  process.exit(1);
});
