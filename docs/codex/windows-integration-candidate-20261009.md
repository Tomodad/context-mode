# Windows integration candidate — 2026-10-09

This branch is a **candidate for isolated Windows host testing**, not an approved replacement for an active plugin installation. No user desktop installation, existing branch, configuration, database, or upstream PR was changed.

## Base and selected changes

Base: `codex/rtk-instructions-20261009` at `521b6c54a7cc26407daf9167a78d9b45b4480e51`.

- FTS bounded hydration: source/test ports of `31642019` and `734ac89a` ([upstream #963](https://github.com/mksglu/context-mode/pull/963)).
- Batch indexing budgets: source/test ports of `598df57f` and `3e21a12b` ([#980](https://github.com/mksglu/context-mode/pull/980)). The unrelated HTTP-402 commit/revert pair was not included.
- Windows console suppression: `a30fe933` ([#1154](https://github.com/mksglu/context-mode/pull/1154)).
- Surrogate-safe snippets/echoes: `2a81d770` ([#1176](https://github.com/mksglu/context-mode/pull/1176)).
- Dependency bootstrap: `b3a26354` ([#863](https://github.com/mksglu/context-mode/pull/863)) and `3877e4c7` ([#1129](https://github.com/mksglu/context-mode/pull/1129)).

FTS and budget source changes merged without a source conflict. Both old server/CLI bundles conflicted and were excluded from source-stage commits; all six bundles were rebuilt from the combined sources. The bootstrap conflict was limited to imports. No whole-file preference was used to discard either feature.

Additional integration fixes:

1. Legacy-row match location now uses FTS5's own tokenizer-aware snippet, rather than substring/six-character-prefix guesses. Regression cases cover OR's later term, `cat` inside `concatenate`, `running` matching `run`, diacritic folding (`cafe`/`CAFÉ`), Chinese/emoji, giant matching tokens, and literal STX/ETX data.
2. Fresh UUID delimiters are checked absent from the row before snippet extraction. SQLite returns at most 7,096 marked codepoints; JS returns at most 3,000 content codepoints plus boundary ellipses. Normal rows of at most 4 KiB retain full content/highlight behavior. Raw control characters are retained in content; only the display highlight stream neutralizes literal delimiter bytes.
3. Batch metadata/title and source-label caps now preserve surrogate pairs, including a real MCP handler regression.
4. ABI probe/rebuild processes hide Windows consoles. PATH reconstruction preserves a Path-only environment. Added tests execute the real bootstrap functions with inert Windows process mocks.

The RTK base's eight focused Codex skills, native-friendly pass-through, and explicit deny/ask precedence remain unchanged. This candidate does not force all commands through RTK or CTX.

## Deliberately excluded

No original retry/backoff implementation from #1224/#1278 was stacked onto bootstrap. No #1165 sandbox-boundary change, #988 WAL checkpoint policy, automatic database reconstruction, lifecycle cleanup redesign, or unrelated collection of all Windows PRs was included.

## Verified cloud environment

Linux, Node 24.19.0 and Node 22.5.0. Dependency versions were taken from the unchanged `bun.lock`, installed with Bun 1.4.2 using `--frozen-lockfile --ignore-scripts`; only the required better-sqlite3 native dependency was explicitly rebuilt. Tool packages came from the npm registry. Node 22's final tests used a standard-layout Node+npm 10.8.2 toolchain with an independent native dependency tree. A bare Node-only package initially failed the bootstrap fixture because it did not include npm; that toolchain setup was corrected without altering production code.

- Typecheck: passed.
- Build, six bundle assertions, asymmetric-drift assertion: passed.
- A second complete rebuild matched all six committed bundle files exactly.
- `git diff --check` and bootstrap syntax check: passed.
- RTK ownership/security/manifest tests: 7 passed.
- Affected suites on each of Node 22 and Node 24: 10 files, 432 passed, 1 skipped.
- Full Node 24 suite: 213 files; 209 passed, 4 failed. Tests: 4,674 passed, 76 failed, 42 skipped. **The complete suite is not green.**
- Failure diagnosis: the full run inherited XDG paths pointing outside the writable test home. After clearing those overrides, the same four failed-file groups were run on both the candidate and untouched RTK base: each had **230 passed, 21 failed, 25 skipped**. Failure identities matched exactly (zero candidate-only failures within those four groups). Exactly 55 of the original 76 failures passed after cleaning the environment; the other 21 remained, with no new failure identity on rerun. The remaining 209 full-suite files had already passed. This is not a second complete-suite green run. The remaining failures were 8 executor, 1 OpenCode plugin, 11 OpenCode adapter, and 1 lifecycle test. These are reproduced baseline limitations in this cloud environment, not a claim that those behaviors pass elsewhere.

The remaining platform limitations include TSX attempting a prohibited Unix-domain socket, a system executable named `go` that is not the Go compiler, and a subprocess signal test. These do not constitute a Windows pass. No sandbox/network policy was relaxed to make tests pass.

## Large-row probe and trade-off

`tests/bounded-search-probe.mjs` creates only disposable test databases. Each mode runs in a fresh process after a build:

```sh
node --expose-gc tests/bounded-search-probe.mjs 16777216 stem
```

Twenty candidate observations covered exact, Porter stem, accent, OR, and literal-control matching, at 1,200,000 bytes and 16 MiB, on both Node versions. Every observation retained the matching evidence and returned 319–330 content bytes.

| Runtime | Input | Observed search time | Maximum whole-process peak RSS |
|---|---:|---:|---:|
| Node 24.19 | 1,200,000 B | 12.9–15.3 ms | 53.5 MiB |
| Node 24.19 | 16 MiB | 192.8–209.0 ms | 187.3 MiB |
| Node 22.5 | 1,200,000 B | 12.7–19.3 ms | 67.6 MiB |
| Node 22.5 | 16 MiB | 193.8–242.2 ms | 215.5 MiB |

A single exact-query comparison on the untouched Node-24 base returned 16,777,251 content bytes for the 16-MiB row, took about 159.6 ms, and peaked around 300.3 MiB. Candidate exact-query output was 330 bytes, about 197.9 ms, and around 187.0 MiB peak. This trades extra SQLite work for bounded JS hydration and lower observed memory; it is **not** a search-speed improvement claim. Peak RSS includes database preparation and is not an isolated SQLite allocation measurement. These are small controlled probes, not model-quality or end-to-end cost benchmarks.

SQLite still scans/materializes native data proportional to a legacy row's size. This candidate does **not** impose a hard SQLite-memory bound, handler deadline, or subprocess-capture memory cap. Batch budgets apply after capture and before indexing. Operator words and quoted queries retain the pre-existing public query normalization; this work does not introduce raw FTS Boolean/phrase syntax. A bounded excerpt is local evidence, not an exhaustive representation of every matching term.

## Windows acceptance still required

Use an isolated checkout and disposable storage; back up the current installation/configuration/database before any authorized installation change. Record exact commit and bundle hashes, not just package version 1.0.169.

1. Verify native Node version/architecture and better-sqlite3 ABI, real npm resolution under multiple Node installations, plugin loading, and hook stdin protocol.
2. Exercise spaces/Chinese characters in paths, differing process/project cwd, absolute and relative indexing with explicit source, Git Bash and PowerShell output/UTF-8.
3. Check actual console suppression, permission deny/ask precedence, execution cancellation/timeouts, process/file cleanup, and interactive Codex restart/resume.
4. Run tests serially (`--maxWorkers=1 --no-file-parallelism`), especially given the previously reported Windows filesystem-driver crash under broad concurrency.
5. Compare four arms with the same task, model/version, input, and quality criteria: native; explicit RTK; selective CTX; both. Measure success/retries/latency/actual billed usage and inspect lost evidence. Do not infer benefit from output compression alone. Keep explicit RTK for bridge paths not proven automatically rewritten.

## Rollback and publication

Only the new candidate branch is authorized for publication. Existing fork branches and upstream remain untouched. The commits deliberately expose source-integration stages; **intermediate source-only commits are not installation artifacts** and need a fresh build before testing. The final tip contains rebuilt bundles. To reject the candidate, keep using the original installation or check out the fixed base SHA in a separate worktree; do not reset an active user checkout or replace databases as part of this review.

The repository's CI push/PR branch filters target `main` and `next`. A new candidate branch may therefore have no automatic checks. Check the published exact SHA before claiming CI coverage; cloud Linux tests are separate from a Windows runner and the user's desktop host.
