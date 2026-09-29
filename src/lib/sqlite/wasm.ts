import type { SqliteDb, SqlStatement } from "./types";

/**
 * Browser / Android adapter, backed by the official `@sqlite.org/sqlite-wasm`
 * build — the same SQLite, compiled to WebAssembly, with FTS5 included so
 * search behaves identically to the server.
 *
 * The database lives in memory and is written out as a single file by the
 * caller (see `persist`). That sounds fragile but is the right trade here: a
 * personal collection is a few megabytes, every query stays synchronous, and
 * persistence becomes one durable file write instead of a bridge hop per
 * statement.
 */

// The sqlite-wasm typings are loose; these are the pieces we rely on.
interface OoStatement {
  bind(values: unknown): OoStatement;
  step(): boolean;
  get(target: Record<string, unknown>): Record<string, unknown>;
  finalize(): void;
  reset(clearBindings?: boolean): OoStatement;
}
interface OoDb {
  readonly pointer: number;
  exec(opts: string | Record<string, unknown>): unknown;
  prepare(sql: string): OoStatement;
  selectValue(sql: string): unknown;
  changes(): number;
  close(): void;
}
interface Sqlite3 {
  oo1: { DB: new (filename: string, flags?: string) => OoDb };
  capi: {
    sqlite3_js_db_export(db: OoDb): Uint8Array;
    sqlite3_deserialize(
      db: number,
      schema: string,
      data: number,
      size: number,
      bufferSize: number,
      flags: number,
    ): number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_RESIZEABLE: number;
  };
  wasm: { allocFromTypedArray(bytes: Uint8Array): number };
}

let sqlite3: Sqlite3 | null = null;

/**
 * Where the SQLite module is loaded from at runtime.
 *
 * It is fetched as a static asset rather than bundled. The package spawns a
 * Worker from a URL it builds at runtime — for an OPFS proxy this app does not
 * use — and no bundler can prove that path is dead, so bundling it fails.
 * Copying `dist/` into public/sqlite and importing by URL sidesteps the
 * analysis entirely, and keeps the .wasm next to the .mjs that looks for it.
 */
const DEFAULT_MODULE_URL = "/sqlite/index.mjs";

/** Load the WASM module once. The only await in the whole data layer. */
export async function initWasmSqlite(moduleUrl = DEFAULT_MODULE_URL): Promise<void> {
  if (sqlite3) return;
  const mod = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ moduleUrl
  )) as { default: (o?: unknown) => Promise<Sqlite3> };
  sqlite3 = await mod.default({ print: () => {}, printErr: () => {} });
}

/**
 * better-sqlite3 takes named parameters as bare keys (`{ id }` for `@id`).
 * SQLite's C API wants the sigil included. Translating here keeps every call
 * site in `repo.ts` untouched.
 */
function bindable(params: unknown[]): unknown {
  if (params.length === 1 && isPlainObject(params[0])) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params[0] as object)) {
      out[key.startsWith("@") || key.startsWith("$") || key.startsWith(":") ? key : `@${key}`] =
        normalise(value);
    }
    return out;
  }
  return params.map(normalise);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);

/** SQLite has no boolean type; better-sqlite3 rejects them, we coerce. */
function normalise(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

class WasmDb implements SqliteDb {
  private depth = 0;
  private readonly db: OoDb;

  constructor(db: OoDb) {
    this.db = db;
  }

  prepare(sql: string): SqlStatement {
    const db = this.db;
    return {
      run(...params: unknown[]) {
        const stmt = db.prepare(sql);
        try {
          if (params.length) stmt.bind(bindable(params));
          stmt.step();
        } finally {
          stmt.finalize();
        }
        return { changes: db.changes() };
      },
      get(...params: unknown[]) {
        const stmt = db.prepare(sql);
        try {
          if (params.length) stmt.bind(bindable(params));
          return stmt.step() ? stmt.get({}) : undefined;
        } finally {
          stmt.finalize();
        }
      },
      all(...params: unknown[]) {
        const stmt = db.prepare(sql);
        const rows: unknown[] = [];
        try {
          if (params.length) stmt.bind(bindable(params));
          while (stmt.step()) rows.push(stmt.get({}));
        } finally {
          stmt.finalize();
        }
        return rows;
      },
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    // Setting form: `pragma("user_version = 3")`.
    if (source.includes("=")) {
      this.db.exec(`PRAGMA ${source}`);
      return undefined;
    }
    const value = this.db.selectValue(`PRAGMA ${source}`);
    return options?.simple ? value : [{ [source]: value }];
  }

  /**
   * Nested calls become savepoints. `backup.ts` restores each table in its own
   * transaction inside one outer transaction, and without this the inner
   * COMMIT would end the outer one early and leave a half-applied restore.
   */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    const self = this;
    return function (this: unknown, ...args: never[]) {
      const nested = self.depth > 0;
      const name = `sp${self.depth}`;
      self.depth++;
      self.db.exec(nested ? `SAVEPOINT ${name}` : "BEGIN");
      try {
        const result = fn.apply(this, args);
        self.db.exec(nested ? `RELEASE ${name}` : "COMMIT");
        return result;
      } catch (err) {
        try {
          self.db.exec(nested ? `ROLLBACK TO ${name}` : "ROLLBACK");
        } catch {
          /* the outer handler reports the original failure */
        }
        throw err;
      } finally {
        self.depth--;
      }
    } as T;
  }

  close(): void {
    this.db.close();
  }

  /** Serialise the whole database so the caller can write it to a file. */
  export(): Uint8Array {
    return sqlite3!.capi.sqlite3_js_db_export(this.db);
  }
}

/**
 * Open a database, optionally seeded from previously persisted bytes.
 * `initWasmSqlite()` must have resolved first.
 */
export function openWasmDatabase(existing?: Uint8Array | null): SqliteDb & {
  export(): Uint8Array;
} {
  if (!sqlite3) throw new Error("initWasmSqlite() must be awaited before opening.");

  const db = new sqlite3.oo1.DB(":memory:", "c");

  if (existing && existing.length > 0) {
    // Hand the saved bytes straight to SQLite. FREEONCLOSE lets SQLite own the
    // allocation, RESIZEABLE lets the database grow afterwards — without it the
    // first write past the restored size fails.
    const ptr = sqlite3.wasm.allocFromTypedArray(existing);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      "main",
      ptr,
      existing.length,
      existing.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (rc !== 0) {
      throw new Error(`Could not open the saved database (SQLite code ${rc}).`);
    }

    // sqlite3_deserialize validates lazily: it returns OK for bytes that are
    // not a database at all, and only fails later on a real query. Forcing a
    // read of the schema here turns "silently broken app" into a clear error
    // at open time, which is the difference between recovering from a backup
    // and not knowing anything is wrong.
    try {
      db.exec("SELECT count(*) FROM sqlite_schema");
    } catch {
      db.close();
      throw new Error(
        "The saved database is corrupt or truncated. Restore from a .fcbackup.",
      );
    }
  }

  const wrapped = new WasmDb(db);
  wrapped.exec("PRAGMA foreign_keys = ON");
  return wrapped as SqliteDb & { export(): Uint8Array };
}
