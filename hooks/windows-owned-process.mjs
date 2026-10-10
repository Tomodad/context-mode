import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const owned = new WeakSet();
const stopping = new WeakMap();
const SOURCE_FILES = ['windows-process-job.cs', 'windows-job-entry.cs'];
function helperPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const parent of [here, resolve(here, '..'), resolve(here, '../..')]) {
    const file = join(parent, 'hooks', 'windows-job-runtime.json');
    if (existsSync(file)) return file;
  }
  throw new Error('Windows process Job release asset missing; reinstall a complete release');
}
export function verifiedWindowsJobHelper(hooks = dirname(helperPath())) {
  try {
    const manifest = join(hooks, 'windows-job-runtime.json');
    if (statSync(manifest).size > 4096) throw Error('manifest size');
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    if (metadata.protocol !== 'CMJ1') throw Error('protocol');
    for (const name of SOURCE_FILES) {
      if(statSync(join(hooks,name)).size>1048576) throw Error('source size');
      const text = readFileSync(join(hooks,name), 'utf8').replaceAll('\r\n','\n');
      if (digest(Buffer.from(text)) !== metadata.sources?.[name]) throw Error('source mismatch');
    }
    const exe = join(hooks, 'windows-job-runtime.exe');
    const size = statSync(exe).size;
    if (size !== metadata.bytes || size < 1 || size > 10485760 || digest(readFileSync(exe)) !== metadata.sha256) throw Error('asset mismatch');
    return exe;
  } catch {
    throw new Error('Windows process Job release asset invalid; reinstall a complete release');
  }
}
export async function prepareWindowsJobHelper({timeoutMs = 30_000, signal} = {}) {
  validateDeadline(timeoutMs);
  if (signal?.aborted || timeoutMs === 0 || process.platform !== 'win32') return false;
  // No runtime compiler, cache write, PowerShell or unowned fallback.
  const proc=spawn(verifiedWindowsJobHelper(),['--check'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  owned.add(proc);proc.stdin.on('error',()=>{});
  let output='';proc.stdout.on('data',b=>{if(output.length<32) output+=b.toString('utf8').slice(0,32-output.length);});proc.stderr.resume();
  const result=await waitWindowsOwned(proc,{timeoutMs,signal});
  return result.code===0&&!result.cancelled&&!result.timedOut&&!result.terminationUncertain&&output.trim()==='CMJ1';
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
  const helper = verifiedWindowsJobHelper();
  const request={exe,commandLine,cwd,environmentBlock,jobName,terminateDescendantsOnRootExit};
  const input=binaryRequest(request);
  const proc = spawn(helper, [], {cwd, windowsHide:true, stdio:['pipe','pipe','pipe']});
  owned.add(proc);
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
