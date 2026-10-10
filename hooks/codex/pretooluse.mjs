#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
/**
 * Codex CLI preToolUse hook for context-mode.
 *
 * Command rewrites require evidence about the actual running host, rather than
 * an independently installed PATH CLI. codex-caps.mjs currently reports this
 * contract as unverified, so command redirects returned by routing emit deny
 * plus guidance. Existing RTK-owned Shell passthrough is unchanged. No ordinary
 * input/configuration flag enables allow+updatedInput. `ask` remains unsupported.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdin, parseStdin, getInputProjectDir, getSessionId, CODEX_OPTS } from "../session-helpers.mjs";
import { routePreToolUse, initSecurity } from "../core/routing.mjs";
import { formatDecision } from "../core/formatters.mjs";
import { codexSupportsUpdatedInput } from "../core/codex-caps.mjs";

const __hookDir = dirname(fileURLToPath(import.meta.url));
await initSecurity(resolve(__hookDir, "..", "..", "build"));

const raw = await readStdin();
const input = parseStdin(raw);
const tool = input.tool_name ?? "";
const toolInput = input.tool_input ?? {};
const projectDir = getInputProjectDir(input, CODEX_OPTS);

const decision = routePreToolUse(tool, toolInput, projectDir, "codex", getSessionId(input, CODEX_OPTS));
// Only modify/context need the host-contract guard. The guard does not spawn a
// CLI or read a shared cache; deny / ask / passthrough keep their existing shape.
const needsCaps = decision && (decision.action === "modify" || decision.action === "context");
const response = formatDecision(
  "codex",
  decision,
  needsCaps ? { codexSupportsRewrite: codexSupportsUpdatedInput() } : {},
);
const output = response ?? {
  hookSpecificOutput: { hookEventName: "PreToolUse" },
};
process.stdout.write(JSON.stringify(output) + "\n");
