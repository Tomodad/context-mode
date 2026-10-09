---
name: ctx-upgrade
description: Upgrade context-mode only when requested, preserving local Codex/RTK coexistence patches. Trigger: /context-mode:ctx-upgrade.
user-invocable: true
---

# Upgrade with local patch preservation

1. Confirm the requested target and inspect the current source, installed
   version, and local customization. Preserve a verified rollback copy.
2. Prefer the user's maintained fork when that is their chosen source.
   An official release number alone does not identify local customizations.
3. `ctx_upgrade` may provide a command; inspect its target and effects before
   execution. Do not blindly run a command that replaces the maintained fork
   or overwrites the Codex skills and Hook coexistence patch.
4. If MCP is unavailable, resolve the actual Node executable and plugin
   root before selecting a CLI fallback. This directory is three levels
   below the root. Use host-correct invocation on Windows.
5. Apply only the authorized upgrade, then verify the actual version, skills
   path, Hook trust/load state, Shell rewrite ownership, and retained security
   decisions. Report source checks separately from real-client acceptance.
6. Recommend restarting Codex to load changed metadata. Do not upgrade as a
   side effect of a routing, explanation, or diagnostic request.
