---
name: ctx-insight
description: Open the Context Mode Insight dashboard on explicit request. Trigger: /context-mode:ctx-insight.
user-invocable: true
---

# Open Insight

- Call `ctx_insight` only when the user requests the dashboard.
- Report the actual result. If the browser did not open, provide the link
  returned by the tool. Do not infer current pricing or account access.
- Insight is optional; it is not part of CLI routing or local analysis.
