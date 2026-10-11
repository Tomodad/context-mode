# Per-call Codex sandbox state: implementation boundary

This candidate prepares metadata parsing and fixes the existing in-process
project override's state isolation. It does **not** advertise
`experimental.codex/sandbox-state-meta` or claim that metadata alone authorizes
file access. The new parser/argument builder is not an enabled sandbox adapter.

For explicit `withProjectDirOverride` callers, content handles and session caches
are project/storage-specific; runtime counters and sidecars are also scoped to
the explicit session (or anonymous scope). Missing session IDs do not inherit
an environment session or a database's latest session. Scoped `ctx_stats`
reports runtime counters and current-project index state, without legacy global
lifetime scans or another session's event previews. The legacy no-override
statistics view is retained. These are isolation fixes for existing override
callers, not evidence that the current Codex transport supplies a project.

Open project content handles remain cached until purge or process shutdown.
There is no idle-handle eviction policy in this candidate; very long-lived
embedded hosts visiting many projects should be assessed before broader rollout.

## Verified protocol

Codex `rust-v0.162.0-alpha.17.2` resolves to
`740e5af33c71225640e0c1c1555c514c2c93ab74`. Its per-call state includes
`permissionProfile`, `sandboxCwd`, `codexLinuxSandboxExe`, `useLegacyLandlock`,
and `useMxc`. `sandboxCwd` is a **file URI**, not a native path. The CLI accepts:

```
<trusted absolute Codex executable> sandbox --sandbox-state-json <whole JSON> -- <actual command>
```

The entire original state, including unknown fields, must reach that CLI.
Permission entries must not be interpreted in Context Mode as an authorization
decision. Resolving the directory only locates a project; it does not grant read
access, including to paths lexically contained in that project.

The tag lacks `codexExecutable`. PR52182 later added that optional field as a
native absolute path string (not a file URI). A missing value is omitted; null
also decodes as absent. Client name is a compatibility marker, not proof of
identity; the operator must trust the MCP transport connection.

Sources:
- [Exact state definition](https://github.com/openai/codex/blob/740e5af33c71225640e0c1c1555c514c2c93ab74/codex-rs/codex-mcp/src/runtime.rs#L785-L796)
- [Exact sandbox implementation](https://github.com/openai/codex/blob/740e5af33c71225640e0c1c1555c514c2c93ab74/codex-rs/cli/src/debug_sandbox.rs#L203-L345)
- [Trusted executable and backend fix](https://github.com/openai/codex/pull/52182)
- [Context Mode proposal reviewed](https://github.com/mksglu/context-mode/pull/1165)

## Why the upstream proposal cannot be copied as-is

An open/close probe followed by an ordinary parent-process read is not protected
by the probed sandbox. The actual byte read and user program must run inside
the sandbox, as must compiler stages and all alternate execution routes.
Denied, unavailable, malformed, unsupported, or timed-out sandbox execution must
never retry as an ordinary read or weaker project-containment check.

The alpha has two additional parity limitations: it emits `useMxc` but ignores
it when selecting the execution backend, and it maps an external sandbox profile
to generic read-only permissions rather than reproducing the external sandbox.
An absolute CLI path alone does not fix those limitations.

Do not infer the full CLI from `codexLinuxSandboxExe`, look it up on PATH, scan
session logs, infer the newest session/project, or add readable roots to make a
failed invocation pass. Do not combine the state argument with `--cd`,
`--permission-profile`, or `--include-managed-config`.

## Compatibility choices still requiring integration evidence

1. New host: use the host-provided absolute executable, after validating the
   transport and launch contract. Forward the complete state unchanged.
2. Old host: an operator could explicitly bind an absolute executable and its
   verified SHA-256 at installation time. This is a separately configured
   compatibility adapter, not an automatic fallback. It needs a tested version
   matrix and a defined update/revalidation policy. Hash verification alone does
   not prove sandbox parity and does not eliminate a file replacement race.
3. Without either supported adapter, metadata-bearing execution must fail closed.
   This is a safety boundary, **not** a fix for alpha17.2 usability.

No new per-request MCP restart is proposed: that would add startup latency and
lifecycle risks to a task whose primary goal is responsive execution. A future
adapter should wrap existing owned process execution, preserving Windows Job
ownership, timeout/cancellation, stdout decoding and cleanup semantics.

## Windows capability observation (2026-10-11)

An isolated probe against Desktop `0.162.0-alpha.17.2` advertised the capability
and made direct `mcpServer/tool/call` RPCs from two ephemeral threads with
different Chinese/space-containing working directories. Those calls carried
`threadId` and `progressToken` only; they did not carry sandbox state, sandbox
cwd or a trusted executable. The MCP process cwd remained its isolated home.
The process had an ordinary Windows token, not a restricted/AppContainer token.

This direct RPC does not exercise the model's MCP tool handler. The observation
therefore does **not** prove that the model-driven path lacks metadata. It also
does not establish a working sandbox execution adapter. No model turn was used
for this probe, and this candidate does not enable the experimental capability
or claim to fix the current alpha host's file-entry behavior.

Before enabling the capability, test actual denied reads (including a replaced
file/symlink target), relative and absolute paths, out-of-project authorized and
denied files, every execution/file indexing route, compiler stages, parallel
projects, request cancellation, timeout recovery, and Windows child ownership.
Mocked command arguments and Linux tests alone are not Windows sandbox evidence.

## Minimal next Windows acceptance pass

- Keep the already accepted installation untouched. Verify the candidate commit,
  its parent, and the unchanged Windows ownership/timeout/Unicode helper files.
- Rebuild in an isolated candidate using the accepted stage's recorded dependency
  versions. The repository CI uses `npm install`; the presence of `bun.lock` does
  not prove which dependency versions produced the accepted bundle. Do not
  publish unrelated dependency or generated-bundle changes without review.
- Run the new real-tool project A/B regressions, scoped statistics and purge
  checks, unavailable-storage checks, and metadata/Windows-path unit tests under
  an isolated home. Include Chinese and space-containing project directories.
- Verify a cancelled/timed-out A request is followed by a successful B request
  without changing attribution or the parent process directory. Existing
  Windows Job/lifecycle tests need repeating if their executable, source,
  dependencies or launch path changes, not merely because this parser exists.
- If further host capability proof is requested, test the model-driven handler
  separately from direct RPC using synthetic fixtures and explicit authorization
  for that model turn. Do not enable sandbox execution or expand permissions to
  make a probe succeed. Record the actual fields delivered and version.

This source-only candidate retains the accepted generated bundles. It must be
rebuilt and accepted before deployment; launching its old `server.bundle.mjs`
does not exercise the new source changes.
