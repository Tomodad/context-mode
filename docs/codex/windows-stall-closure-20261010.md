# Windows stall closure, 2026-10-10

This candidate prioritizes stopping hung tasks. It does not deploy or replace
the active installation. The earlier cache experiment's remaining latency is
an explicit tradeoff; Job ownership is retained. No native helper, broker,
global configuration, permission change or paid model experiment was added.

## Changes and bounds

- Rust compilation uses the existing asynchronous executor/owned Job path.
  Cancel/timeout stops the compiler and its inherited descendants. Compile
  failure never runs the binary and preserves the compiler exit status. An
  explicit caller timeout covers compile plus run; an unspecified timeout still
  caps compilation at 60 seconds. The Rust path now shares normal temp cleanup.
- `prepareWindowsJobHelper` defaults to a finite 30 second preparation budget.
  `runWindowsRepair` defaults to a 180 second repair budget. Both accept a finite
  override and `AbortSignal`. They stop the real owned process rather than only
  racing a timer against a live operation.
- Stop retains the existing 1.2 second exact-ChildProcess watchdog. Waiting ends
  after an additional 1.5 second settlement allowance if close never arrives,
  with `terminationUncertain`. This is not a claim that a helper or descendant
  died. Preparation returns false; repair returns `termination-uncertain` and
  does not start a status writer. Owned pipe detachment does not terminate a tree.
- After a closed timed-out repair, the existing worker can make one additional,
  owned, 10 second attempt to record failure using the same named Job and SQLite
  gate. It installs nothing and never recursively records its own timeout.
  Cancellation propagates to this attempt. Actual dependency health is checked
  under the gate so an old timeout cannot overwrite a now-healthy repair with
  failure. `backoff` describes that worker's outcome; only `backoffRecorded:true`
  confirms the failure-state write. Busy/unavailable/writing failures are honest
  outcomes. Thus the default repair return budget can include 180s + 10s and up
  to two 1.5s settlement allowances. This is not a total budget for every phase
  of `start.mjs`.
- PATH CLI versions and a shared temp cache no longer establish desktop rewrite
  capability. The production status is `unverified` and automatic rewrite is
  disabled. Version parsing remains diagnostic only. Existing RTK ownership of
  Codex shell routing is unchanged; formatter simulations are not host evidence.

## Serial Windows evidence

| Check | Result |
|---|---|
| Hang/cancel regressions | 19/19; Rust compiler and detached child dead at return, timeout/cancel recovery, compiler failure, real Rust Unicode/exit37, compile+run budget, prepare/repair timeout/cancel and recovery, pre-Job startup stall, no-close uncertainty, cancellation during timeout recording |
| Actual repair gate deadline | 4/4; owned installer dead at return, recorded state, next call backoff without install, healthy late-record protection, explicit state-write failure |
| Host capability/formatter | 55/55; modern CLI/shared supported cache cannot enable production rewrite; no probe/cache IO; actual raw hook paths retain existing RTK split |
| Existing process ownership | 25/25; no new C# ownership changes |
| Existing real repair lifecycle | 7/7; named Job/path alias exclusion, installer host death/retry, Node/Bun controlled failure backoff and Bun seeding |
| Cache and protocol | 11/11; source/binary integrity, no replay on creation failure, malformed frame rejection and build-host-death cleanup |
| Full isolated start | 3/3; initialize 5.095/2.799/2.421s, tools/index/search, full last line and exact Unicode write, exit37 and EOF0 |
| Real bundled MCP batch | Child dead, two queued jobs never started, no cancelled output indexed, follow-up search responded, EOF0; deliberate 2300ms wait / observed 2329ms is not cancellation latency |

Fixed direct npm11.6.2 dry-run pack contains380 files after adding the two
acceptance documents (the earlier pre-documentation check contained378), includes the raw helpers
and excludes mutable `.windows-job-cache`. No dependencies were installed.

TypeScript and six independent bundle rebuilds/assertions pass. Unchanged cloud
432-case sets, RTK seven, FTS/index budgets and full cross-platform suite are not
rerun. This is not a full-suite or green-CI claim.

