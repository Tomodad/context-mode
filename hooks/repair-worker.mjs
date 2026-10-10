import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { withRepairGate } from './repair-gate.mjs';
import { ensureDeps, ensureNativeCompat, probeNativeInChildProcess } from './ensure-deps.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const startupPackages = ['turndown','turndown-plugin-gfm','@mixmark-io/domino'];
const result = await withRepairGate(root, async () => {
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
});
// No subprocess output/environment in the public result. The parent waits for
// the Job to empty even if the worker exits with an installer still running.
process.stdout.write(JSON.stringify({ status:result.status, key:result.key }) + '\n');
process.exitCode = ['success','inflight','backoff'].includes(result.status) ? 0 : 1;
