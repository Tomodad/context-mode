---
name: ctx-purge
description: Delete explicitly scoped context-mode data on user request. This is irreversible. Trigger: /context-mode:ctx-purge.
user-invocable: true
---

# Purge an explicit scope

- Resolve scope from the user's request. Ask only if session/project scope
  or the target session is ambiguous; state the irreversible effect.
- For one session, use `{ confirm: true, sessionId: "<id>" }`.
- For the complete project, use `{ confirm: true, scope: "project" }`.
- Do not combine a session ID with project scope, and do not use a bare
  `{ confirm: true }` that silently selects a wider default.
- Report what was actually deleted. Do not purge to repair a timeout,
  improve routing, or start a new conversation without explicit authority.
- `/clear` and `/compact` preserve the CTX store; `ctx_stats` is read-only.