The earlier 17-case log predates stronger at-return assertions. The first
18-case fixture printed passing rows but exited before an unref cleanup await
could settle; it is excluded as a successful run. Final fixture refs only its
own process for cleanup. Vitest's initial sandbox TEMP rename failure occurred
before collection and is not a before-fix regression.

## Remaining boundaries and blocked loader

Initial PowerShell Add-Type compilation happens before the Job implementation
exists. The exact helper now has a bounded stop, but ownership/termination of
that initial compiler's descendants remains unverified. Normal helper shutdown
checks Job emptiness; watchdog death relies on kernel KILL_ON_JOB_CLOSE and the
tested PID observations. A result marked uncertain must remain uncertain.
Visible windows hiding and actual desktop cancellation/restart/resume are
unverified. Current CLI diagnostics and raw hooks do not certify that host.

`plugin list --json` on the fixed isolated CODEX_HOME previously failed with
Windows access denied (5). Read-only exact-ancestor checks found existing,
openable directories, but `GetFinalPathNameByHandleW` failed with 5 for the
original CODEX_HOME and every checked ancestor. It is not missing-path/argument
syntax. No alternate CODEX_HOME, ACL change or elevated retry was used to evade
the denial. Loader/manifest acceptance remains blocked by that permission.

## Smallest subsequent desktop acceptance

No restart is requested now. Before a production switch, retain the existing
hash-verified full plugin/config backup and restore rehearsal; confirm candidate
tip, six bundles, manifest-relative paths and native/JS health in the isolated
copy. The serial start/MCP/ownership checks are pre-restart evidence only.
Resolve the loader's read-permission prerequisite through an authorized host
session; record actual plugin/list or app-server metadata without model turns.
Do not infer successful load from `--version` or schema generation.

Once loader acceptance and an explicitly authorized quiet switch are ready:

1. Save active work and allow current installer/repair work to finish. Have the
   user normally close and reopen Codex once; do not force-kill it.
2. Read the actual running host identity and loaded plugin root, manifest/hooks
   and bundle hashes. Check SessionStart and raw pass/deny guidance on a new
   task and a resumed task. Keep rewrite capability unverified unless the actual
   host contract is demonstrated; a CLI/cache/config flag cannot substitute.
3. On one synthetic Chinese-and-space file, read its complete last line, make
   one exact Unicode edit, verify bytes/hash and exit37. Test explicit RTK and
   host tool bridging separately. Cancel one owned long task, verify child death
   and a subsequent index/search response. Observe PowerShell/cmd/repair windows.
4. On failure, restore the verified backup, reopen normally and read back loaded
   root/hash. Copy-only restore rehearsal does not prove post-switch restoration.

Until those checks pass, retain the current installation and use Context Mode
on demand for large-file/index/search work, with RTK explicitly where supported.
Characters avoided do not prove a lower total bill. The earlier warm short-call
~187ms versus ~100ms baseline remains a measured cost, not a hang blocker by
itself and not a zero-regression claim.

## Reproduction

Use fixed existing Node24.13.0/ABI137/x64, TypeScript5.9.3, esbuild0.27.7,
Vitest4.1.5 and frozen better-sqlite3 12.9.0/SQLite3.53.0; no install required.
Use a task-owned writable TEMP and ordinary Windows token for process tests,
never change execution policy or ACLs.

```powershell
node node_modules/typescript/bin/tsc
node tests/codex/windows-stall-deadlines.mjs deadlines.json '<absolute rustc.exe>'
node tests/codex/windows-repair-deadline-backoff.mjs '<frozen native-deps>' backoff.json
node tests/codex/windows-owned-process.mjs ownership.json
node tests/codex/windows-repair-lifecycle.mjs '<new fixture>' '<frozen native-deps>' lifecycle.json '<fixed bun.exe>' --cached
node node_modules/vitest/vitest.mjs run tests/hooks/formatters.test.ts tests/codex/host-capability.test.ts --no-file-parallelism --maxWorkers=1
```
