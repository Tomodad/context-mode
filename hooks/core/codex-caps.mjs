/**
 * Running-host capability guard for the Codex PreToolUse formatter (#845).
 *
 * Recent Codex builds honor PreToolUse `permissionDecision:"allow" + updatedInput`
 * (command rewrite) and `additionalContext`. Older builds reject/ignore those
 * fields. context-mode must emit the rewrite shape ONLY when the running Codex
 * supports it and otherwise fail closed (deny) — it must never silently pass a
 * redirect through.
 *
 * A CLI found on PATH is not necessarily the binary running a desktop hook.
 * Its version, and a shared cached result from another host, cannot establish
 * this host's contract. No verified running-host capability source is currently
 * connected, so production redirects fail closed with the existing guidance.
 * This guard performs no process probes, cache IO, or configuration overrides.
 */

/**
 * Historical CLI threshold retained for diagnostic/helper compatibility.
 * Comparing a PATH CLI to this value does not verify the running host.
 */
export const MIN_REWRITE_VERSION = [0, 141, 0];

const UNVERIFIED_CAPABILITY = Object.freeze({
  status: "unverified",
  supportsUpdatedInput: false,
  reason: "The running Codex host's rewrite contract has not been verified.",
});

/** Parse a `codex --version` line ("codex-cli 0.141.0") → [major, minor, patch]. */
export function parseCodexVersion(raw) {
  const s = String(raw ?? "");
  const isDigit = (c) => c >= "0" && c <= "9";
  for (let i = 0; i < s.length; i++) {
    let j = i;
    const parts = [];
    while (parts.length < 3) {
      const start = j;
      while (j < s.length && isDigit(s[j])) j++;
      if (j === start) break; // no digits where a number was expected
      parts.push(Number(s.slice(start, j)));
      if (parts.length < 3) {
        if (s[j] !== ".") break; // separator must be a dot
        j++;
      }
    }
    if (parts.length === 3) return parts;
  }
  return null;
}

/** Semantic ">=" over [major, minor, patch] tuples. */
export function versionGte(a, b) {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

/** Current evidence state, distinct from a claim that the host is unsupported. */
export function getCodexRewriteCapability() {
  return UNVERIFIED_CAPABILITY;
}

/**
 * Boolean compatibility API used by the raw hook. False currently means the
 * actual host is unverified. CLI diagnostic versions and old shared caches are
 * deliberately ignored, including legacy IO arguments supplied by callers.
 *
 * @param {object} [_legacyIo] ignored; retained for call-site compatibility
 * @returns {boolean}
 */
export function codexSupportsUpdatedInput(_legacyIo = {}) {
  return getCodexRewriteCapability().supportsUpdatedInput;
}
