/**
 * event-emit — Phase 5+7 of D2 PRD (stats-event-driven-architecture)
 *
 * Server-side helpers that record sandbox / index / cache work into
 * `session_events` with the new `bytes_avoided` / `bytes_returned`
 * columns so the renderer can compute the real $ saved instead of the
 * conservative `events × 256` token estimate.
 *
 * Design notes
 * ────────────
 * - Uses the public `SessionDB.insertEvent(... , bytes)` API the schema
 *   engineer extended in this branch — same dedup + FIFO eviction +
 *   transaction wrapping you'd get from any other event source.
 * - Best-effort error swallowing matches `persistToolCallCounter` in
 *   `persist-tool-calls.ts`. A stats-side failure must NEVER break the
 *   parent MCP tool call.
 * - Scoped callers supply their exact session_id and projectDir. Legacy
 *   callers without an override still resolve the latest session_meta row.
 *   An explicit null session disables attribution instead of guessing.
 */

import { existsSync } from "node:fs";
import { SessionDB } from "./db.js";

interface SessionWriteOptions {
  sessionDbPath: string;
  /** null disables attribution; undefined preserves the legacy latest-session lookup. */
  sessionId?: string | null;
  projectDir?: string;
}

/** Run best-effort accounting under an exact session or the legacy latest. */
function withSession(
  opts: SessionWriteOptions,
  fn: (db: SessionDB, sessionId: string) => void,
): void {
  try {
    if (opts.sessionId === null || !existsSync(opts.sessionDbPath)) return;
    const sdb = new SessionDB({ dbPath: opts.sessionDbPath });
    try {
      const sid = opts.sessionId ?? sdb.getLatestSessionId();
      if (!sid) return;
      if (opts.sessionId) sdb.ensureSession(sid, opts.projectDir ?? "");
      fn(sdb, sid);
    } finally {
      try { sdb.close(); } catch { /* ignore */ }
    }
  } catch {
    // Best-effort: never break the parent MCP tool call.
  }
}

/**
 * Record a `ctx_execute` / `ctx_execute_file` / `ctx_batch_execute` run.
 * `bytesReturned` is the size of the stdout text the user actually saw —
 * the rest of the sandbox output stayed out of context.
 */
export function emitSandboxExecuteEvent(opts: SessionWriteOptions & {
  toolName: string;
  bytesReturned: number;
}): void {
  withSession(opts, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "sandbox-execute",
        category: "sandbox",
        priority: 1,
        data: opts.toolName,
        project_dir: opts.projectDir ?? "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
      undefined,
      { bytesReturned: opts.bytesReturned },
    );
  });
}

/**
 * Record a `ctx_index` / `trackIndexed` write — content kept out of
 * context by being chunked into FTS5 instead of returned inline.
 */
export function emitIndexWriteEvent(opts: SessionWriteOptions & {
  source: string;
  bytesAvoided: number;
}): void {
  withSession(opts, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "index-write",
        category: "sandbox",
        priority: 1,
        data: opts.source,
        project_dir: opts.projectDir ?? "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
      undefined,
      { bytesAvoided: opts.bytesAvoided },
    );
  });
}

/**
 * Record a `ctx_fetch_and_index` TTL cache hit — bytes the user would
 * have spent re-fetching the same URL within the 24h cache window.
 */
export function emitCacheHitEvent(opts: SessionWriteOptions & {
  source: string;
  bytesAvoided: number;
}): void {
  withSession(opts, (sdb, sid) => {
    sdb.insertEvent(
      sid,
      {
        type: "cache-hit",
        category: "cache",
        priority: 1,
        data: opts.source,
        project_dir: opts.projectDir ?? "",
        attribution_source: "server",
        attribution_confidence: 1,
      },
      "ctx-server",
      undefined,
      { bytesAvoided: opts.bytesAvoided },
    );
  });
}
