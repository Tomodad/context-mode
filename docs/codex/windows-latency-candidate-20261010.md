# Windows latency candidate (2026-10-10)

This is the primary **candidate for review and further acceptance**, not a recommendation to replace a running installation. No current installation, global configuration, permissions, or user application was changed for this publication.

## Provenance and installation artifacts

- Previous comparison branch: `codex_windows_integration`, unchanged at `5aced8f578e7a507efa87cc991346e6156e0ddc9` (tree `e501777ef9abe5aefc05a058fa9b19337faa9480`).
- New branch: `codex_windows_latency_candidate`.
- Experimental source base: `1ccb945c9e2207cb2c4d785d6669c53d32d68cc1`, containing these three commits on top of the previous candidate:
  - `ed0046c5e7f13617eff371f137862e317fce8b22`: request cancellation, Windows termination and batch stop points.
  - `da20b0f1a4e04fb294a9ce4bd2534126c8e4a18d`: statistics memoization, main-file replacement checks and read-only schema probing.
  - `1ccb945c9e2207cb2c4d785d6669c53d32d68cc1`: native swap stamps and automatic bootstrap repair gate.
- This publication adds a separate distribution/documentation commit, without extending those source fixes. Version remains `1.0.169`; pin the commit rather than distinguishing installations by package version alone.

Codex's manifest starts `node ./start.mjs`, which imports `hooks/ensure-deps.mjs` and then `server.bundle.mjs`. The hook/CLI paths also consume the shipped bundles. Publishing the source commits alone would leave a mixed installation running old code.

All six distribution bundles were generated with the existing package-script options, including `--minify`, from the exact experimental source. `server.bundle.mjs`, `cli.bundle.mjs` and `hooks/session-db.bundle.mjs` changed; the other three rebuilt byte-identically. The raw `hooks/repair-gate.mjs` is tracked and included under the package's existing `hooks` files entry. The unpublished, unminified experimental bundle is not part of this branch.

Build environment: Windows x64, Node `24.13.0`, npm `11.8.0`; frozen, unchanged `bun.lock`, installed with isolated Bun `1.4.2 --frozen-lockfile --ignore-scripts`. Locked TypeScript `5.9.3`, esbuild `0.27.7`, MCP SDK `1.26.0`, better-sqlite3 `12.9.0`. Lifecycle scripts remained disabled for that dependency tree.

Publication checks passed:

- Direct fixed-toolchain `tsc -p tsconfig.json` (including emission for package adapters).
- The six existing esbuild bundle commands, run serially without a shell wrapper.
- `scripts/assert-bundle.mjs` for all six files and `scripts/assert-asymmetric-drift.mjs`.
- A second independent output directory produced identical SHA256 for every bundle.
- Isolated `npm pack --dry-run --ignore-scripts`: all required Codex/start/CLI/server/hook/gate paths present, including emitted `build/server.js`; no npm package was published.
- The actual minified release server bundle passed one fresh isolated stdio MCP batch-cancellation smoke: first child stopped, neither queued child started, subsequent search reported an empty knowledge base, server EOF exit `0`.

These checks establish source/artifact alignment and package contents, **not** complete native cold-start or desktop-loader acceptance. Git installs use the tracked bundles; ignored emitted `build/` is not committed. The npm dry-run includes that local emitted directory and does not prove a Git-only checkout can run every optional adapter before its normal build.

## Windows evidence already obtained

The same-machine baseline was source commit `521b6c54a7cc26407daf9167a78d9b45b4480e51`; its committed server bundle was byte-identical to the active installation. Tests used isolated directories, synthetic data and owned processes. No paid model A/B was run.

- Baseline and previous candidate ignored MCP cancellation; their finite two-second child still wrote its completion marker. The experiment prevents pre-cancelled startup and terminates mid-call executions. The measured direct execution cancellation settled in about `950 ms`, with exit `1`, no completion output and balanced abort listener removal. The child was still observable at `500 ms`; instantaneous cancellation was not demonstrated.
- Owned parent/child tree termination, serial/parallel queue stopping, late-abort cleanup, spawn-error cleanup and survival of another request passed the targeted fixtures. Real MCP batch cancellation prevented post-cancellation indexing.
- On 24 synthetic databases with 1,000 rows each, statistics warm reads went from about `42–46 ms` to about `5.4 ms`, with zero database opens/queries on the unchanged warm path. WAL-only inserts, row eviction, deletion and same-path database replacement passed after the local main-file identity/state check. The experiment's cold read was slower; this is a warm-call optimization, not a general latency claim.
- Ten repeated ABI-cache calls previously copied `19,194,880` bytes. Swap stamps reduced warm copies/renames to zero. Replacing the active file, changing the cache and a stamp-write failure fallback passed. These native fixtures used the same known-working `12.11.1` binary under current ABI `137`, not the lockfile's `12.9.0` binding.
- Automatic bootstrap gate fixtures covered missing package, missing binding and damaged binding failures, repeated calls, two simultaneous callers and a killed fixture host followed by lease-expired recovery. Node/ABI-key change was injected; another real Node ABI was not run. Controlled installer/heal/rebuild branches are not an official native-install success test.
- PowerShell 7/5.1 and normal-token Git Bash produced correct Unicode/space-path output and working-directory behavior. The cmd child-process and Chinese temporary-directory removal controls still failed in this environment, including controls without candidate logic. Their root causes are unresolved. Execution success and temporary-directory cleanup must not be conflated.

