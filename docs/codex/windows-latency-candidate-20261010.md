# Windows candidate: Job ownership acceptance, 2026-10-10

**Historical Job-ownership phase.** The current stall-priority changes and
acceptance are in [windows-stall-closure-20261010.md](windows-stall-closure-20261010.md).
That report supersedes the old Rust/bootstrap and performance-only blocker
wording below; this phase's measurements and remaining desktop boundaries stay
as historical evidence.

The former parent-exits-first orphan and automatic installer-host-death boundary are fixed in source `2860a372eb59a9cee829e32903eaa5573a944e8b` (parent `b518ad98d3e857aa97b85abc2937dc83438cccd1`). The same `codex_windows_latency_candidate` is a reviewable experiment. **Do not replace the active installation yet:** this helper adds substantial short-call latency, and candidate loader/manifest, visible windows hiding, restart/resume acceptance are incomplete. Prior orphan-fail/taskkill descriptions refer to the parent commit, not this release.

## Scope and exact dependencies

Only affected Windows execution/bootstrap behavior and release checks were rerun. The unchanged cloud 432-case sets, seven RTK cases, FTS/budget sets and full cross-platform suite were not rerun. This is not a green CI claim: original full-suite failures included 21 baseline-equivalent cases; branch push filters remain main/next.

Package/manifest label is still 1.0.169; it does not identify the commit. Local Node is 24.13.0 / ABI137 / x64. Direct Node-adjacent npm CLI is 11.6.2; the PATH shim resolves a separate 11.8.0 install. Frozen toolchain: TypeScript5.9.3, esbuild0.27.7, SDK1.26.0, better-sqlite3 12.9.0 / SQLite3.53.0. The active installation remains 12.11.1 / SQLite3.53.2 and is not replaced. Six independently rebuilt bundles have identical hashes; `376` dry-run package files include every new raw helper. See the adjacent bundle JSON.

## Windows changes

- Existing Windows PowerShell/.NET compiles a managed C# helper; no MSVC, SDK install, native addon, execution-policy override, ACL change, or global configuration change. Windows10+/Server2016+ is required for `PROC_THREAD_ATTRIBUTE_JOB_LIST`; unsupported APIs/Job restrictions fail closed.
- Job membership is atomic with suspended `CreateProcessW`, then the thread resumes. `KILL_ON_JOB_CLOSE` and no breakaway flags own normally inherited descendants. An explicit handle list passes stdout/stderr/NUL only; Job and parent control-input handles are not inherited. Synchronous `PeekNamedPipe` detects EOF without a delayed reader-task race.
- Ordinary executor root exit ends remaining descendants. Background calls retain the exact helper/control handle until cleanup/host death. Stop uses control EOF, followed after1.2s by a watchdog on that exact owned `ChildProcess`; no PID reopening, process-name kill, broad enumeration, or taskkill fallback.
- Automatic native seed/swap/stamp/heal/install and requested startup JS installs run in one owned worker with SQLite gate. A canonical-root named Local Job rejects contenders while any prior installer descendant survives. Existing Jobs are never reconfigured or terminated by a contender. Pure-JS packages must actually load before success; Node/Bun controlled failures enter existing backoff. Bun cache seeding remains protected; Unix behavior retains its earlier bootstrap and background SIGTERM semantics.
- cmd receives native executable spelling/quotes and CRLF batch lines. Actual LF/CRLF controls establish the UTF8/chcp byte-offset failure.
- Node24.13 recursive `rmSync` still has the isolated Unicode defect. Executor fallback only removes its generated direct `.ctx-mode-*` temp child using lstat/unlink/rmdir; it does not follow stable links/junctions. Background/grace-uncertain cleanup is skipped. No global UTF8 setting or Node upgrade is needed.

## Verified evidence

