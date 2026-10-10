// Serial Windows-only ownership regressions. Synthetic files/processes only.
// node tests/codex/windows-owned-process.mjs [output.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { spawnWindowsOwned, stopWindowsOwned, repairJobName } from '../../hooks/windows-owned-process.mjs';
import { PolyglotExecutor } from '../../build/executor.js';
if (process.platform !== 'win32') throw Error('Windows-only test');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-job-'));
const rows = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid,0); return true; } catch { return false; } };
const check = (name,passed,detail) => { rows.push({name,passed,detail}); console.log(JSON.stringify({name,passed})); };
async function until(test, ms=10000) { const end=Date.now()+ms; while(Date.now()<end) { if(test()) return; await wait(10); } throw Error('fixture wait deadline'); }
function observe(proc) {
  let stdout='',stderr='';proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);
  const done=new Promise(resolve=>proc.once('close',code=>resolve({code,stdout,stderr})));
  return {proc,done};
}
function owned(code,options={}) { return observe(spawnWindowsOwned(process.execPath,['-e',code],{cwd:root,env:process.env,...options})); }
const runtimes={javascript:process.execPath,typescript:null,python:null,shell:'C:\\Windows\\System32\\cmd.exe',ruby:null,go:null,rust:null,php:null,perl:null,r:null,elixir:null,csharp:null};
const executor = new PolyglotExecutor({runtimes,projectRoot:root});
let cmdResult=await executor.execute({language:'shell',code:'@echo off\nchcp 65001 >nul\necho 中文 café 😀\nexit /b 37\n'});
check('cmd UTF-8 multi-line batch preserves output and exit',cmdResult.exitCode===37&&cmdResult.stdout.includes('中文 café 😀')&&!cmdResult.stderr,cmdResult);
let at=performance.now();
const args=['中文 space','quoted "text"','trailing\\','a\\"b',''];
const p=observe(spawnWindowsOwned(process.execPath,['-e','console.log(JSON.stringify(process.argv.slice(1)));process.stderr.write("ERROR中文\\n");process.exit(37)',...args],{cwd:root,env:process.env}));
let result=await p.done;
check('exit status and Unicode/quote/backslash argv',result.code===37&&JSON.stringify(JSON.parse(result.stdout))===JSON.stringify(args)&&result.stderr.includes('ERROR中文'),{...result,ms:performance.now()-at});
result=await owned('console.log(require("node:fs").readFileSync(0).length)').done;
check('target stdin is NUL',result.code===0&&result.stdout.trim()==='0',result);
for(const [name,env] of [['Path',{Path:path.dirname(process.execPath)}],['PATH',{PATH:path.dirname(process.execPath)}],['conflicting Path/PATH',{PATH:path.dirname(process.execPath),Path:path.join(root,'absent-path')}]]) {
 const platformEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'));
 result=await observe(spawnWindowsOwned('node',['-e','console.log(process.execPath)'],{cwd:root,env:{...platformEnv,...env}})).done;
 check(name+' uses one authoritative PATH',result.code===0&&result.stdout.trim()===process.execPath,result);
}
result=await observe(spawnWindowsOwned(path.join(root,'absent.exe'),[],{cwd:root,env:process.env})).done;
check('creation failure is explicit and no fallback',result.code===1&&result.stderr.includes('CreateProcess with Job membership'),result);
const early=path.join(root,'early-marker');const earlyProc=owned(`require('node:fs').writeFileSync(${JSON.stringify(early)},'ran')`);
stopWindowsOwned(earlyProc.proc);result=await earlyProc.done;
check('EOF during helper startup executes no target',!fs.existsSync(early)&&result.code===1,result);
const prepared=path.join(root,'pre-abort-marker');const pre=new AbortController();pre.abort();let preRejected=false;
try{await executor.execute({language:'javascript',code:`require('node:fs').writeFileSync(${JSON.stringify(prepared)},'ran')`,signal:pre.signal})}catch{preRejected=true}
check('pre-aborted executor executes no target',preRejected&&!fs.existsSync(prepared),{preRejected});
for(const [name,stdio,mode] of [['parent exits with inherited pipe','pipe','normal'],['parent exits with ignored pipe','ignore','normal'],['cancel running descendants','pipe','cancel'],['timeout running descendants','pipe','timeout'],['background retains ownership until cleanup','pipe','background']]) {
  const marker=path.join(root,name.replaceAll(' ','-')+'.json');
  const child=`require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)`;
  const code=`const cp=require('node:child_process'),fs=require('node:fs');const c=cp.spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,windowsHide:true,stdio:${stdio==='pipe'?'["ignore",process.stdout,process.stderr]':'"ignore"'}});c.unref();const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(t);${mode==='normal'?'process.exit(37)':'console.log("READY");setInterval(()=>{},1000)'}}},10)`;
  const controller=new AbortController();const running=executor.execute({language:'javascript',code,signal:controller.signal,...(mode==='timeout'||mode==='background'?{timeout:1200,background:mode==='background'}:{})});
  await until(()=>fs.existsSync(marker));const pid=JSON.parse(fs.readFileSync(marker)).pid;
  if(mode==='cancel')controller.abort();
  result=await running;const beforeCleanup=alive(pid);
  if(mode==='background'){executor.cleanupBackgrounded();await until(()=>!alive(pid))}
  check(name,!alive(pid)&&(mode==='normal'?result.exitCode===37:mode==='cancel'?result.cancelled===true:mode==='timeout'?result.timedOut===true:result.backgrounded===true&&beforeCleanup),{pid,beforeCleanup,afterAlive:alive(pid),result});
}
const capExecutor=new PolyglotExecutor({runtimes,projectRoot:root,hardCapBytes:4096});
result=await capExecutor.execute({language:'javascript',code:'setInterval(()=>process.stdout.write("x".repeat(8192)),10)'});
check('output cap stops owned Job',result.stderr.includes('output capped')&&!result.stderr.includes('grace expired'),result);
// Host death closes helper control even if a detached descendant ignores pipes.
const hostMarker=path.join(root,'host-child.json');
const hostCode=`import {spawnWindowsOwned} from ${JSON.stringify(pathToFileURL(path.join(repo,'hooks/windows-owned-process.mjs')).href)};const p=spawnWindowsOwned(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(hostMarker)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)`)}],{cwd:${JSON.stringify(root)},env:process.env});p.stdout.resume();p.stderr.resume();setInterval(()=>{},1000);`;
const host=spawn(process.execPath,['--input-type=module','-e',hostCode],{windowsHide:true,stdio:['ignore','ignore','pipe']});host.stderr.resume();const hostExit=new Promise(r=>host.once('exit',r));
await until(()=>fs.existsSync(hostMarker));const hostChild=JSON.parse(fs.readFileSync(hostMarker)).pid;
host.kill();await hostExit;await until(()=>!alive(hostChild));
check('fixture host hard death kills owned target',!alive(hostChild),{hostPid:host.pid,targetPid:hostChild,alive:alive(hostChild)});
// An inherited outer Job must permit a nested owned Job without breakaway.
const nestedCode=`import {spawnWindowsOwned} from ${JSON.stringify(pathToFileURL(path.join(repo,'hooks/windows-owned-process.mjs')).href)};const p=spawnWindowsOwned(process.execPath,['-e','console.log("NESTED中文");process.exit(37)'],{cwd:${JSON.stringify(root)},env:process.env});p.stdout.pipe(process.stdout);p.stderr.pipe(process.stderr);p.once('close',code=>process.exit(code));`;
result=await observe(spawnWindowsOwned(process.execPath,['--input-type=module','-e',nestedCode],{cwd:root,env:process.env})).done;
check('nested host Job compatibility',result.code===37&&result.stdout.includes('NESTED中文'),result);
// Fault variants are isolated copies, never production hooks/env toggles.
const original=fs.readFileSync(path.join(repo,'hooks/windows-process-job.cs'),'utf8');
async function variant(name,source,code) {
 const dir=path.join(root,name);fs.mkdirSync(path.join(dir,'hooks'),{recursive:true});
 for(const file of ['windows-owned-process.mjs','windows-process-job.ps1'])fs.copyFileSync(path.join(repo,'hooks',file),path.join(dir,'hooks',file));
 fs.writeFileSync(path.join(dir,'hooks/windows-process-job.cs'),source);
 const wrapper=await import(pathToFileURL(path.join(dir,'hooks/windows-owned-process.mjs')).href);
 return observe(wrapper.spawnWindowsOwned(process.execPath,['-e',code],{cwd:root,env:process.env}));
}
for(const [name,needle] of [['job configuration failure','ExtendedLimit limit=new ExtendedLimit();'],['attribute initialization failure','IntPtr size=IntPtr.Zero;'],['Job-list attribute failure','jobs=Handles(job);'],['resume failure','else Check(ResumeThread(process.Thread)']]) {
 const marker=path.join(root,name+'.marker');
 const source=name==='resume failure'?original.replace(needle,'else if (DateTime.UtcNow.Ticks > 0) throw new Win32Exception(5,"injected ResumeThread failure");\n            else Check(ResumeThread(process.Thread)'):original.replace(needle,'if (DateTime.UtcNow.Ticks > 0) throw new Win32Exception(5,"injected failure");\n            '+needle);
 result=await (await variant(name,source,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`)).done;
 check(name,result.code===1&&!fs.existsSync(marker)&&result.stderr.includes('injected'),result);
}
const suspendedMarker=path.join(root,'suspended.pid');const suspendedRan=path.join(root,'suspended-ran');
const suspended=await variant('suspended-helper-death',original.replace('created=true;',`created=true;System.IO.File.WriteAllText(@"${suspendedMarker}",process.Pid.ToString());Thread.Sleep(30000);`),`require('node:fs').writeFileSync(${JSON.stringify(suspendedRan)},'ran')`);
await until(()=>fs.existsSync(suspendedMarker));const suspendedPid=Number(fs.readFileSync(suspendedMarker,'utf8'));suspended.proc.kill();await suspended.done;await until(()=>!alive(suspendedPid));
check('helper hard death after atomic creation before resume',!alive(suspendedPid)&&!fs.existsSync(suspendedRan),{pid:suspendedPid,alive:alive(suspendedPid),targetRan:fs.existsSync(suspendedRan)});
const stalledMarker=path.join(root,'stalled.pid');const stalled=await variant('stalled-helper-stop',original.replace('created=true;',`created=true;System.IO.File.WriteAllText(@"${stalledMarker}",process.Pid.ToString());Thread.Sleep(30000);`),'setInterval(()=>{},1000)');
await until(()=>fs.existsSync(stalledMarker));const stalledPid=Number(fs.readFileSync(stalledMarker,'utf8'));const stalledWrapper=await import(pathToFileURL(path.join(root,'stalled-helper-stop/hooks/windows-owned-process.mjs')).href);at=performance.now();stalledWrapper.stopWindowsOwned(stalled.proc);result=await stalled.done;await until(()=>!alive(stalledPid));
check('stop watchdog kills only wedged owned helper and its Job',!alive(stalledPid)&&performance.now()-at<5000,{...result,pid:stalledPid,ms:performance.now()-at,alive:alive(stalledPid)});
const limitedSource=original.replace('limit.Basic.Flags=0x2000;','limit.Basic.Flags=0x2008;limit.Basic.ActiveLimit=2;');
const limited=await variant('outer-job-limit',limitedSource,nestedCode.replaceAll('NESTED中文','LIMIT_TARGET_MUST_NOT_RUN'));
result=await limited.done;
check('restricted outer Job fails closed during helper initialization',result.code===1&&result.stderr.includes('[context-mode job]')&&!result.stdout.includes('LIMIT_TARGET_MUST_NOT_RUN'),result);
// A Unicode cleanup fallback must remove only its owned tree and never follow
// a junction pointing at another fixture directory.
const unicodeTemp=path.join(root,'中文 temp'), guarded=path.join(root,'guarded-target');fs.mkdirSync(unicodeTemp);fs.mkdirSync(guarded);fs.writeFileSync(path.join(guarded,'keep.txt'),'KEEP');
const cleanupCode=`import {PolyglotExecutor} from ${JSON.stringify(pathToFileURL(path.join(repo,'build/executor.js')).href)};import fs from 'node:fs';const e=new PolyglotExecutor({runtimes:${JSON.stringify(runtimes)},projectRoot:${JSON.stringify(root)}});const r=await e.execute({language:'javascript',code:${JSON.stringify(`const fs=require('node:fs'),path=require('node:path'),dir=process.env.TMPDIR;fs.mkdirSync(path.join(dir,'中文 nested'));fs.writeFileSync(path.join(dir,'中文 nested','payload.txt'),'payload');fs.symlinkSync(${JSON.stringify(guarded)},path.join(dir,'junction'),'junction');console.log('CLEANUP_READY')`)}});console.log(JSON.stringify({r,left:fs.readdirSync(${JSON.stringify(unicodeTemp)}),kept:fs.readFileSync(${JSON.stringify(path.join(guarded,'keep.txt'))},'utf8')}));`;
result=await observe(spawn(process.execPath,['--input-type=module','-e',cleanupCode],{cwd:root,env:{...process.env,TEMP:unicodeTemp,TMP:unicodeTemp},windowsHide:true,stdio:['ignore','pipe','pipe']})).done;
check('Unicode owned-temp cleanup preserves junction target',result.code===0&&result.stdout.includes('"left":[]')&&result.stdout.includes('"kept":"KEEP"'),result);
const record={node:process.version,abi:process.versions.modules,platform:process.platform,root,rows,passed:rows.every(row=>row.passed)};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(record,null,2));
console.log(JSON.stringify({passed:record.passed,cases:rows.length,root}));process.exitCode=record.passed?0:1;
