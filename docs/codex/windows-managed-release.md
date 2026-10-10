# Windows managed Job release asset

Windows startup and execution require the bundled `hooks/windows-job-runtime.exe`
and `windows-job-runtime.json`. They contain the existing C# Job implementation,
not a new native helper or broker. Cold and warm runs use the same CMJ1 executable.
There is no runtime Add-Type/csc compilation, writable cache, or unowned fallback.
Missing/invalid assets fail closed before a target starts; restoring a complete
release permits a later retry. Execution-policy bypasses are unnecessary.

The manifest hashes both C# files as UTF-8 with CRLF normalized to LF and hashes
the executable as raw bytes. `.gitattributes` also fixes source LF and binary EXE.
Checks establish package consistency, not binary authenticity against an attacker
who can replace the whole installation and manifest.

Maintainers changing either C# file run `node scripts/build-windows-job.mjs` on a
Windows checkout containing the preceding valid managed asset. The fixed .NET
Framework compiler runs inside that preceding helper's Job with a 15s compile
deadline. There is no unowned compiler bootstrap if the previous asset is absent.
Commit both asset and manifest. Windows and Unix builds run
`node scripts/assert-windows-job.mjs`; Unix verifies the shipped source/asset pair,
not a fresh Windows compilation. The legacy compiler is not deterministic, so a
second build need not produce the same EXE hash. Normal installation/start needs
neither the compiler nor a helper-cache write. The supported local verification
here covers Windows x64; AnyCPU is not proof of x86 or ARM64 behavior.

Windows `start.mjs` begins a 25s startup budget before bootstrap. It covers release
asset check, dependency/ABI repair, hook runtime probe, runtime discovery and MCP
connection. Repair and version probes receive the same abort signal and remaining
budget; expired startup does not start a timeout-record worker with another 10s.
Fixed System32 where.exe uses no shell and at most min(2s, remaining). Version
probes use the managed Job. Ready connection clears the budget so it does not
cancel subsequent long tool calls. A deadline reports the stage, cancels owned
work, then exits after up to 1.5s cleanup. Restart with a corrected installation
re-enters normal validation and existing repair/backoff handling.

The where.exe exit status gates lookup; its OEM-encoded pipe text is not decoded
as UTF-8. Node resolves Unicode cwd/PATH/PATHEXT matches to absolute file paths,
checking remaining time between filesystem probes. Python retains the verified
absolute path rather than reselecting an earlier Store alias. Embedded native
plugin hosts do not arm this process-exit budget. Legacy synchronous CLI/TTY
diagnostic version APIs remain; only the MCP startup probes were replaced here.

This is not a hard deadline for an unreturning native filesystem/OS call: a JS
timer cannot preempt those. No external supervisor or new broker is introduced.
Explicit development compilation happens before startup; Windows start refuses
a missing server build instead of launching implicit npm/npx shell work.

Serial targeted checks:

```
node tests/codex/windows-release-asset.mjs results.json
node tests/codex/windows-owned-process.mjs results.json
node tests/codex/windows-stall-deadlines.mjs results.json C:\Users\you\.cargo\bin\rustc.exe
```

The release-asset fixture preserves the earlier real CodeDom compiler trap but
checks it is never invoked, then cancels/times out after a real owned child marker.
Earlier runtime-cache compilation tests describe the retired architecture and
are not evidence for this release path.
