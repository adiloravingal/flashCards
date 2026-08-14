/**
 * Database schema, expressed as an ordered list of migrations.
 *
 * Rules for future edits:
 *   - NEVER modify an existing migration once it has shipped. Append a new one.
 *   - Each migration runs exactly once, inside a transaction, in array order.
 *   - `user_version` in SQLite tracks how many have been applied.
 */

export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_core",
    sql: /* sql */ `
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE courses (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        emoji       TEXT NOT NULL DEFAULT '',
        color       TEXT NOT NULL DEFAULT 'violet',
        position    INTEGER NOT NULL DEFAULT 0,
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE chapters (
        id          TEXT PRIMARY KEY,
        course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position    INTEGER NOT NULL DEFAULT 0,
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_chapters_course ON chapters(course_id, position);

      CREATE TABLE cards (
        id          TEXT PRIMARY KEY,
        chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        front       TEXT NOT NULL DEFAULT '',
        back        TEXT NOT NULL DEFAULT '',
        hint        TEXT NOT NULL DEFAULT '',
        notes       TEXT NOT NULL DEFAULT '',
        tags        TEXT NOT NULL DEFAULT '[]',
        starred     INTEGER NOT NULL DEFAULT 0,
        suspended   INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL DEFAULT 'manual',
        position    INTEGER NOT NULL DEFAULT 0,

        -- FSRS scheduling state (kept inline so "reset progress" is one UPDATE)
        due            INTEGER NOT NULL,
        stability      REAL    NOT NULL DEFAULT 0,
        difficulty     REAL    NOT NULL DEFAULT 0,
        elapsed_days   REAL    NOT NULL DEFAULT 0,
        scheduled_days REAL    NOT NULL DEFAULT 0,
        learning_steps INTEGER NOT NULL DEFAULT 0,
        reps           INTEGER NOT NULL DEFAULT 0,
        lapses         INTEGER NOT NULL DEFAULT 0,
        state          INTEGER NOT NULL DEFAULT 0,
        last_review    INTEGER,

        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_cards_chapter ON cards(chapter_id, position);
      CREATE INDEX idx_cards_due     ON cards(due) WHERE suspended = 0;
      CREATE INDEX idx_cards_state   ON cards(state);

      CREATE TABLE media (
        id            TEXT PRIMARY KEY,
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime          TEXT NOT NULL,
        kind          TEXT NOT NULL,
        size          INTEGER NOT NULL,
        sha256        TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_media_sha ON media(sha256);

      CREATE TABLE card_media (
        id       TEXT PRIMARY KEY,
        card_id  TEXT NOT NULL REFERENCES cards(id)  ON DELETE CASCADE,
        media_id TEXT NOT NULL REFERENCES media(id)  ON DELETE CASCADE,
        side     TEXT NOT NULL DEFAULT 'front',
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_card_media_card ON card_media(card_id, side, position);

      -- One row per answered card. Never deleted: this is the study history and
      -- what makes "undo" and the stats screens possible.
      CREATE TABLE review_log (
        id                TEXT PRIMARY KEY,
        card_id           TEXT NOT NULL,
        reviewed_at       INTEGER NOT NULL,
        rating            INTEGER NOT NULL,
        duration_ms       INTEGER NOT NULL DEFAULT 0,
        session_id        TEXT,
        -- snapshot of the card BEFORE the answer, so undo is a pure restore
        prev_due            INTEGER NOT NULL,
        prev_stability      REAL    NOT NULL,
        prev_difficulty     REAL    NOT NULL,
        prev_elapsed_days   REAL    NOT NULL,
        prev_scheduled_days REAL    NOT NULL,
        prev_learning_steps INTEGER NOT NULL,
        prev_reps           INTEGER NOT NULL,
        prev_lapses         INTEGER NOT NULL,
        prev_state          INTEGER NOT NULL,
        prev_last_review    INTEGER,
        undone            INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_review_log_card ON review_log(card_id, reviewed_at);
      CREATE INDEX idx_review_log_time ON review_log(reviewed_at);

      -- Append-only audit trail of everything that changes data, whoever did it.
      CREATE TABLE event_log (
        id          TEXT PRIMARY KEY,
        ts          INTEGER NOT NULL,
        level       TEXT NOT NULL DEFAULT 'info',
        actor       TEXT NOT NULL DEFAULT 'you',
        action      TEXT NOT NULL,
        entity_type TEXT,
        entity_id   TEXT,
        summary     TEXT NOT NULL DEFAULT '',
        meta        TEXT NOT NULL DEFAULT '{}',
        ip          TEXT
      );
      CREATE INDEX idx_event_log_ts    ON event_log(ts);
      CREATE INDEX idx_event_log_actor ON event_log(actor, ts);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    name: "002_search",
    sql: /* sql */ `
      CREATE VIRTUAL TABLE cards_fts USING fts5(
        front, back, hint, notes, tags,
        content='cards',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
        INSERT INTO cards_fts(rowid, front, back, hint, notes, tags)
        VALUES (new.rowid, new.front, new.back, new.hint, new.notes, new.tags);
      END;

      CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, front, back, hint, notes, tags)
        VALUES ('delete', old.rowid, old.front, old.back, old.hint, old.notes, old.tags);
      END;

      CREATE TRIGGER cards_fts_au AFTER UPDATE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, front, back, hint, notes, tags)
        VALUES ('delete', old.rowid, old.front, old.back, old.hint, old.notes, old.tags);
        INSERT INTO cards_fts(rowid, front, back, hint, notes, tags)
        VALUES (new.rowid, new.front, new.back, new.hint, new.notes, new.tags);
      END;
    `,
  },
  {
    name: "003_daily_stats",
    sql: /* sql */ `
      -- Denormalised per-day counters. Cheap to read for the streak/heatmap,
      -- and reconstructible from review_log if it ever drifts.
      CREATE TABLE daily_stats (
        day        TEXT PRIMARY KEY,   -- local YYYY-MM-DD
        reviews    INTEGER NOT NULL DEFAULT 0,
        again      INTEGER NOT NULL DEFAULT 0,
        hard       INTEGER NOT NULL DEFAULT 0,
        good       INTEGER NOT NULL DEFAULT 0,
        easy       INTEGER NOT NULL DEFAULT 0,
        new_cards  INTEGER NOT NULL DEFAULT 0,
        ms_spent   INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    name: "004_cloze",
    sql: /* sql */ `
      -- A "note" is the thing you author; a "card" is one thing you get asked.
      -- Basic notes make one card. A cloze note makes one card per deletion,
      -- each with its own independent schedule — forgetting c2 shouldn't drag
      -- c1 back down with it.
      ALTER TABLE cards ADD COLUMN card_type   TEXT NOT NULL DEFAULT 'basic';
      ALTER TABLE cards ADD COLUMN note_id     TEXT NOT NULL DEFAULT '';
      ALTER TABLE cards ADD COLUMN cloze_index INTEGER;

      UPDATE cards SET note_id = id WHERE note_id = '';

      CREATE INDEX idx_cards_note ON cards(note_id, cloze_index);
    `,
  },
];
