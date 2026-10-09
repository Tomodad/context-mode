// Run without a server build: node --test tests/hooks/codex-rtk-coexistence.test.mjs
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runtime = mkdtempSync(join(tmpdir(), "ctx-rtk-contract-"));
const savedEnv = { ...process.env };
process.env.CODEX_HOME = runtime;
process.env.CLAUDE_CONFIG_DIR = runtime;
process.env.CONTEXT_MODE_PLATFORM = "codex";
process.env.CONTEXT_MODE_MCP_SENTINEL_DIR = runtime;
after(() => {
  for (const key of ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "CONTEXT_MODE_PLATFORM", "CONTEXT_MODE_MCP_SENTINEL_DIR"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(runtime, { recursive: true, force: true });
});
const { routePreToolUse, initSecurity } = await import("../../hooks/core/routing.mjs");
const { createCodexRoutingBlock, createRoutingBlock } = await import("../../hooks/routing-block.mjs");
const { createToolNamer } = await import("../../hooks/core/tool-naming.mjs");
const { sentinelPathForPid } = await import("../../hooks/core/mcp-ready.mjs");
writeFileSync(sentinelPathForPid(process.pid), String(process.pid));
assert.equal(await initSecurity(join(root, "build")), true);

test("Codex gets compact capabilities while shared routing remains", () => {
  const compact = createCodexRoutingBlock(createToolNamer("codex"));
  assert.ok(compact.length < 1000);
  assert.match(compact, /RTK native hook/);
  assert.doesNotMatch(compact, /tool_selection_hierarchy|ctx purge|artifact_policy/);
  assert.match(createRoutingBlock(createToolNamer("claude-code")), /tool_selection_hierarchy/);
});

test("Codex Shell aliases pass through without competing rewrite or advice", () => {
  for (const tool of ["Bash", "Shell", "exec_command", "shell_command", "local_shell"]) {
    for (const command of ["git status --short", "curl https://example.invalid", "gradle test", "rtk git status"]) {
      assert.equal(routePreToolUse(tool, { command, cmd: command }, runtime, "codex"), null);
    }
  }
});

test("Codex read, search, fetch and external MCP omit routing advice", () => {
  const large = join(runtime, "large.txt");
  writeFileSync(large, "a".repeat(60000));
  for (const [tool, input] of [["Read", { file_path: large }], ["Grep", { pattern: "a" }],
    ["WebFetch", { url: "https://example.invalid" }], ["mcp__slack__list_channels", {}]]) {
    for (let n = 0; n < 12; n++) assert.equal(routePreToolUse(tool, input, runtime, "codex"), null);
  }
});

test("explicit Shell deny and ask policies still precede passthrough", () => {
  const policyProject = join(runtime, "policies");
  mkdirSync(policyProject);
  writeFileSync(join(policyProject, "settings.json"), JSON.stringify({
    permissions: { deny: ["Bash(echo denied*)"], ask: ["Bash(echo ask*)"] },
  }));
  // Use the platform-global settings path as Codex actually does.
  writeFileSync(join(runtime, "settings.json"), readFileSync(join(policyProject, "settings.json")));
  assert.equal(routePreToolUse("exec_command", { cmd: "echo denied" }, policyProject, "codex")?.action, "deny");
  assert.equal(routePreToolUse("Bash", { command: "echo ask" }, policyProject, "codex")?.action, "ask");
});

test("CTX executor still enforces explicit command security", () => {
  assert.equal(routePreToolUse("mcp__context-mode__ctx_execute", {
    language: "shell", code: "echo denied",
  }, runtime, "codex")?.action, "deny");
});

test("non-Codex web output redirect and MCP advice remain", () => {
  assert.equal(routePreToolUse("WebFetch", { url: "https://example.invalid" }, runtime, "claude-code")?.action, "deny");
  assert.equal(routePreToolUse("mcp__slack__list_channels", {}, runtime, "claude-code")?.action, "context");
});

test("manifest selects eight focused Codex skills with complete metadata", () => {
  const manifest = JSON.parse(readFileSync(join(root, ".codex-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.skills, "./.codex-plugin/skills/");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("docs/codex"), "Package includes the skill's linked reference");
  const skills = resolve(root, manifest.skills);
  const names = readdirSync(skills);
  assert.equal(names.length, 8);
  for (const name of names) {
    const text = readFileSync(join(skills, name, "SKILL.md"), "utf8");
    assert.match(text, new RegExp(`^---\\r?\\nname: ${name}\\r?\\ndescription: .+`));
  }
});
