import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const owned = new WeakSet();
const stopping = new WeakMap();
function helperPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const parent of [here, resolve(here, '..'), resolve(here, '../..')]) {
    const file = join(parent, 'hooks', 'windows-process-job.ps1');
    if (existsSync(file)) return file;
  }
  throw new Error('Windows process Job helper missing');
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
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const proc = spawn(powershell, ['-NoProfile','-NonInteractive','-File',helperPath()], {
    cwd, windowsHide:true, stdio:['pipe','pipe','pipe'],
  });
  owned.add(proc);
  proc.stdin.on('error', () => {}); // helper policy/creation failure may close input
  proc.stdin.write(JSON.stringify({exe,commandLine,cwd,environmentBlock,jobName,terminateDescendantsOnRootExit}) + '\n');
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
