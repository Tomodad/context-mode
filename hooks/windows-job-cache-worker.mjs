// Only invoked inside the existing owned Job; compiler inherits its ownership.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
const [hooks,key,framework]=process.argv.slice(2);
if(!hooks || !/^[0-9a-f]{64}$/.test(key??'')) process.exit(1);
const cache=path.join(hooks,'.windows-job-cache'), version=key+'-'+randomUUID(), dir=path.join(cache,version);
try {
  fs.mkdirSync(dir,{recursive:true});
  const exe=path.join(dir,'job.exe');
  const result=spawnSync(path.join(framework,'csc.exe'),['/nologo','/noconfig','/nostdlib+','/target:exe','/out:'+exe,
    '/reference:'+path.join(framework,'mscorlib.dll'),'/reference:'+path.join(framework,'System.dll'),
    path.join(hooks,'windows-process-job.cs'),path.join(hooks,'windows-job-entry.cs')],{
    cwd:hooks,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:15000,
  });
  if(result.error || result.status!==0) throw Error('compiler failure');
  const probe=spawnSync(exe,['--check'],{cwd:hooks,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:3000});
  if(probe.error || probe.status!==0 || probe.stdout.toString('utf8').trim()!=='CMJ1') throw Error('helper unavailable');
  const bytes=fs.readFileSync(exe), sha256=createHash('sha256').update(bytes).digest('hex');
  const marker=path.join(cache,version+'.json');
  fs.writeFileSync(marker,JSON.stringify({key,relative:version+'/job.exe',sha256,bytes:bytes.length}));
  // Same-volume atomic complete marker, never publish a partial executable.
  fs.renameSync(marker,path.join(cache,key+'.json'));
} catch {
  // No private command/environment/compiler output in diagnostics.
  console.error('[context-mode job] cached helper build failed');process.exitCode=1;
}
