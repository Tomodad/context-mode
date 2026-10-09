# RTK on Windows Codex

RTK filters supported CLI output. The native `PreToolUse` hook automatically
rewrites recognized Shell commands when enabled and trusted. Explicit RTK
calls remain useful in scripts, inside CTX executors, or when selecting a
specific filter; already-wrapped commands are not wrapped again.

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
