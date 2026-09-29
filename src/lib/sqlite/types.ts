/**
 * The slice of SQLite this app actually uses.
 *
 * Deliberately shaped like better-sqlite3's API rather than inventing a new
 * one: that keeps `repo.ts` — 1,200 lines of synchronous queries — completely
 * unchanged, and means the server adapter is a passthrough with no translation
 * layer to get wrong.
 *
 * Everything here is synchronous. That is the whole reason this app can run
 * unmodified on a phone: the WASM build of SQLite is synchronous too, so there
 * is no async refactor and no per-query bridge hop.
 */

export interface SqlRunResult {
  changes: number;
}

export interface SqlStatement {
  /** Positional (`?`) or named (`@foo`, passed as `{ foo }`) parameters. */
  run(...params: unknown[]): SqlRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDb {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  /**
   * `pragma("user_version", { simple: true })` reads a value;
   * `pragma("user_version = 3")` sets one.
   */
  pragma(source: string, options?: { simple?: boolean }): unknown;
  /**
   * Wraps `fn` so the whole thing commits or rolls back together. Nesting is
   * supported via savepoints, which `backup.ts` depends on — it runs a
   * per-table transaction inside an outer one.
   */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}
