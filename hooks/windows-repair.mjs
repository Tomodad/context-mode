import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { spawnWindowsOwned, repairJobName, waitWindowsOwned } from './windows-owned-process.mjs';
export async function runWindowsRepair(root, {startupDeps = false, timeoutMs = 180_000, signal, recordTimeout = false} = {}) {
  if(!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) throw new RangeError('Windows repair deadline must be finite and non-negative');
  if(signal?.aborted) return {status:'cancelled'};
  const canonicalRoot = realpathSync(root);
  const proc = spawnWindowsOwned(process.execPath, [...(typeof globalThis.Bun === 'undefined' ? ['--experimental-sqlite'] : []), resolve(canonicalRoot,'hooks','repair-worker.mjs'), ...(recordTimeout ? ['--record-timeout'] : []), ...(startupDeps ? ['--startup-deps'] : [])], {
    cwd:canonicalRoot, env:process.env, jobName:repairJobName(canonicalRoot), terminateDescendantsOnRootExit:true,
  });
  let output = '', diagnostic = '';
  proc.stdout.on('data', chunk => { if (output.length < 8192) output += chunk.toString('utf8'); });
  proc.stderr.on('data', chunk => { if (diagnostic.length < 8192) diagnostic += chunk.toString('utf8'); });
  // Per-operation deadlines still write controlled failures inside the gate.
  // This outer budget also covers a wedged worker/helper. Stop the real Job
  // and await its close before returning; no detached Promise.race timeout.
  const result=await waitWindowsOwned(proc,{timeoutMs,signal});
  if(result.terminationUncertain) return {status:'termination-uncertain',timedOut:result.timedOut,cancelled:result.cancelled};
  if(result.cancelled) return {status:'cancelled'};
  if(result.timedOut) {
    // A killed gate owner cannot write backoff. Reuse the existing owned
    // worker in a no-install mode, only after close, under the same named Job
    // and SQLite gate. A still-live Job/contender fails closed. This additional
    // status-write attempt has its own 10s bound and cannot recurse.
    const backoff=recordTimeout ? null : await runWindowsRepair(canonicalRoot,{recordTimeout:true,startupDeps,timeoutMs:10_000,signal});
    return {status:'timed-out',backoff:backoff?.status??'not-attempted',backoffRecorded:backoff?.failureRecorded===true};
  }
  if(result.error) return {status:'helper-failure'};
  if(result.code===75) return {status:'inflight'};
  try { const parsed=JSON.parse(output.trim()); return result.code===0 || ['failure','state-unavailable'].includes(parsed.status) ? parsed : {status:'failure'}; }
  catch { return {status:'helper-failure', diagnostic:diagnostic.split(/\r?\n/).filter(line => line.startsWith('[context-mode job]')).join('\n')}; }
}
