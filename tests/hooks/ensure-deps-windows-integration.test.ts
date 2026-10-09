/** Execute the real bootstrap functions with Windows paths and inert process I/O.
 * These are cross-platform logic checks, not a substitute for Windows execution.
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../hooks/ensure-deps.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/const __dirname = .*;/, 'const __dirname = "C:\\\\plugin space\\\\hooks";')
  .replace(/^export /gm, "")
  .split("// Auto-run on import")[0];

function harness(options: { version?: string; npmCli?: boolean; env?: Record<string, string> } = {}) {
  const files = new Set<string>();
  const execPath = "C:\\Node Space\\node.exe";
  const npmCli = win32.resolve(win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (options.npmCli !== false) files.add(npmCli);
  const execFileSync = vi.fn();
  const execSync = vi.fn();
  const write = vi.fn();
  const context = {
    ...win32, execFileSync, execSync,
    existsSync: (path: string) => files.has(path),
    copyFileSync: vi.fn(), renameSync: vi.fn(), unlinkSync: vi.fn(),
    createRequire: () => () => { throw new Error("incompatible test binding"); },
    process: {
      execPath, platform: "win32", pid: 1234,
      versions: { node: options.version ?? "24.19.0", modules: "137" },
      env: options.env ?? { PATH: "C:\\Windows\\System32", KEEP: "unchanged" },
      stderr: { write },
    },
  };
  const api = runInNewContext(source + "\n({ensureDeps, ensureNativeCompat, root})", context);
  return { ...context, ...api, files, npmCli, write };
}

describe("integrated Windows dependency bootstrap", () => {
  test("missing package runs the current Node's npm CLI in the plugin cwd", async () => {
    const h = harness();
    await h.ensureDeps();
    const [file, args, opts] = h.execFileSync.mock.calls[0];
    expect(file).toBe(h.process.execPath);
    expect(args).toEqual([h.npmCli, "install", "better-sqlite3", "--no-package-lock", "--no-save", "--silent"]);
    expect(opts.cwd).toBe("C:\\plugin space");
    expect(opts.shell ?? false).toBe(false);
    expect(opts.windowsHide).toBe(true);
  });

  test("missing npm CLI retains the Windows shim fallback and diagnoses failure", async () => {
    const h = harness({ npmCli: false });
    h.execFileSync.mockImplementation(() => { throw new Error("install test failure"); });
    await h.ensureDeps();
    expect(h.execFileSync.mock.calls[0][0]).toBe("npm.cmd");
    expect(h.execFileSync.mock.calls[0][2]).toMatchObject({ cwd: h.root, shell: true, windowsHide: true });
    expect(h.write.mock.calls[0][0]).toContain("install test failure");
  });

  test.each(["24.19.0", "20.20.0"])("ABI rebuild on Node %s pins PATH, preserves Path-only environment, and hides its console", (version) => {
    const h = harness({ version, env: { Path: "C:\\Windows\\System32;C:\\Tools", KEEP: "unchanged" } });
    const root = "C:\\project space";
    h.files.add(win32.resolve(root, "node_modules", "better-sqlite3", "build", "Release"));
    h.ensureNativeCompat(root);
    expect(h.execSync).toHaveBeenCalledOnce();
    const opts = h.execSync.mock.calls[0][1];
    expect(opts.env.PATH).toBe("C:\\Node Space;C:\\Windows\\System32;C:\\Tools");
    expect(opts.env.Path).toBeUndefined();
    expect(opts.env.KEEP).toBe("unchanged");
    expect(opts.windowsHide).toBe(true);
  });

  test("legacy ABI probe uses the running Node and hides its console", () => {
    const h = harness({ version: "20.20.0" });
    const root = "C:\\project space";
    const dir = win32.resolve(root, "node_modules", "better-sqlite3", "build", "Release");
    h.files.add(dir);
    h.files.add(win32.resolve(dir, "better_sqlite3.node"));
    h.ensureNativeCompat(root);
    expect(h.execFileSync.mock.calls[0][0]).toBe(h.process.execPath);
    expect(h.execFileSync.mock.calls[0][2]).toMatchObject({ cwd: root, windowsHide: true });
    expect(h.execSync).not.toHaveBeenCalled();
  });
});
