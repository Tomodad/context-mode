---
name: ctx-doctor
description: Inspect context-mode runtime, hooks, and plugin health on explicit request. Trigger: /context-mode:ctx-doctor.
user-invocable: true
---

# Diagnose Context Mode

1. Call `ctx_doctor` and display the returned diagnostic report.
2. If MCP is unavailable, resolve the plugin root and Node executable, then
   run `node <plugin-root>/cli.bundle.mjs doctor`. Use `build/cli.js` only if
   the bundle is absent. This skill directory is three levels below the root.
3. Use PowerShell-compatible invocation on Windows; do not paste POSIX
   variable assignments or nested quoted shell scripts.
4. Diagnosis does not authorize installation, configuration changes, or
   disabling hooks. Explain any recommended repair separately.
5. Do not run doctor as a prerequisite for ordinary CLI work.
