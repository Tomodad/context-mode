import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { withRepairGate } from './repair-gate.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const startupPackages = ['turndown','turndown-plugin-gfm','@mixmark-io/domino'];
const result = await withRepairGate(root, async () => {
  if(process.argv.includes('--record-timeout')) {
    // Another repair may have completed between the old Job ending and this
    // status worker acquiring ownership. Check actual health under the same
    // gate before writing an old failure over a newer successful repair.
    try {
      const req=createRequire(resolve(root,'package.json'));
      if(typeof globalThis.Bun==='undefined') {
        const Database=req('better-sqlite3'), db=new Database(':memory:');
        try { db.prepare('SELECT 1').get(); } finally { db.close(); }
      }
      if(process.argv.includes('--startup-deps')) for(const pkg of startupPackages) req(pkg);
      return true;
    } catch { throw Error('overall Windows repair deadline expired'); }
  }
  const { ensureDeps, ensureNativeCompat, probeNativeInChildProcess } = await import('./ensure-deps.mjs');
  await ensureDeps();
  if (process.argv.includes('--startup-deps')) {
    await ensureDeps(startupPackages);
    const req = createRequire(resolve(root,'package.json'));
    // Install errors must reach gate backoff; a healthy native addon alone
    // cannot establish that extraction dependencies are actually usable.
    for (const pkg of startupPackages) req(pkg);
  }
  ensureNativeCompat(root);
  return typeof globalThis.Bun !== 'undefined' || probeNativeInChildProcess(root);
}, {reportFailureWrite:process.argv.includes('--record-timeout')});
// No subprocess output/environment in the public result. The parent waits for
// the Job to empty even if the worker exits with an installer still running.
process.stdout.write(JSON.stringify({ status:result.status, key:result.key, ...(result.failureRecorded!==undefined?{failureRecorded:result.failureRecorded}:{}) }) + '\n');
process.exitCode = ['success','inflight','backoff'].includes(result.status) ? 0 : 1;
