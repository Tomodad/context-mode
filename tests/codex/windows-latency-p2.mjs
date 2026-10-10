// Serial, synthetic Windows regressions. No private session data is read.
// node tests/codex/windows-latency-p2.mjs [gate-module] [built-analytics-module] [output]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
const gatePath=path.resolve(process.argv[2]??'hooks/repair-gate.mjs');
const analyticsPath=path.resolve(process.argv[3]??'build/session/analytics.js');
const output=process.argv[4];
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctx-p2-'));
const rows=[];
const check=(name,passed,detail)=>rows.push({name,passed,detail});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const {withRepairGate}=await import(pathToFileURL(gatePath).href);
const {getLifetimeStats}=await import(pathToFileURL(analyticsPath).href);
const Native=process.env.CTX_P2_NATIVE?createRequire(pathToFileURL(path.resolve(process.env.CTX_P2_NATIVE,'package.json')))('better-sqlite3'):null;
let betweenQueries;
class DB {constructor(file,opts){this.db=Native?new Native(file,{readonly:!!opts?.readonly}):new DatabaseSync(file,{readOnly:!!opts?.readonly})}prepare(sql){if(betweenQueries&&sql.includes('GROUP BY category')){const run=betweenQueries;betweenQueries=undefined;run()}return this.db.prepare(sql)}exec(sql){this.db.exec(sql)}close(){this.db.close()}}
const sessions=path.join(root,'sessions');fs.mkdirSync(sessions);
const file=path.join(sessions,'synthetic.db');
function create(file,category='file') {
 const db=new DatabaseSync(file);
 db.exec(`PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;
 CREATE TABLE session_events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,created_at TEXT,data TEXT,category TEXT,project_dir TEXT);
 CREATE TABLE session_meta(session_id TEXT);INSERT INTO session_meta VALUES('s');
 CREATE TABLE session_resume(snapshot TEXT,consumed INTEGER);
 INSERT INTO session_events(session_id,created_at,data,category,project_dir) VALUES('s','2026-10-09 12:00:00','older','${category}','old-project'),('s','2026-10-10 12:00:00','highest','${category}','old-project');
 PRAGMA wal_checkpoint(TRUNCATE)`);return db;
}
let writer=create(file);
const stats=()=>getLifetimeStats({sessionsDir:sessions,memoryRoot:path.join(root,'none'),loadDatabase:()=>DB});
stats();const main=fs.statSync(file);
writer.exec("UPDATE session_events SET category='updated',project_dir='new-project' WHERE id=2");
let s=stats();const after=fs.statSync(file);
check('WAL UPDATE highest row aggregate fields',s.categoryCounts.updated===1&&s.distinctProjects===2&&main.size===after.size&&main.mtimeMs===after.mtimeMs,{stats:s,mainUnchanged:main.size===after.size&&main.mtimeMs===after.mtimeMs});
writer.exec("UPDATE session_events SET category='older-update',project_dir='older-project',created_at='2020-01-01 00:00:00' WHERE id=1");
s=stats();check('WAL UPDATE older row and earliest timestamp',s.categoryCounts['older-update']===1&&s.firstEventMs===Date.parse('2020-01-01T00:00:00Z'),s);
writer.exec("BEGIN;UPDATE session_events SET category='mixed' WHERE id=1;INSERT INTO session_events(session_id,created_at,data,category,project_dir) VALUES('s','2026-10-10 00:00:00','added','mixed','added-project');COMMIT");
s=stats();check('WAL UPDATE plus INSERT same transaction',s.totalEvents===3&&s.categoryCounts.mixed===2,s);
writer.exec("BEGIN;UPDATE session_events SET category='uncommitted' WHERE id=2");
s=stats();check('uncommitted UPDATE remains invisible',s.categoryCounts.uncommitted===undefined&&s.categoryCounts.updated===1,s);writer.exec('ROLLBACK');
betweenQueries=()=>writer.exec("UPDATE session_events SET category='between-queries' WHERE id=1");
const snapshot=stats();const next=stats();
check('commit between aggregate queries keeps one snapshot',snapshot.categoryCounts.mixed===2&&snapshot.categoryCounts['between-queries']===undefined&&next.categoryCounts['between-queries']===1,{snapshot,next});
class FailedBegin extends DB {exec(sql){if(sql==='BEGIN')throw Error('controlled BEGIN failure');super.exec(sql)}}
const beginFailed=getLifetimeStats({sessionsDir:sessions,memoryRoot:path.join(root,'none'),loadDatabase:()=>FailedBegin});
check('failed BEGIN never mixes per-statement snapshots',beginFailed.totalEvents===0,beginFailed);
writer.exec('DELETE FROM session_events WHERE id=1');s=stats();check('older row deletion',s.totalEvents===2&&s.categoryCounts.mixed===1,s);
writer.close();globalThis.gc?.();fs.renameSync(file,path.join(root,'old.db'));writer=create(file,'replacement');writer.close();s=stats();check('database replacement',s.totalEvents===2&&s.categoryCounts.replacement===2,s);
globalThis.gc?.();fs.unlinkSync(file);s=stats();check('database deletion',s.totalEvents===0,s);
const residue=path.join(root,'residue');fs.mkdirSync(residue);
const dead=spawnSync(process.execPath,['-e',''],{windowsHide:true});
const lock=path.join(residue,'.ctx-repair-lock');fs.mkdirSync(lock);fs.mkdirSync(lock+'.reclaim');
fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:dead.pid,at:1,token:'dead-owner'}));fs.utimesSync(lock,new Date(1),new Date(1));
let invoked=0;let r=await withRepairGate(residue,async()=>{invoked++;return true},{leaseMs:0});
check('dead reclaim residue cannot block repair',r.status==='success'&&invoked===1,{r,invoked});
const gateRoot=path.join(root,'gate');fs.mkdirSync(gateRoot);
let release;const held=withRepairGate(gateRoot,async()=>{await new Promise(r=>release=r);return true});
for(let i=0;i<100&&!release;i++)await wait(10);
r=await withRepairGate(gateRoot,async()=>{throw Error('must not run')});check('live owner excludes second repair',r.status==='inflight',r);release();await held;
r=await withRepairGate(gateRoot,async()=>false,{retryMs:60000,key:'fixture'});const failed=r;
r=await withRepairGate(gateRoot,async()=>{throw Error('must not run')},{retryMs:60000,key:'fixture'});check('failure backoff',failed.status==='failure'&&r.status==='backoff',{failed,r});
r=await withRepairGate(gateRoot,async()=>true,{key:'different-abi'});check('changed ABI key retries',r.status==='success',r);
const crash=path.join(root,'crash');fs.mkdirSync(crash);const ready=path.join(crash,'ready');
const code=`import fs from 'node:fs';import {withRepairGate} from ${JSON.stringify(pathToFileURL(gatePath).href)};await withRepairGate(${JSON.stringify(crash)},async()=>{fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));await new Promise(()=>{setInterval(()=>{},1000)});return true});`;
const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>err+=b);const exited=new Promise(r=>child.once('exit',r));
for(let i=0;i<200&&!fs.existsSync(ready);i++)await wait(10);
if(fs.existsSync(ready)){child.kill('SIGKILL');await exited;const t=performance.now();r=await withRepairGate(crash,async()=>true,{leaseMs:0});check('hard-killed owner releases lock immediately',r.status==='success',{r,ms:performance.now()-t,ownedPid:child.pid});}
else{child.kill();await exited;check('hard-killed owner releases lock immediately',false,{error:err});}
const blocked=path.join(root,'blocked');fs.writeFileSync(blocked,'not a directory');
r=await withRepairGate(blocked,async()=>{throw Error('must not run')});check('state path failure never runs repair',r.status==='state-unavailable',r);
fs.unlinkSync(blocked);fs.mkdirSync(blocked);r=await withRepairGate(blocked,async()=>true);check('state availability recovery',r.status==='success',r);
fs.writeFileSync(path.join(blocked,'.ctx-repair-failure.json'),'{corrupt');r=await withRepairGate(blocked,async()=>true);check('corrupt failure marker recovery',r.status==='success',r);
if(process.env.CTX_TEST_BUN){
 const bun=process.env.CTX_TEST_BUN;
 for(const [ownerBin,contenderBin] of [[process.execPath,bun],[bun,process.execPath]]){
  const dir=fs.mkdtempSync(path.join(root,'cross-runtime-')),marker=path.join(dir,'ready');
  const ownerScript=path.join(dir,'owner.mjs'),contenderScript=path.join(dir,'contender.mjs');
  fs.writeFileSync(ownerScript,`import fs from 'node:fs';import{withRepairGate}from ${JSON.stringify(pathToFileURL(gatePath).href)};console.log(await withRepairGate(${JSON.stringify(dir)},async()=>{fs.writeFileSync(${JSON.stringify(marker)},'ready');await new Promise(()=>setInterval(()=>{},1000));return true}));`);
  fs.writeFileSync(contenderScript,`import{withRepairGate}from ${JSON.stringify(pathToFileURL(gatePath).href)};const r=await withRepairGate(${JSON.stringify(dir)},async()=>true);console.log(JSON.stringify(r));process.exitCode=r.status==='inflight'?0:1;`);
  const owner=spawn(ownerBin,[ownerScript],{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';owner.stderr.on('data',b=>error+=b);const done=new Promise(r=>owner.once('exit',r));
  for(let i=0;i<200&&!fs.existsSync(marker);i++)await wait(10);
  const c=spawnSync(contenderBin,[contenderScript],{windowsHide:true,encoding:'utf8',timeout:5000});
  owner.kill('SIGKILL');await done;
  check('cross-runtime gate '+path.basename(ownerBin)+' -> '+path.basename(contenderBin),fs.existsSync(marker)&&c.status===0,{status:c.status,stdout:c.stdout,stderr:c.stderr,ownerError:error});
 }
}
const result={node:process.version,nativeVersion:Native?createRequire(pathToFileURL(path.resolve(process.env.CTX_P2_NATIVE,'package.json')))('better-sqlite3/package.json').version:null,gatePath,analyticsPath,root,rows,passed:rows.every(x=>x.passed)};
if(output)fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
// Leave the small owned fixture for inspection; callers may remove only this recorded root.
process.exitCode=result.passed?0:1;
