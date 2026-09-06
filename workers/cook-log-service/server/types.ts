/*
 * Minimal D1 typings — only the surface this Worker actually calls. Avoids
 * pulling in @cloudflare/workers-types for a handful of methods, matching
 * the existing pitmaster-command-center Worker's style of hand-rolled,
 * narrow `Env` interfaces (see server/contactHandler.ts in the repo root).
 */

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface CookLogEnv {
  DB: D1Database;
}
