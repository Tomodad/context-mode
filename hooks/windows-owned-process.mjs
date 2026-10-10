import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const owned = new WeakSet();
const stopping = new WeakMap();
const identities = new Map();
const unavailable = new Set();
function helperPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const parent of [here, resolve(here, '..'), resolve(here, '../..')]) {
    const file = join(parent, 'hooks', 'windows-process-job.ps1');
    if (existsSync(file)) return file;
  }
  throw new Error('Windows process Job helper missing');
}
function cacheIdentity(hooks) {
  const framework=join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET',process.arch==='x64'?'Framework64':'Framework','v4.0.30319');
  try {
    const sources=['windows-process-job.cs','windows-job-entry.cs','windows-job-cache-worker.mjs','windows-owned-process.mjs'].map(file=>join(hooks,file));
    const systemFiles=['csc.exe','mscorlib.dll','System.dll','clr.dll'].map(file=>join(framework,file));
    const sourceDigest=createHash('sha256');for(const file of sources) sourceDigest.update(file+'\0').update(readFileSync(file));
    const sourceKey=sourceDigest.digest('hex');
    const systemStamp=systemFiles.map(file=>{const s=statSync(file);return file+':'+s.size+':'+s.mtimeMs+':'+s.ctimeMs}).join('\0');
    const previous=identities.get(hooks);
    if(previous?.sourceKey===sourceKey && previous.systemStamp===systemStamp) return previous;
    const digest=createHash('sha256').update('CMJ1\0'+process.arch+'\0'+framework+'\0'+sourceKey+'\0');
    // Fixed, bounded framework/source paths; no ambient compiler discovery.
    for(const file of systemFiles) {
      digest.update(file+'\0').update(readFileSync(file));
    }
    const identity={key:digest.digest('hex'),framework,sourceKey,systemStamp};identities.set(hooks,identity);return identity;
  } catch { return null; }
}
function cachedHelper(hooks,identity=cacheIdentity(hooks)) {
  if(!identity) return null;
  if(unavailable.has(identity.key)) return null;
  try {
    const cache=join(hooks,'.windows-job-cache'),marker=join(cache,identity.key+'.json');
    if(statSync(marker).size>4096) return null;
    const metadata=JSON.parse(readFileSync(marker,'utf8'));
    if(metadata.key!==identity.key || !new RegExp('^'+identity.key+'-[0-9a-f-]{36}/job\\.exe$').test(metadata.relative) || !/^[0-9a-f]{64}$/.test(metadata.sha256)) return null;
    const exe=join(cache,metadata.relative),size=statSync(exe).size;
    if(size!==metadata.bytes || size>10485760) return null;
    if(createHash('sha256').update(readFileSync(exe)).digest('hex')!==metadata.sha256) return null;
    return exe;
  } catch { return null; }
}
export async function prepareWindowsJobHelper({timeoutMs = 30_000, signal} = {}) {
  validateDeadline(timeoutMs);
  if(signal?.aborted) return false;
  if(process.platform!=='win32') return false;
  const hooks=dirname(helperPath()),identity=cacheIdentity(hooks);
  if(!identity) return false;
  if(unavailable.has(identity.key)) return false;
  if(cachedHelper(hooks,identity)) return true;
  // First build uses the PowerShell path. The cache worker and its compiler
  // run in the named Job once PowerShell has loaded the Job implementation.
  // Initial Add-Type compilation happens before that Job exists.
  const proc=spawnWindowsOwned(process.execPath,[join(hooks,'windows-job-cache-worker.mjs'),hooks,identity.key,identity.framework],{
    cwd:hooks,env:process.env,jobName:'Local\\ContextModeHelperBuild-'+identity.key,terminateDescendantsOnRootExit:true,
  });
  proc.stdout.resume();proc.stderr.resume();
  const result=await waitWindowsOwned(proc,{timeoutMs,signal});
  return !result.terminationUncertain && !result.timedOut && !result.cancelled && result.code===0 && cachedHelper(hooks,identity)!==null;
}
function validateDeadline(timeoutMs) {
  if(!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) throw new RangeError('Windows owned process deadline must be finite and non-negative');
}
export function waitWindowsOwned(proc, {timeoutMs, signal}) {
  if(!owned.has(proc)) throw new Error('Refusing to wait on an unowned Windows process');
  validateDeadline(timeoutMs);
  return new Promise(resolveDone => {
    let timedOut=false, cancelled=false, error, grace, settled=false;
    const finish=(code,terminationUncertain=false) => {
      if(settled) return;settled=true;
      clearTimeout(timer);clearTimeout(grace);signal?.removeEventListener('abort',stop);
      proc.removeListener('error',onError);proc.removeListener('close',onClose);
      if(terminationUncertain) {
        // Bound even a missing close/failed OS termination. Keep the result
        // explicitly uncertain; do not publish readiness or release a Job gate.
        proc.stdin.destroy();proc.stdout.destroy();proc.stderr.destroy();proc.unref();
        proc.on('error',()=>{});
      }
      resolveDone({code,timedOut,cancelled,terminationUncertain,...(error?{error}:{})});
    };
    const requestStop=() => {
      stopWindowsOwned(proc);
      grace??=setTimeout(()=>finish(null,true),1500);
    };
    const stop=() => { cancelled=true; requestStop(); };
    const timer=setTimeout(() => { timedOut=true; requestStop(); },timeoutMs);
    const onError=err => { error=err; };
    const onClose=code=>finish(code);
    proc.once('error',onError);
    proc.once('close',onClose);
    signal?.addEventListener('abort',stop,{once:true});
    if(signal?.aborted) stop();
  });
}
function binaryRequest(request) {
  const header=Buffer.alloc(4);header.writeInt32LE(0x314a4d43);
  const fields=[request.exe,request.commandLine,request.cwd,request.environmentBlock,request.jobName].flatMap(value=>{
    const bytes=Buffer.from(value,'utf8');if(bytes.length>4194304) throw new Error('Windows Job request field too large');
    const size=Buffer.alloc(4);size.writeInt32LE(bytes.length);return [size,bytes];
  });
  return Buffer.concat([header,...fields,Buffer.from([request.terminateDescendantsOnRootExit?1:0])]);
}
export function quoteWindowsArgument(value) {
  if (value !== '' && !/[\s"]/u.test(value)) return value;
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
function executable(command, cwd, env) {
  if (isAbsolute(command) || /[\\/]/.test(command)) return resolve(cwd, command);
  const path = env.PATH ?? Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const folder of [cwd, ...path.split(';')]) {
    for (const suffix of /\.exe$/i.test(command) ? [''] : ['.exe', '']) {
      const file = resolve(folder, command + suffix);
      if (existsSync(file)) return file;
    }
  }
  // CreateProcess supplies a precise error. No shell or ambient PATH fallback.
  return resolve(cwd, command + (/\.exe$/i.test(command) ? '' : '.exe'));
}
export function repairJobName(root) {
  return 'Local\\ContextModeRepair-' + createHash('sha256').update(resolve(root).toLowerCase()).digest('hex');
}
export function spawnWindowsOwned(command, args, options) {
  const { cwd, env, shell = false, jobName = '', terminateDescendantsOnRootExit = false } = options;
  const exe = executable(shell ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') : command, cwd, env);
  let commandLine;
  if (shell) {
    const script = [command, ...args].map(value => '"' + value.replace(/"/g, '""') + '"').join(' ');
    commandLine = quoteWindowsArgument(exe) + ' /d /s /c "' + script + '"';
  } else if (/^cmd(\.exe)?$/i.test(basename(exe)) && args.some(value => value.toLowerCase() === '/c')) {
    // cmd parses its /c tail itself, rather than CommandLineToArgvW quoting.
    const index = args.findIndex(value => value.toLowerCase() === '/c');
    const tail = args.slice(index + 1);
    commandLine = [quoteWindowsArgument(exe), ...args.slice(0,index+1)].join(' ') + ' "' + tail.map(value => '"' + value + '"').join(' ') + '"';
  } else commandLine = [exe, ...args].map(quoteWindowsArgument).join(' ');
  const entries = new Map();
  const pathEntry = Object.entries(env).find(([key]) => key === 'PATH') ?? Object.entries(env).find(([key]) => key.toLowerCase() === 'path');
  for (const [key,value] of Object.entries(env)) if (value !== undefined) {
    if (/[=\0]/.test(key) || String(value).includes('\0')) throw new Error('Invalid Windows environment entry');
    if (key.toLowerCase() === 'path') continue;
    entries.set(key.toLowerCase(), [key,String(value)]);
  }
  if (pathEntry) entries.set('path',['PATH',String(pathEntry[1])]);
  const environmentBlock = [...entries.values()].sort(([a],[b]) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0).map(([key,value]) => key + '=' + value).join('\0') + '\0\0';
  const script=helperPath(),cached=cachedHelper(dirname(script));
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const request={exe,commandLine,cwd,environmentBlock,jobName,terminateDescendantsOnRootExit};
  const input=cached?binaryRequest(request):JSON.stringify(request)+'\n';
  const proc = spawn(cached??powershell, cached?[]:['-NoProfile','-NonInteractive','-File',script], {
    cwd, windowsHide:true, stdio:['pipe','pipe','pipe'],
  });
  owned.add(proc);
  if(cached) proc.once('error', () => {
    // A creation error means no helper/target started. Disable this cache for
    // subsequent calls. Never replay an already-started user command.
    const identity=cacheIdentity(dirname(script));if(identity) unavailable.add(identity.key);
  });
  proc.stdin.on('error', () => {}); // helper policy/creation failure may close input
  proc.stdin.write(input);
  return proc;
}
export function stopWindowsOwned(proc) {
  if (!owned.has(proc)) throw new Error('Refusing to stop an unowned Windows process');
  if (stopping.has(proc) || proc.exitCode !== null || proc.signalCode !== null) return;
  // The pipe is also closed by the kernel on host death. The helper's Job
  // remains alive until every owned descendant has terminated.
  proc.stdin.end();
  // A wedged managed helper must not survive a requested stop forever. This
  // handle is the exact ChildProcess we created, never a PID reopened by name.
  // Atomic Job membership makes helper hard death close/kill its owned tree.
  const timer = setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); }, 1200);
  timer.unref(); stopping.set(proc,timer);
  proc.once('close', () => { clearTimeout(timer); stopping.delete(proc); });
}
