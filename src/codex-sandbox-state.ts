import { AsyncLocalStorage } from "node:async_hooks";
import { isAbsolute, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export const CODEX_SANDBOX_STATE_META_CAPABILITY = "codex/sandbox-state-meta";
export const CODEX_MCP_CLIENT_NAME = "codex-mcp-client";

export interface CodexRequestExtra {
  _meta?: unknown;
  signal?: AbortSignal;
}

/** A locator and an opaque contract, never an authorization decision. */
export interface CodexRequestContext {
  readonly projectDir: string;
  /** Forward this entire snapshot to the host sandbox, including unknown fields. */
  readonly sandboxStateJson: string;
  readonly codexExecutable?: string;
}

export type CodexMetadataResult =
  | { kind: "absent" }
  | { kind: "invalid"; reason: string }
  | { kind: "present"; context: CodexRequestContext };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Windows root-relative paths depend on the current drive despite isAbsolute. */
export function isFullyQualifiedExecutable(value: string, platform: NodeJS.Platform = process.platform): boolean {
  if (value.includes("\0")) return false;
  if (platform !== "win32") return isAbsolute(value);
  return win32.isAbsolute(value) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(value);
}

/**
 * Parse only the transport envelope and locator. PermissionProfile is opaque:
 * do not interpret its entries as permission to perform a parent-process read.
 * Client name is a protocol compatibility check, not authentication. The MCP
 * connection itself must be trusted by the operator.
 *
 * No stat/realpath, session discovery, PATH lookup, process.chdir or fallback.
 * Codex serializes AbsolutePathBuf as a file: URI, including on Windows.
 */
export function parseCodexRequestContext(
  extra: CodexRequestExtra | undefined,
  clientName: string | undefined,
): CodexMetadataResult {
  const meta = extra?._meta;
  if (meta === undefined) return { kind: "absent" };
  if (!record(meta)) return { kind: "invalid", reason: "Invalid MCP metadata envelope." };
  if (!Object.hasOwn(meta, CODEX_SANDBOX_STATE_META_CAPABILITY)) return { kind: "absent" };
  if (clientName !== CODEX_MCP_CLIENT_NAME) {
    return { kind: "invalid", reason: "Sandbox metadata requires a configured Codex MCP connection." };
  }
  const state = meta[CODEX_SANDBOX_STATE_META_CAPABILITY];
  if (!record(state) || !record(state.permissionProfile)) {
    return { kind: "invalid", reason: "Invalid Codex sandbox state or permissionProfile." };
  }
  if (typeof state.sandboxCwd !== "string" || state.sandboxCwd.includes("\0")) {
    return { kind: "invalid", reason: "Codex sandboxCwd must be an absolute file URI." };
  }
  let projectDir: string;
  try {
    const uri = new URL(state.sandboxCwd);
    if (uri.protocol !== "file:" || uri.search || uri.hash || uri.username || uri.password) throw new Error();
    projectDir = fileURLToPath(uri);
    if (!isAbsolute(projectDir) || projectDir.includes("\0")) throw new Error();
  } catch {
    return { kind: "invalid", reason: "Codex sandboxCwd must be a valid absolute file URI for this operating system." };
  }
  let codexExecutable: string | undefined;
  if (state.codexExecutable !== undefined && state.codexExecutable !== null) {
    if (typeof state.codexExecutable !== "string" || !isFullyQualifiedExecutable(state.codexExecutable)) {
      return { kind: "invalid", reason: "Codex executable must be an absolute host-provided path." };
    }
    codexExecutable = state.codexExecutable;
  }
  try {
    // Wire metadata is JSON. Snapshot before any await to prevent one request
    // mutating another's contract. Never reconstruct a selected field subset.
    const sandboxStateJson = JSON.stringify(state);
    if (!sandboxStateJson) throw new Error();
    return { kind: "present", context: Object.freeze({ projectDir, sandboxStateJson, codexExecutable }) };
  } catch {
    return { kind: "invalid", reason: "Codex sandbox state is not serializable JSON." };
  }
}

const requestContext = new AsyncLocalStorage<CodexRequestContext>();

export function getCodexRequestContext(): CodexRequestContext | undefined {
  return requestContext.getStore();
}

/** Plumbing only: callers must enforce the contract before invoking I/O. */
export function withCodexRequestContext<T>(context: CodexRequestContext, fn: () => T): T {
  return requestContext.run(context, fn);
}

/**
 * Building arguments is deliberately not execution or a permission probe.
 * A caller needs a verified host adapter with lifecycle/cancellation support
 * before using this. Old hosts without a trusted executable fail closed.
 */
export function codexSandboxCommand(context: CodexRequestContext, command: readonly string[]): { executable: string; args: string[] } {
  if (!context.codexExecutable) {
    throw new Error("Codex sandbox execution unavailable: the host did not supply a trusted executable. No PATH or unsandboxed fallback is permitted.");
  }
  if (!isFullyQualifiedExecutable(context.codexExecutable)) {
    throw new Error("Codex executable must be an absolute host-provided path.");
  }
  if (!command.length || !isFullyQualifiedExecutable(command[0]) || command.some(part => part.includes("\0"))) {
    throw new Error("Sandbox child command must use an absolute executable and valid arguments.");
  }
  return {
    executable: context.codexExecutable,
    args: ["sandbox", "--sandbox-state-json", context.sandboxStateJson, "--", ...command],
  };
}
