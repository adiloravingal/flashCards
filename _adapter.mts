import { initWasmSqlite, openWasmDatabase } from "./src/lib/sqlite/wasm.ts";
import { MIGRATIONS } from "./src/lib/schema.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => {
  c ? (pass++, console.log("  \x1b[32m✓\x1b[0m", n))
    : (fail++, console.log("  \x1b[31m✗\x1b[0m", n, "->", JSON.stringify(x)?.slice(0, 200)));
};

await initWasmSqlite();
let db = openWasmDatabase();

console.log("\n\x1b[1mREAL SCHEMA\x1b[0m");
for (let i = 0; i < MIGRATIONS.length; i++) {
  const m = MIGRATIONS[i];
  try {
    const run = db.transaction(() => { db.exec(m.sql); db.pragma(`user_version = ${i + 1}`); });
    run();
    ok(`migration ${m.name}`, true);
  } catch (e) { ok(`migration ${m.name}`, false, (e as Error).message); }
}
ok("user_version reads back", db.pragma("user_version", { simple: true }) === MIGRATIONS.length,
   db.pragma("user_version", { simple: true }));

console.log("\n\x1b[1mBINDING (as repo.ts does it)\x1b[0m");
const t = Date.now();
db.prepare(`INSERT INTO courses (id,name,description,emoji,color,position,archived,created_at,updated_at)
            VALUES (?,?,?,?,?,?,0,?,?)`).run("c1", "Physics", "", "", "violet", 0, t, t);
db.prepare(`INSERT INTO chapters (id,course_id,name,description,position,archived,created_at,updated_at)
            VALUES (?,?,?,?,?,0,?,?)`).run("ch1", "c1", "Mechanics", "", 0, t, t);
ok("positional params", (db.prepare("SELECT name FROM courses WHERE id=?").get("c1") as any)?.name === "Physics");

// createCards uses NAMED params (@id style) — the tricky path.
db.prepare(`INSERT INTO cards (id,chapter_id,front,back,hint,notes,tags,starred,suspended,source,position,
            due,stability,difficulty,elapsed_days,scheduled_days,learning_steps,reps,lapses,state,last_review,
            created_at,updated_at,card_type,note_id,cloze_index)
   VALUES (@id,@chapter_id,@front,@back,@hint,@notes,@tags,@starred,@suspended,@source,@position,
           @due,@stability,@difficulty,@elapsed_days,@scheduled_days,@learning_steps,@reps,@lapses,@state,@last_review,
           @created_at,@updated_at,@card_type,@note_id,@cloze_index)`).run({
  id: "k1", chapter_id: "ch1", front: "F = ?", back: "ma", hint: "", notes: "", tags: '["laws"]',
  starred: 0, suspended: 0, source: "manual", position: 0, due: t, stability: 0, difficulty: 0,
  elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0,
  last_review: null, created_at: t, updated_at: t, card_type: "basic", note_id: "k1", cloze_index: null,
});
ok("named @params bind correctly", (db.prepare("SELECT front FROM cards WHERE id=?").get("k1") as any)?.front === "F = ?");
ok("NULL round-trips", (db.prepare("SELECT last_review FROM cards WHERE id=?").get("k1") as any)?.last_review === null);
ok("booleans coerce to ints", (() => {
  db.prepare("UPDATE cards SET starred=? WHERE id=?").run(true as unknown as number, "k1");
  return (db.prepare("SELECT starred FROM cards WHERE id=?").get("k1") as any)?.starred === 1;
})());

console.log("\n\x1b[1m.changes AND all()\x1b[0m");
ok(".run() reports changes", db.prepare("UPDATE cards SET notes=? WHERE id=?").run("x", "k1").changes === 1);
ok(".run() reports 0 when nothing matched", db.prepare("UPDATE cards SET notes=? WHERE id=?").run("x", "nope").changes === 0);
ok(".all() returns rows", (db.prepare("SELECT * FROM cards").all() as unknown[]).length === 1);
ok(".get() returns undefined when empty", db.prepare("SELECT * FROM cards WHERE id=?").get("nope") === undefined);

