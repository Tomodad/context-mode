# Codex / RTK instruction customization

This fork customization is based on the currently installed context-mode
1.0.169 source at `51a716fd2be075fc71610f876f44ea6895b46970`. It changes Codex
instruction ownership, not the MCP server version or data-processing engine.
Upstream license, authorship, and the behavior of other platforms are retained.

## Ownership

- The RTK native PreToolUse hook is the sole owner of supported Shell
  rewrites. Context Mode still evaluates its explicit Shell security policies
  before returning passthrough in Codex.
- Context Mode provides on-demand analysis and indexed retrieval. Its
  existing PostToolUse and session lifecycle hooks retain event capture and
  resume behavior. Capture is not a promise of complete raw-output retention.
- Native/project authorization and exact-output requirements continue to
  apply. `rtk proxy` selects unfiltered execution; it is not a permission grant.

## Instruction entry points

The Codex manifest selects `.codex-plugin/skills/`, with eight focused skills.
Other platforms keep the original top-level `skills/` directory. Ordinary
CLI work does not trigger the Codex main skill merely because it reads,
tests, builds, fetches, or queries a service.

Codex SessionStart uses a compact capability block. It omits the global
CTX-first hierarchy, unconditional maintenance commands, and unrelated
response-format rules. Codex read/search/web-fetch/external-MCP routing
advice is omitted; the existing security decisions remain in place.
The Codex installer snippet in `configs/codex/AGENTS.md` follows the same
ownership without replacing the user's global/project instructions.

`RTK.md` in this directory is an on-demand reference that can be copied to
the user's Codex home. Any proposed global AGENTS.md remains a separate draft
until the user approves replacing their active file.

## Scope boundaries

This change does not fix FTS oversized-row retrieval, executor deadlines,
Windows orphan-process cleanup, or resume-snapshot output budgets. It does
not merge the earlier data-processing PRs, upgrade npm, or publish a release.
Those maintenance and upgrade tasks require separate work.

## Verification and maintenance

- Run the focused instruction/Hook ownership tests and Codex manifest checks.
- Check the installed Codex skills path and actual Hook load/trust state.
- Check that explicit Shell deny/ask policies still precede passthrough, that
  CTX executor security remains effective, and that non-Codex routing remains.
- Restart Codex to load new manifest/skill metadata. Existing chats can retain
  instructions already injected before this customization.
- A reinstall can overwrite plugin-cache changes. Preserve this branch and
  reapply/verify the customization when later choosing an upgrade source.

The maintained source is the fork branch, not an untracked cache modification.
Installation backups are local artifacts and must not be committed with the
user's configuration, tokens, or session databases.

## Focused validation (2026-10-09)

`node --test tests/hooks/codex-rtk-coexistence.test.mjs` passes seven ownership,
security, platform-isolation, and manifest tests without building the server.
The installed Windows hook programs also pass JSON-stdin protocol checks:
RTK rewrites a supported bare command, leaves existing RTK calls unchanged,
and Context Mode retains an explicit security denial without a competing
Shell rewrite.

An isolated installed SessionStart emits the 545-character capability block
and still records the fixture's AGENTS rule content in its session database.
The installed Codex app-server reports all eight skills from the new Codex
directory enabled, and RTK plus six Context Mode hooks enabled and trusted.
Active global AGENTS, hook registration/configuration, unrelated plugin
manifests, and server/CLI bundles retain their original hashes.

This is targeted module, hook-program, and native-loader acceptance. It does
not prove routing/performance in a restarted interactive conversation. The
full Vitest suite was not run: the installed cache lacks Vitest's CLI payload.
