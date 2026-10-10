// Real shared heal/worker subprocess chain with synthetic installer payloads.
// node tests/codex/windows-repair-lifecycle.mjs <isolated-root> <native-deps-root> <output> [bun.exe]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { runWindowsRepair } from '../../hooks/windows-repair.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.resolve(process.argv[2]), dependencies=path.resolve(process.argv[3]), output=process.argv[4], bun=process.argv[5] && process.argv[5]!=='--cached' ? path.resolve(process.argv[5]) : undefined;
const useCache=process.argv.includes('--cached');
async function prepare(root) { if(useCache){const m=await import(pathToFileURL(path.join(root,'hooks/windows-owned-process.mjs')));if(!await m.prepareWindowsJobHelper())throw Error('cached helper preparation failed')} }
fs.mkdirSync(base,{recursive:true});
const rows=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function until(test){const end=Date.now()+10000;while(Date.now()<end){if(test())return;await wait(10)}throw Error('fixture deadline')}
function check(name,passed,detail){rows.push({name,passed,detail});console.log(JSON.stringify({name,passed}))}
function fixture(name){
 const root=path.join(base,name);fs.mkdirSync(root,{recursive:true});
 fs.cpSync(path.join(repo,'hooks'),path.join(root,'hooks'),{recursive:true});fs.mkdirSync(path.join(root,'scripts'));fs.copyFileSync(path.join(repo,'scripts/heal-better-sqlite3.mjs'),path.join(root,'scripts/heal-better-sqlite3.mjs'));
 fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');fs.mkdirSync(path.join(root,'node_modules'),{recursive:true});
 fs.cpSync(path.join(dependencies,'node_modules/better-sqlite3'),path.join(root,'node_modules/better-sqlite3'),{recursive:true});
 for(const pkg of ['bindings','file-uri-to-path'])fs.cpSync(path.join(dependencies,'node_modules',pkg),path.join(root,'node_modules',pkg),{recursive:true});
 return root;
}
function observe(proc){let stdout='',stderr='';proc.stdout?.on('data',b=>stdout+=b);proc.stderr?.on('data',b=>stderr+=b);return new Promise(resolve=>proc.once('close',code=>resolve({code,stdout,stderr})))}
const root=fixture('host-crash'), native=path.join(root,'node_modules/better-sqlite3/build/Release'), binary=path.join(native,'better_sqlite3.node'), backup=path.join(root,'known-good.node');fs.copyFileSync(binary,backup);
await prepare(root);
for(const file of fs.readdirSync(native))if(file.startsWith('better_sqlite3'))fs.unlinkSync(path.join(native,file));
const prebuild=path.join(root,'node_modules/prebuild-install');fs.mkdirSync(prebuild);fs.writeFileSync(path.join(prebuild,'package.json'),'{"name":"prebuild-install","main":"bin.js"}');
const marker=path.join(root,'installer.json'), writes=path.join(root,'installer-writes.log');
const writer=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},'write\\n'),20);setTimeout(()=>process.exit(0),15000)`;
fs.writeFileSync(path.join(prebuild,'bin.js'),`const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(writer)}],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();setInterval(()=>{},1000);`);
const hostCode=`import {runWindowsRepair} from ${JSON.stringify(pathToFileURL(path.join(root,'hooks/windows-repair.mjs')).href)};console.log(JSON.stringify(await runWindowsRepair(${JSON.stringify(root)})));`;
const host=spawn(process.execPath,['--input-type=module','-e',hostCode],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});const hostDone=observe(host);
await until(()=>fs.existsSync(marker)&&fs.existsSync(writes));const installer=JSON.parse(fs.readFileSync(marker)).pid;
const contender=await runWindowsRepair(root);
check('installer descendant holds named ownership across repair',contender.status==='inflight'&&alive(installer),{contender,installer,alive:alive(installer)});
const alias=path.join(base,'root-alias');let aliasResult;
try {fs.symlinkSync(root,alias,'junction');aliasResult=await runWindowsRepair(alias);}
catch(error) {host.kill();await hostDone;await until(()=>!alive(installer));throw error;}
check('canonical path aliases share repair ownership',aliasResult.status==='inflight',{aliasResult});
const killedAt=performance.now();host.kill();await hostDone;await until(()=>!alive(installer));
const size=fs.statSync(writes).size;await wait(150);
check('repair host hard death stops actual heal installer descendant',!alive(installer)&&fs.statSync(writes).size===size,{installer,alive:alive(installer),killMs:performance.now()-killedAt,writesStable:fs.statSync(writes).size===size});
fs.writeFileSync(path.join(prebuild,'bin.js'),`require('node:fs').copyFileSync(${JSON.stringify(backup)},${JSON.stringify(binary)});`);
let recovered;for(let i=0;i<20;i++){recovered=await runWindowsRepair(root);if(recovered.status!=='inflight')break;await wait(20)}
check('crashed repair retries only after old Job ends and native loads',recovered.status==='success'&&!alive(installer)&&fs.existsSync(binary),{recovered,oldInstallerAlive:alive(installer)});
for(const [name,runtime] of [['node',process.execPath],...(bun?[['bun',bun]]:[])]) {
 const failedRoot=fixture(name+'-js-failure'), log=path.join(failedRoot,'install-attempts.log'), ensure=path.join(failedRoot,'hooks/ensure-deps.mjs');
 await prepare(failedRoot);
 let source=fs.readFileSync(ensure,'utf8').replace('import { execFileSync, execSync } from "node:child_process";','const execFileSync = (...args) => { writeFileSync('+JSON.stringify(log)+', "attempt\\n", {flag:"a"}); throw Error("controlled installer failure"); }; const execSync = execFileSync;');
 fs.writeFileSync(ensure,source);
 const code=`import {runWindowsRepair} from ${JSON.stringify(pathToFileURL(path.join(failedRoot,'hooks/windows-repair.mjs')).href)};console.log(JSON.stringify(await runWindowsRepair(${JSON.stringify(failedRoot)},{startupDeps:true})));`;
 const run=()=>observe(spawn(runtime,['--input-type=module','-e',code],{cwd:failedRoot,windowsHide:true,stdio:['ignore','pipe','pipe']}));
 const first=await run(), attempts=fs.existsSync(log)?fs.readFileSync(log,'utf8').split('\n').filter(Boolean).length:0, second=await run(), after=fs.existsSync(log)?fs.readFileSync(log,'utf8').split('\n').filter(Boolean).length:0;
 check(name+' pure-JS install failure enters backoff and never reports success',first.stdout.includes('"status":"failure"')&&second.stdout.includes('"status":"backoff"')&&attempts===3&&after===attempts,{first,second,attempts,after});
}
if(bun){const seeded=fixture('bun-cache-seed'),dir=path.join(seeded,'node_modules/better-sqlite3/build/Release');for(const file of fs.readdirSync(dir))if(file.includes('.abi')||file.endsWith('.swap-stamp'))fs.unlinkSync(path.join(dir,file));
 await prepare(seeded);
 const code=`await import(${JSON.stringify(pathToFileURL(path.join(seeded,'hooks/ensure-deps.mjs')).href)});console.log('SEEDED');`;
 const result=await observe(spawn(bun,['--input-type=module','-e',code],{cwd:seeded,windowsHide:true,stdio:['ignore','pipe','pipe']}));
 check('Bun cache seeding stays in owned worker',result.code===0&&fs.readdirSync(dir).some(file=>file.includes('.abi')),{result,files:fs.readdirSync(dir)});
}
const record={node:process.version,abi:process.versions.modules,base,dependencies,helperCache:useCache,installerPayload:'synthetic; production heal code and real child process chain',rows,passed:rows.every(row=>row.passed)};
fs.writeFileSync(output,JSON.stringify(record,null,2));console.log(JSON.stringify({cases:rows.length,passed:record.passed}));process.exitCode=record.passed?0:1;
