// Serial, deterministic Windows hang/cancel regressions. Only owned fixtures.
// node tests/codex/windows-stall-deadlines.mjs [output.json] [absolute rustc.exe]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PolyglotExecutor } from '../../build/executor.js';
import { prepareWindowsJobHelper } from '../../hooks/windows-owned-process.mjs';
if(process.platform!=='win32') throw Error('Windows-only regression');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctx-stall-'));
const rows=[], wait=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function until(test,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(test())return;await wait(10)}throw Error('fixture readiness deadline')}
function check(name,passed,detail){rows.push({name,passed,detail});console.log(JSON.stringify({name,passed}))}
const runtimes={javascript:process.execPath,typescript:null,python:null,shell:'C:\\Windows\\System32\\cmd.exe',ruby:null,go:null,rust:process.execPath,php:null,perl:null,r:null,elixir:null,csharp:null};
check('normal helper preparation has finite deadline',await prepareWindowsJobHelper({timeoutMs:30000}),{});
const executor=new PolyglotExecutor({runtimes,projectRoot:root});
for(const mode of ['cancel','timeout']){
  const marker=path.join(root,'rust-'+mode+'.json');
  const child=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({compiler:process.ppid,child:process.pid,source:process.argv[1]}));setInterval(()=>{},1000)`;
  const code=`const cp=require('node:child_process');cp.spawn(process.execPath,['-e',${JSON.stringify(child)},process.argv[1]],{detached:true,windowsHide:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)`;
  const controller=new AbortController();let ticks=0;const heartbeat=setInterval(()=>ticks++,10),started=performance.now();
  const running=executor.execute({language:'rust',code,signal:controller.signal,timeout:mode==='timeout'?1600:10000});
  await until(()=>fs.existsSync(marker));const pids=JSON.parse(fs.readFileSync(marker));if(mode==='cancel')controller.abort();
  const result=await running;clearInterval(heartbeat);const compilerAliveAtReturn=alive(pids.compiler),childAliveAtReturn=alive(pids.child);await until(()=>!alive(pids.compiler)&&!alive(pids.child));
  const ms=performance.now()-started;
  check('Rust compile '+mode+' stops compiler and detached child',
    (mode==='cancel'?result.cancelled:result.timedOut)===true && !compilerAliveAtReturn&&!childAliveAtReturn&&ticks>5&&!fs.existsSync(path.dirname(pids.source)),
    {result,ms,ticks,pids,compilerAliveAtReturn,childAliveAtReturn,tempExists:fs.existsSync(path.dirname(pids.source))});
  const next=await executor.execute({language:'javascript',code:'console.log("RECOVERED中文");process.exit(37)',timeout:5000});
  check('executor recovers after Rust '+mode,next.exitCode===37&&next.stdout.includes('RECOVERED中文'),next);
}
const failed=await executor.execute({language:'rust',code:'process.stderr.write("synthetic compile error");process.exit(23)',timeout:5000});
check('compiler failure retains exit status without binary execution',failed.exitCode===23&&!failed.timedOut&&failed.stderr.includes('synthetic compile error'),failed);
const rust=process.argv[3];
if(rust){
  const real=new PolyglotExecutor({runtimes:{...runtimes,rust},projectRoot:root});
  let result=await real.execute({language:'rust',code:'fn main(){println!("真实 Rust 中文 café 😀");std::process::exit(37);}',timeout:10000});
  check('real rustc compile and binary exit37',result.exitCode===37&&result.stdout.includes('真实 Rust 中文 café 😀'),result);
  const started=performance.now();result=await real.execute({language:'rust',code:'fn main(){std::thread::sleep(std::time::Duration::from_secs(5));}',timeout:1600});
  const ms=performance.now()-started;
  check('Rust compile plus run shares caller timeout',result.timedOut===true&&ms<2300,{result,ms,budgetMs:1600});
}
const files=['windows-owned-process.mjs','windows-process-job.ps1','windows-process-job.cs','windows-job-entry.cs','windows-job-cache-worker.mjs','windows-repair.mjs','repair-gate.mjs'];
function fixture(name){const dir=path.join(root,name),hooks=path.join(dir,'hooks');fs.mkdirSync(hooks,{recursive:true});for(const f of files)fs.copyFileSync(path.join(repo,'hooks',f),path.join(hooks,f));return {dir,hooks}}
for(const kind of ['prepare','repair']) for(const mode of ['timeout','cancel']){
  const f=fixture(kind+'-'+mode),marker=path.join(f.dir,'pids.json');
  const child=`require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({worker:process.ppid,child:process.pid}));setInterval(()=>{},1000)`;
  const hang=`import {spawn} from 'node:child_process';if(process.argv.includes('--record-timeout')){console.log(JSON.stringify({status:'failure'}));process.exit(1);}spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,windowsHide:true,stdio:'ignore'}).unref();setInterval(()=>{},1000);`;
  const worker=path.join(f.hooks,kind==='prepare'?'windows-job-cache-worker.mjs':'repair-worker.mjs');fs.writeFileSync(worker,hang);
  const owned=await import(pathToFileURL(path.join(f.hooks,'windows-owned-process.mjs')).href);
  const repair=kind==='repair'?await import(pathToFileURL(path.join(f.hooks,'windows-repair.mjs')).href):null;
  const controller=new AbortController(),started=performance.now();
  const call=kind==='prepare'?owned.prepareWindowsJobHelper({timeoutMs:mode==='timeout'?3000:10000,signal:controller.signal}):repair.runWindowsRepair(f.dir,{timeoutMs:mode==='timeout'?3000:10000,signal:controller.signal});
  await until(()=>fs.existsSync(marker));const pids=JSON.parse(fs.readFileSync(marker));if(mode==='cancel')controller.abort();
  const result=await call;const workerAliveAtReturn=alive(pids.worker),childAliveAtReturn=alive(pids.child);await until(()=>!alive(pids.worker)&&!alive(pids.child));const ms=performance.now()-started;
  const expected=kind==='prepare'?result===false:result.status===(mode==='timeout'?'timed-out':'cancelled');
  check(kind+' '+mode+' closes Job before return',expected&&!workerAliveAtReturn&&!childAliveAtReturn&&ms<6000,{result,ms,pids,workerAliveAtReturn,childAliveAtReturn});
  if(kind==='prepare'){
    fs.copyFileSync(path.join(repo,'hooks/windows-job-cache-worker.mjs'),worker);
    const next=await owned.prepareWindowsJobHelper({timeoutMs:30000});check(kind+' recovers after '+mode,next,{ready:next});
  }else{
    fs.writeFileSync(worker,'console.log(JSON.stringify({status:"success"}));');
    const next=await repair.runWindowsRepair(f.dir,{timeoutMs:10000});check(kind+' recovers after '+mode,next.status==='success',next);
  }
}
// Pre-Job startup stall: stop the exact PowerShell helper, run no worker.
const early=fixture('pre-job-startup-stall'), marker=path.join(early.dir,'must-not-run');
fs.writeFileSync(path.join(early.hooks,'windows-process-job.ps1'),'Start-Sleep -Seconds 30\n'+fs.readFileSync(path.join(early.hooks,'windows-process-job.ps1'),'utf8'));
fs.writeFileSync(path.join(early.hooks,'windows-job-cache-worker.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran');`);
const earlyOwned=await import(pathToFileURL(path.join(early.hooks,'windows-owned-process.mjs')).href);
const at=performance.now(), earlyResult=await earlyOwned.prepareWindowsJobHelper({timeoutMs:200}),earlyMs=performance.now()-at;
check('pre-Job PowerShell startup stall is bounded and no worker runs',earlyResult===false&&earlyMs<4000&&!fs.existsSync(marker),{result:earlyResult,ms:earlyMs,targetRan:fs.existsSync(marker),scope:'No claim about pre-Job Add-Type compiler descendants'});
// OS kill failure / no close is a fault on our exact fixture ChildProcess.
const uncertain=fixture('no-close'), uncertainOwned=await import(pathToFileURL(path.join(uncertain.hooks,'windows-owned-process.mjs')).href);
fs.writeFileSync(path.join(uncertain.hooks,'windows-process-job.ps1'),'Start-Sleep -Seconds 10\n');
const proc=uncertainOwned.spawnWindowsOwned(process.execPath,['-e','process.exit(0)'],{cwd:uncertain.dir,env:process.env});proc.stdout.resume();proc.stderr.resume();
const realKill=proc.kill.bind(proc);proc.kill=()=>false;
const before=performance.now(),noClose=await uncertainOwned.waitWindowsOwned(proc,{timeoutMs:200});
const stillAlive=alive(proc.pid),noCloseMs=performance.now()-before;
check('failed OS termination returns bounded uncertain state',noClose.terminationUncertain&&noClose.timedOut&&stillAlive&&noCloseMs<2500,{result:noClose,ms:noCloseMs,helperAliveAtReturn:stillAlive});
const ended=new Promise(r=>proc.once('close',r));proc.ref();realKill();await ended;
// Cancellation also reaches the bounded timeout-status worker, not just the
// original repair. Both synthetic workers use the production owned Job path.
const phase=fixture('cancel-timeout-record'), phaseMarker=path.join(phase.dir,'record-child.pid');
const phaseChild=`require('node:fs').writeFileSync(${JSON.stringify(phaseMarker)},String(process.pid));setInterval(()=>{},1000)`;
fs.writeFileSync(path.join(phase.hooks,'repair-worker.mjs'),`import {spawn} from 'node:child_process';if(process.argv.includes('--record-timeout'))spawn(process.execPath,['-e',${JSON.stringify(phaseChild)}],{detached:true,windowsHide:true,stdio:'ignore'}).unref();setInterval(()=>{},1000);`);
const phaseRepair=await import(pathToFileURL(path.join(phase.hooks,'windows-repair.mjs')).href),phaseAbort=new AbortController();
const phaseCall=phaseRepair.runWindowsRepair(phase.dir,{timeoutMs:3000,signal:phaseAbort.signal});await until(()=>fs.existsSync(phaseMarker));const phasePid=Number(fs.readFileSync(phaseMarker,'utf8'));phaseAbort.abort();const phaseResult=await phaseCall;
check('abort reaches timeout backoff worker and its child',phaseResult.status==='timed-out'&&phaseResult.backoff==='cancelled'&&!alive(phasePid),{result:phaseResult,childPid:phasePid,childAliveAtReturn:alive(phasePid)});
const record={node:process.version,abi:process.versions.modules,root,rows,passed:rows.every(r=>r.passed)};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(record,null,2));console.log(JSON.stringify({passed:record.passed,cases:rows.length,root}));process.exitCode=record.passed?0:1;
