import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { spawnWindowsOwned, repairJobName } from './windows-owned-process.mjs';
export function runWindowsRepair(root, {startupDeps = false} = {}) {
  const canonicalRoot = realpathSync(root);
  const proc = spawnWindowsOwned(process.execPath, [...(typeof globalThis.Bun === 'undefined' ? ['--experimental-sqlite'] : []), resolve(canonicalRoot,'hooks','repair-worker.mjs'), ...(startupDeps ? ['--startup-deps'] : [])], {
    cwd:canonicalRoot, env:process.env, jobName:repairJobName(canonicalRoot), terminateDescendantsOnRootExit:true,
  });
  let output = '', diagnostic = '';
  proc.stdout.on('data', chunk => { if (output.length < 8192) output += chunk.toString('utf8'); });
  proc.stderr.on('data', chunk => { if (diagnostic.length < 8192) diagnostic += chunk.toString('utf8'); });
  return new Promise(resolveResult => {
    // Existing per-operation install/heal/probe deadlines run inside the gate,
    // so controlled failures reach its backoff writer. No external timer kills
    // the lock owner before that writer; host death still closes Job control.
    proc.once('error', () => resolveResult({status:'helper-failure'}));
    proc.once('close', code => {
      if (code === 75) return resolveResult({status:'inflight'});
      try { const result = JSON.parse(output.trim()); resolveResult(code === 0 ? result : {status:'failure'}); }
      catch { resolveResult({status:'helper-failure', diagnostic:diagnostic.split(/\r?\n/).filter(line => line.startsWith('[context-mode job]')).join('\n')}); }
    });
  });
}
