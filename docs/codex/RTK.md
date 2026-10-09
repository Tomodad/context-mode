# RTK on Windows Codex

RTK filters supported CLI output. The native `PreToolUse` hook rewrites
recognized Shell commands on covered execution paths when enabled and trusted.
Explicit RTK calls remain useful in scripts, inside CTX executors, or when selecting a
specific filter; already-wrapped commands are not wrapped again.

## Current bridge-path exception

- For supported commands invoked through `functions.exec` ->
  `tools.exec_command`, use explicit `rtk ...` until automatic rewriting on
  this path is fixed and verified. Use `rtk proxy ...` for unfiltered output.
- Verified on 2026-10-09 with RTK 0.51.0 and Codex 0.162.0-alpha.2 on Windows:
  bare `git log -3` exactly matched the 3844-character proxy output; explicit
  `rtk git log -3` produced 1110 characters in RTK's compact format.
- Command execution succeeds; automatic output filtering is absent on the
  tested bridge path. Whether hooks are not dispatched or rewritten input
  is lost inside the bridge remains unresolved.
- Remove this workaround only after real output comparisons confirm the
  automatic behavior. Hook load/trust state and statistics alone do not
  prove that an individual invocation was rewritten.
- Upstream report: [rtk-ai/rtk#4489](https://github.com/rtk-ai/rtk/issues/4489).

## Output requirements

- A bare native command can still be rewritten by the hook. Use `rtk proxy`
  when exact JSON, complete diffs, unfiltered search results, or native command
  behavior is required. Filtering choices do not grant execution permission.
- `rtk rg` also filters output; it is not the unfiltered `rg` surface.
- Use Context Mode on demand for large-data analysis and indexed retrieval.
  Do not add a CTX layer to an already sufficient RTK result by default.
- When RTK emits a recovery hint, `rtk recall` can retrieve the stored output.
  Availability depends on the configured retention mode and stored entries.

```powershell
rtk proxy git diff
rtk proxy gh api <endpoint>
rtk proxy rg -n <pattern> <path>
rtk recall <hash> --lines 80
```

## Windows and verification

- Use resolved executables and PowerShell syntax. Use native directory
  listing instead of `rtk ls`; use `Get-Content` ranges for exact lines.
- `rtk --version` checks the binary; `rtk hook check "git status --short"`
  checks a rewrite rule. Neither proves that the live Codex hook ran.
- Check Codex Hook load/trust state and a real invocation when diagnosing
  integration. `rtk gain` reports RTK statistics, not all CTX/client activity.
- Read command help for details. Never run `rtk init` over customized global
  instructions merely to refresh this reference.
