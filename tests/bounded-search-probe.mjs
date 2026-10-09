/** Serial, disposable legacy-row probe. Build first; run one case per process.
 * Usage: node --expose-gc tests/bounded-search-probe.mjs 16777216 stem
 * Modes: exact, stem, accent, or, control. Records observed process memory,
 * not a guarantee that SQLite's internal allocations are size-independent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { ContentStore } from "../build/store.js";
import { loadDatabase } from "../build/db-base.js";

const bytes = Number(process.argv[2] ?? 1_200_000);
const mode = process.argv[3] ?? "exact";
if (!Number.isSafeInteger(bytes) || bytes < 4096 || bytes > 64 * 1024 * 1024) {
  throw new Error("Probe size must be 4 KiB through 64 MiB");
}
const cases = {
  exact: { query: "authentication", needle: "authentication", prefix: "prefix " },
  stem: { query: "running", needle: "run", prefix: "prefix " },
  accent: { query: "cafe", needle: "CAFÉ", prefix: "prefix " },
  or: { query: "cat authentication", needle: "authentication", prefix: "concatenate " },
  control: { query: "authentication", needle: "authentication", prefix: "\x02" },
};
const spec = cases[mode];
if (!spec) throw new Error("Unknown mode");
const dir = mkdtempSync(join(tmpdir(), "ctx-bounded-probe-"));
const path = join(dir, "legacy.db");
let store;
try {
  store = new ContentStore(path);
  store.close();
  const Database = loadDatabase();
  const db = new Database(path);
  const sqliteVersion = db.prepare("SELECT sqlite_version() AS version").get().version;
  db.prepare("INSERT INTO sources(label,chunk_count,code_chunk_count) VALUES ('probe',1,0)").run();
  let content = spec.prefix + "x".repeat(bytes) + " " + spec.needle + " EVIDENCE-END";
  for (const table of ["chunks", "chunks_trigram"]) {
    db.prepare(`INSERT INTO ${table}(title,content,source_id,content_type,session_id)
      VALUES ('Legacy probe',?,1,'prose','probe-session')`).run(content);
  }
  content = null;
  db.close();
  globalThis.gc?.();
  store = new ContentStore(path);
  const before = process.memoryUsage();
  const start = performance.now();
  const [result] = store.search(spec.query, 1, "probe", mode === "or" ? "OR" : "AND", undefined, "exact");
  const wallMs = performance.now() - start;
  const after = process.memoryUsage();
  const evidence = result?.content.includes(spec.needle) && result?.content.includes("EVIDENCE-END");
  const marked = result?.highlighted?.includes(`\x02${spec.needle}\x03`);
  const bounded = Array.from(result?.content ?? "").length <= 3002;
  console.log(JSON.stringify({ node: process.version, engine: Database.name, sqliteVersion,
    mode, inputBytes: bytes, wallMs, outputBytes: Buffer.byteLength(result?.content ?? ""),
    outputChars: result?.content.length, evidence, marked, bounded,
    rssBefore: before.rss, rssAfter: after.rss, heapBefore: before.heapUsed,
    heapAfter: after.heapUsed, peakRssKiB: process.resourceUsage().maxRSS }));
  if (!evidence || !marked || !bounded) process.exitCode = 1;
} finally {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
}