| Acceptance | Result |
|---|---|
| Serial process ownership | 25/25: Unicode/quotes, cmd, Path/PATH, NUL input, creation failure, early/pre-abort, parent exit with inherited or ignored pipes, cancel/timeout, background, cap, host hard death, nested Job, injected config/attribute/resume failures, suspended helper death, stalled-helper watchdog, restricted outer Job, Unicode cleanup with preserved junction target |
| Real shared heal process chain, synthetic installer payload | 7/7: contender and path alias exclusion, host hard death stops installer descendant/writes, retry after Job end, Node/Bun JS failure backoff, Bun protected cache seeding |
| Chinese cwd/temp shell matrix | 9/9: PowerShell7/5.1, cmd, Git Bash, exit37, timeout, relative/absolute file processing; completed generated temp trees removed |
| Full isolated start.mjs | 3/3 cold/first-warm/steady-warm; initialize/tools list/index/search, complete last-line extraction, exact Chinese/cafe/emoji write, exit37, EOF0 |
| Existing affected tests | 4/4, correct candidate root, serial, own ASCII temp (8.3/long-path assertion ambiguity excluded) |
| Raw Codex hooks | 4/4 pass/deny/unsupported-ask/ondemand SessionStart; raw invocation is not host-hook-loader proof |
| Existing live ctx_execute bridge | Candidate helper returns Chinese output and exit37; existing plugin remains installed |
| Real bundled MCP batch cancellation | Child dead, two queued jobs never started, no results indexed; observed after a deliberate 2.3s wait (2.351s including search), EOF0; not a cancellation latency measurement |
| Release | TypeScript plus six existing bundle commands/assertions, independent identical rebuild and required package paths pass |

The original 19-case SQLite gate/statistics correctness baseline remains unchanged and was not retested merely for statistics optimization. No filesystem statistics memo was reintroduced. Fixture mistakes (early .done omission, missing SystemRoot in a minimal PATH fixture, task-root Vitest selecting sibling copies) are excluded from candidate outcomes; final narrow fixtures resolve them. Fault injection tests copies of the helper, not production environment bypasses.

## Costs and limits

Final full-start initialization: 3.747/3.49/2.501 seconds. In these nine short execution calls, 751–806 ms versus prior86–100ms samples. Earlier Job sample was4.05/3.61/2.46s and771–867ms. These are small free deterministic samples, not statistical tail-latency or paid-model A/B. Stable warm start makes no native copy; cold and first-warm seed/swap/stamp remain owned. The execution regression is mainly the per-call managed-helper path; do not market it as free acceleration.

Statistics was not optimized in this round. Existing persistStats runs a60s heartbeat and may synchronously refresh its separate30s lifetime statusline cache on response persistence. The earlier synthetic24DB aggregate cost (~27.65ms) is smaller than the observed per-execute helper cost, but this is not proof of zero contention on private real workloads. This existing scheduling was not changed.

Normal helper shutdown explicitly confirms Job ActiveProcesses==0. A watchdog hard-kill has only helper close plus kernel KILL_ON_JOB_CLOSE; the real stalled-helper fixture observed target death, but the exceptional close path does not always carry the normal zero-process acknowledgment. Bootstrap still has per-operation deadlines, not an overall bound against an unreturning OS/managed API. WindowsHide flags are set, visual hiding is unverified.

Named Local Jobs cover this user's Windows session and canonical path. Old directory/SQLite-only protocols do not honor this ownership, so upgrades require quiescence. Direct exported repair/postinstall and dev missing-bundle paths are outside the automatic released-worker guarantee. WMI/external-service/malicious breakaway behavior is not claimed; stable-junction cleanup testing does not prove resistance to concurrent path replacement. Rust compile/runtime probes remain synchronous and are not newly certified for live cancellation.

The active plugin/global instructions/config/native hashes and user branch/changes are preserved. The live old tool bridge proves helper compatibility only; it does not accept the new manifest/loader/host hooks or a reload. Any later active-host interruption needs explicit confirmation. Full backup/native/config manifest, restore rehearsal and post-switch checks remain prerequisites to deployment and have not been claimed complete.

## Reproduction

```powershell
node node_modules/typescript/bin/tsc
node tests/codex/windows-owned-process.mjs owned.json
node tests/codex/windows-repair-lifecycle.mjs '<new isolated root>' '<frozen native-deps root>' repair.json '<optional exact bun.exe>'
```

Run serially with ordinary Windows token; never alter policy to make a restrictive token work. The task evidence ZIP also includes the full start, shell, actual bridge, batch cancellation, package/hash and fixture-control logs. Keep RTK for explicit supported commands and Context Mode for on-demand large-file/index/search work. Short routine commands should not be routed through this candidate for speed. Characters avoided are not proof of reduced total billing.
