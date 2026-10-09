---
name: ctx-index
description: Index specified local material for future context-mode queries. Trigger: /context-mode:ctx-index.
user-invocable: true
---

# Index material for retrieval

- Prefer `ctx_index(path: ..., source: ...)` for large inputs.
- Resolve the requested path; clarify only a material ambiguity.
- Bound collection to the task. For a repository, start with `maxDepth: 5`
  and `maxFiles: 200`, adjusting only when the requested scope needs it.
- Exclude secrets, dependency trees, build products, and generated noise.
- Do not re-index a tool result already visible in the conversation without
  a concrete need for persistent retrieval.
- Report the source label and actual indexed count. Use a resolved CLI only
  if MCP is unavailable; do not claim indexing succeeded without a result.
