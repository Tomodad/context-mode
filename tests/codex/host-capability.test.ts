import { beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Keep only this test's small evidence fixture, outside the checkout. No user
// configuration or shared host cache is read, written or removed.
const fixture = mkdtempSync(join(resolve(repo, ".."), "codex-host-capability-"));
const cachePath = join(fixture, "context-mode-codex-caps.json");
const legacyCache = JSON.stringify({ at: Date.now(), supported: true });
writeFileSync(cachePath, legacyCache);
const home = join(fixture, "home");
const project = join(fixture, "project");
mkdirSync(home); mkdirSync(project);
let caps: any;
beforeAll(async () => { caps = await import("../../hooks/core/codex-caps.mjs"); });

describe("unverified running Codex host capability", () => {
  it("does not treat a modern PATH CLI as running-host evidence or run the probe", () => {
    const runVersion = vi.fn(() => "codex-cli 99.999.0");
    expect(caps.codexSupportsUpdatedInput({ runVersion, cachePath })).toBe(false);
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("ignores a fresh supported shared-cache record without mutating it", () => {
    expect(caps.codexSupportsUpdatedInput({ cachePath, now: () => Date.now() })).toBe(false);
    expect(readFileSync(cachePath, "utf8")).toBe(legacyCache);
    const absent = join(fixture, "absent-cache.json");
    expect(caps.codexSupportsUpdatedInput({ cachePath: absent })).toBe(false);
    expect(existsSync(absent)).toBe(false);
  });

  it("reports unverified, rather than claiming the actual host is unsupported", () => {
    expect(typeof caps.getCodexRewriteCapability).toBe("function");
    const capability = caps.getCodexRewriteCapability();
    expect(capability.status).toBe("unverified");
    expect(capability.supportsUpdatedInput).toBe(false);
    expect(Object.isFrozen(capability)).toBe(true);
  });

  it("does not accept ordinary capability flags or invoke legacy IO getters", () => {
    const untrusted = { supported: true, codexSupportsRewrite: true,
      get runVersion(): never { throw new Error("must not inspect legacy IO"); } };
    expect(caps.codexSupportsUpdatedInput(untrusted)).toBe(false);
  });

  function hook(tool_name: string, tool_input: Record<string, string>) {
    // Preserve OS environment (including SystemRoot) while isolating every
    // supported home/temp/project path used by the raw hook.
    return spawnSync(process.execPath, [join(repo, "hooks/codex/pretooluse.mjs")], {
      cwd: project, env: { ...process.env, HOME: home, USERPROFILE: home,
        CODEX_HOME: home, TEMP: fixture, TMP: fixture, TMPDIR: fixture },
      input: JSON.stringify({ tool_name, tool_input,
        cwd: project, session_id: "owned-host-capability-fixture" }),
      encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
  }

  it("raw hook retains the existing Codex Shell passthrough owned by RTK", () => {
    const result = hook("exec_command", { command: "curl https://example.invalid/large-response" });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout).hookSpecificOutput;
    expect(response.permissionDecision).toBeUndefined();
    expect(response).not.toHaveProperty("updatedInput");
    expect(response).not.toHaveProperty("additionalContext");
    expect(readFileSync(cachePath, "utf8")).toBe(legacyCache);
  });

  it("raw hook drops an advisory Agent rewrite despite a fresh supported cache", () => {
    const result = hook("Agent", { prompt: "Inspect this isolated project." });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout).hookSpecificOutput;
    expect(response.permissionDecision).toBeUndefined();
    expect(response).not.toHaveProperty("updatedInput");
    expect(response).not.toHaveProperty("additionalContext");
    expect(readFileSync(cachePath, "utf8")).toBe(legacyCache);
  });

  it("raw hook still permits a normal passthrough command", () => {
    const result = hook("exec_command", { command: "git status --short" });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout).hookSpecificOutput;
    expect(response.permissionDecision).toBeUndefined();
    expect(response).not.toHaveProperty("updatedInput");
  });
});