## Independent review and limitations

A separate read-only reviewer checked the source delta from `5aced8f` to `1ccb945`. No definite normal-path P0/P1 blocker was identified. Two new P2 findings remain in this candidate; they were documented rather than silently repaired:

1. **Repair reclaim-lock crash window:** `hooks/repair-gate.mjs` creates `.ctx-repair-lock.reclaim` without its own owner/expiry/death recovery. Killing the host between that creation and its `finally` cleanup can leave later stale-main-lock recovery permanently returning `inflight`. The prior killed-host fixture did not target this narrower window.
2. **Statistics in-place WAL updates:** the incremental path validates the highest previously counted row's `session_id/created_at/data` and row counts, but inherits previous category/project/earliest-time aggregates. WAL updates to `category/project_dir`, even on that highest row, or to older rows' timestamps can therefore leave stale aggregates. No ordinary SessionDB writer changing those aggregate fields was found; this is an external-edit/restore boundary, not demonstrated daily corruption. Main-file changes and actual replacement already force full scans.

Additional boundaries:

- Windows `taskkill` is synchronous and capped at five seconds; the `1500 ms` grace starts **after** it returns. This is not a 1.5-second total cancellation SLA, and simultaneous requests share event-loop blocking. The existing synchronous Rust compiler can block cancellation for up to 60 seconds; its temporary-directory return-path cleanup issue predates this delta.
- The gate covers **automatic module initialization**, not exported direct `ensureDeps/ensureNativeCompat` calls or every postinstall heal entry. `inflight/backoff` does not wait for another repair to finish. State-unavailable handling can skip repair. Do not describe the marker as a universal mutex or all-entry repair guard.
- The experimental cold gate uses a native child-process probe even on modern Node, unlike the old fast path's probe-skipping behavior. A first draft preloaded the native DLL in the parent and hit Windows rename `EPERM`; the retained source uses a child probe instead. Actual locked-binding cold startup remains to be accepted.
- Memoization is process-local. Main/WAL filesystem metadata is not a universal content version; coarse timestamps or metadata-preserving restores need extra consideration. Native swap stamps similarly identify file state, not a cryptographic guarantee of loadability.
- Synchronous SQLite work cannot be interrupted by an MCP cancel notification or JavaScript timer while it blocks the event loop.

Still unverified before replacing a local installation:

- Locked better-sqlite3 `12.9.0` binding under current Node/npm, complete isolated `start.mjs` cold/warm startup and the actual desktop plugin loader.
- The parent-exits-first/inherited-stdio orphan and grace fallback. The available fixture did not retain a live orphan; it does not prove that fallback cleans one up.
- The cmd and Chinese-cleanup root causes, real-workload end-to-end long-tail latency, visible `windowsHide` behavior, and restart/resume behavior.
- The two P2 cases above, direct repair entry interactions, pending/failure state read/write failures and recovery of stale reclaim locks.

## Minimum pre-replacement acceptance and rollback

Do not repeat the unchanged candidate's cloud build/typecheck, RTK seven checks, Node22/24 focused 432-case sets, FTS hydration/budget regressions or all cross-platform tests merely to replace a local copy. The previous cloud suite was not globally green; this branch must not claim a new green CI run without an actual run.

Required next gates, all isolated first:

1. Exercise the exact published commit's locked native dependency, full `start.mjs`, a real Codex hook JSON call and representative index/search/execute calls, recording cold/warm duration, output, exit and cleanup. Do not allow that startup to repair the active installation.
2. Resolve or explicitly accept the two P2 findings with deterministic narrow fixtures; also test missing/corrupt/read-only gate state and the direct repair entry behavior. Broad parallel scans are unnecessary.
3. Target the real inherited-stdio orphan case and verify owned descendant cleanup. Recheck cmd/Unicode-path cleanup without changing ACLs. If the host cannot reproduce it, keep that item unverified.
4. With separate user approval for anything that interrupts the active plugin, verify actual desktop load, tool availability, RTK/Context Mode hook interactions, restart/resume, and console-window hiding. Read the published SHA/tree and loaded artifact hashes back rather than relying on the unchanged version label.
5. Measure a small representative workload's full elapsed time and outcome; context characters or `rtk gain` do not establish reduced billing.

Only after those gates and explicit replacement approval: preserve the active installation's exact binaries/bundles, manifest, dependency state and affected configuration hashes; install the pinned candidate in a separate location, then switch deliberately. Keep the old installation and `codex_windows_integration` at `5aced8f` as comparisons. Roll back by switching to the preserved active installation and restoring only the settings changed by that authorized switch; do not reset user repositories, remove user data, or use a package-version-only downgrade. Restart any affected host only with approval.

## CI expectation

The repository's main CI workflow has push branches `[main, next]` and pull-request targets `[main, next]`. Pushing this new candidate branch alone does not match that push filter. The publication process will query workflow runs for the exact final SHA; absence of a run is not a CI pass. No workflow changes, manual dispatch or PR creation are part of this publication.
