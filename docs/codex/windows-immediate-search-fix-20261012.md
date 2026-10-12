# Immediate scoped search acceptance - 2026-10-12

This version extends commit `778b76141ab49fb5e8e4895340b900373e4d77eb` with an additional immediate-search fix. The earlier acceptance document describes that base commit, not this version's bundle hashes.

An embedded request can finish indexing before deferred session accounting persists its session ID. Shared-mode search then builds an empty session allow-set and misses content that the same request just indexed. The added fix includes the exact scoped session only when the requested project matches that request's project. Timeline search receives the same precomputed filter.

Two new regression tests pass for relevance and timeline search, including parallel projects sharing a session ID and explicit other-project exclusion. Previously accepted source tests were not repeated.

The candidate still does not advertise or implement `codex/sandbox-state-meta` execution. It does not claim automatic Codex Desktop workspace identity resolution or Native sandbox enforcement. Those baseline integration limitations remain separate work.

Final bundles:

- `server.bundle.mjs`: SHA256 `e674d437fd04027d4624243cd05ff3e314bfa968a002dcee9de08c3b30683503`.
- `cli.bundle.mjs`: SHA256 `86964ff5282ae9114ed018272d1a640196bfdaaa8149e7aed379f8acc245c227`.

The packaged default MCP route and CLI route expose the same eleven tools as the installed baseline. Exact copies of the baseline runtime dependencies were used for the package checks. A Windows replacement and rollback rehearsal changed only these two bundle files; all 1,752 files returned to their original bytes after rollback. Additional native helper and package-member assertions passed.

Final package hashes, copied runtime dependency hashes, protocol verification and rollback evidence are recorded in the local replacement manifest. The source, final package and two-bundle overlay must be retained together.
