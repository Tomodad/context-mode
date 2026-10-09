---
name: ctx-stats
description: Show recorded context-mode statistics on explicit request. Trigger: /context-mode:ctx-stats.
user-invocable: true
---

# Display recorded statistics

- Call `ctx_stats`; it is read-only and does not reset or purge data.
- For this explicit command, show the complete report and one brief
  explanation of the recorded savings metric.
- Treat missing activity as unavailable or empty data, not proof that all
  tool calls were recorded. CTX statistics do not measure RTK's own savings.
- Do not invoke statistics or suggest purging as part of normal routing.
