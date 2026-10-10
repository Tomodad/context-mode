// Actual repair gate + worker; deterministic fault module, never npm/install.
// node tests/codex/windows-repair-deadline-backoff.mjs <native-deps> [output]
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctx-repair-budget-')),deps=path.resolve(process.argv[2]),rows=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms)),alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
function check(name,passed,detail){rows.push({name,passed,detail});console.log(JSON.stringify({name,passed}))}
function fixture(name){const dir=path.join(root,name),hooks=path.join(dir,'hooks');fs.mkdirSync(hooks,{recursive:true});
for(const f of ['windows-owned-process.mjs','windows-process-job.ps1','windows-process-job.cs','windows-job-entry.cs','windows-job-cache-worker.mjs','windows-repair.mjs','repair-worker.mjs','repair-gate.mjs'])fs.copyFileSync(path.join(repo,'hooks',f),path.join(hooks,f));fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');return {dir,hooks}}
const broken=fixture('actual-worker-timeout'),marker=path.join(broken.dir,'installer.pid'),attempts=path.join(broken.dir,'attempts');
const child=`require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`;
fs.writeFileSync(path.join(broken.hooks,'ensure-deps.mjs'),`import fs from 'node:fs';import {spawn} from 'node:child_process';export async function ensureDeps(){fs.appendFileSync(${JSON.stringify(attempts)},'attempt\\n');spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,windowsHide:true,stdio:'ignore'}).unref();await new Promise(()=>setInterval(()=>{},1000));}export function ensureNativeCompat(){}export function probeNativeInChildProcess(){return false;}`);
const b=await import(pathToFileURL(path.join(broken.hooks,'windows-repair.mjs')).href);
const result=await b.runWindowsRepair(broken.dir,{timeoutMs:3000});
const pid=Number(fs.readFileSync(marker,'utf8')),aliveAtReturn=alive(pid),state=JSON.parse(fs.readFileSync(path.join(broken.dir,'.ctx-repair-failure.json'),'utf8'));
check('actual worker deadline stops installer and records guarded backoff',result.status==='timed-out'&&result.backoff==='failure'&&result.backoffRecorded===true&&!aliveAtReturn&&state.error==='overall Windows repair deadline expired',{result,pid,aliveAtReturn,state:{key:state.key,error:state.error}});
const before=fs.readFileSync(attempts,'utf8'),retry=await b.runWindowsRepair(broken.dir,{timeoutMs:10000});
check('subsequent actual repair honors timeout backoff without another install',retry.status==='backoff'&&before===fs.readFileSync(attempts,'utf8'),{retry,attempts:before});
const healthy=fixture('newer-healthy-repair');
for(const pkg of ['better-sqlite3','bindings','file-uri-to-path'])fs.cpSync(path.join(deps,'node_modules',pkg),path.join(healthy.dir,'node_modules',pkg),{recursive:true});
const h=await import(pathToFileURL(path.join(healthy.hooks,'windows-repair.mjs')).href);
const late=await h.runWindowsRepair(healthy.dir,{recordTimeout:true,timeoutMs:10000});
check('late timeout record does not backoff a now-healthy dependency',late.status==='success'&&!fs.existsSync(path.join(healthy.dir,'.ctx-repair-failure.json')),{late,failureStateExists:fs.existsSync(path.join(healthy.dir,'.ctx-repair-failure.json'))});
const denied=fixture('failed-state-write'),gate=path.join(denied.hooks,'repair-gate.mjs');
fs.writeFileSync(gate,fs.readFileSync(gate,'utf8').replace('try {writeFileSync(temp,','try {throw Error("injected state write failure");writeFileSync(temp,'));
const d=await import(pathToFileURL(path.join(denied.hooks,'windows-repair.mjs')).href),notRecorded=await d.runWindowsRepair(denied.dir,{recordTimeout:true,timeoutMs:10000});
check('state write failure is explicitly unconfirmed',notRecorded.status==='failure'&&notRecorded.failureRecorded===false&&!fs.existsSync(path.join(denied.dir,'.ctx-repair-failure.json')),{result:notRecorded});
const record={node:process.version,abi:process.versions.modules,root,rows,passed:rows.every(r=>r.passed)};if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(record,null,2));console.log(JSON.stringify({passed:record.passed,cases:rows.length}));process.exitCode=record.passed?0:1;
