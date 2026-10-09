---
name: ctx-search
description: Search an existing context-mode index when requested or useful for the current task. Trigger: /context-mode:ctx-search.
user-invocable: true
---

# Search an existing index

- Use `ctx_search` with related questions in one `queries` array.
- Scope with `source` when a label is known; keep queries specific.
- Return the relevant findings and disclose an empty or stale index.
- Do not index new material or reread session history as a mandatory first
  step when the current conversation already supplies sufficient context.
- If the tool is unavailable, load its deferred schema once or use the
  resolved `context-mode search` CLI. A timeout or crash warrants a bounded
  native alternative, not repeated retries.