console.log("\n\x1b[1mFTS5 TRIGGERS (search)\x1b[0m");
ok("trigger indexed the insert",
   (db.prepare(`SELECT COUNT(*) c FROM cards_fts WHERE cards_fts MATCH ?`).get('"ma"*') as any)?.c === 1);
db.prepare("UPDATE cards SET front=? WHERE id=?").run("chloroplast", "k1");
ok("trigger reindexed the update",
   (db.prepare(`SELECT COUNT(*) c FROM cards_fts WHERE cards_fts MATCH ?`).get('"chloro"*') as any)?.c === 1);

console.log("\n\x1b[1mTRANSACTIONS\x1b[0m");
ok("commits on success", (() => {
  db.transaction(() => { db.prepare("INSERT INTO courses VALUES (?,?,?,?,?,?,0,?,?)").run("c2","Chem","","","blue",1,t,t); })();
  return (db.prepare("SELECT COUNT(*) c FROM courses").get() as any).c === 2;
})());
ok("rolls back on throw", (() => {
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO courses VALUES (?,?,?,?,?,?,0,?,?)").run("c3","Bio","","","red",2,t,t);
      throw new Error("boom");
    })();
  } catch { /* expected */ }
  return (db.prepare("SELECT COUNT(*) c FROM courses").get() as any).c === 2;
})());
ok("NESTED transactions use savepoints (backup.ts relies on this)", (() => {
  db.transaction(() => {
    db.prepare("INSERT INTO courses VALUES (?,?,?,?,?,?,0,?,?)").run("c4","Outer","","","red",3,t,t);
    db.transaction(() => {
      db.prepare("INSERT INTO courses VALUES (?,?,?,?,?,?,0,?,?)").run("c5","Inner","","","red",4,t,t);
    })();
  })();
  return (db.prepare("SELECT COUNT(*) c FROM courses").get() as any).c === 4;
})(), db.prepare("SELECT COUNT(*) c FROM courses").get());
ok("inner rollback doesn't kill the outer", (() => {
  db.transaction(() => {
    db.prepare("INSERT INTO courses VALUES (?,?,?,?,?,?,0,?,?)").run("c6","Kept","","","red",5,t,t);
    try { db.transaction(() => { throw new Error("inner"); })(); } catch { /* swallowed */ }
  })();
  return !!db.prepare("SELECT id FROM courses WHERE id='c6'").get();
})());

console.log("\n\x1b[1mCASCADE + FOREIGN KEYS\x1b[0m");
ok("cascade delete works", (() => {
  db.prepare("DELETE FROM courses WHERE id='c1'").run();
  return (db.prepare("SELECT COUNT(*) c FROM cards").get() as any).c === 0;
})());

console.log("\n\x1b[1mPERSISTENCE\x1b[0m");
const bytes = (db as any).export();
ok("exports bytes", bytes.length > 0, bytes.length);
db.close();
const db2 = openWasmDatabase(bytes);
ok("reopens from bytes", (db2.prepare("SELECT COUNT(*) c FROM courses").get() as any).c === 4);
ok("schema version survives", db2.pragma("user_version", { simple: true }) === MIGRATIONS.length);
ok("writable after restore", (() => {
  db2.prepare("INSERT INTO courses VALUES (?,?,?,?,?,?,0,?,?)").run("c9","After","","","red",9,t,t);
  return (db2.prepare("SELECT COUNT(*) c FROM courses").get() as any).c === 5;
})());
ok("corrupt bytes fail loudly", (() => {
  try { openWasmDatabase(new Uint8Array([1,2,3,4,5,6,7,8])); return false; }
  catch { return true; }
})());

console.log(`\n${"=".repeat(48)}\n${fail ? "\x1b[31m" : "\x1b[32m"}PASS ${pass}   FAIL ${fail}\x1b[0m\n${"=".repeat(48)}`);
process.exit(fail ? 1 : 0);
