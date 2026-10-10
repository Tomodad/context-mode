// Retry throttling and a crash-released mutex for one installed dependency tree.
// A quiescent upgrade is required: old directory-lock gates do not share this mutex.
import {readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
function recentFailure(state,key,retryMs) {
  try {const value=JSON.parse(readFileSync(state,'utf8'));const age=Date.now()-value.at;
    return value.key===key && age>=0 && age<retryMs;
  } catch {return false;}
}
export async function withRepairGate(root,repair,options={}) {
  const {retryMs=15*60*1000,key=process.version+':'+process.versions.modules+':'+process.platform+':'+process.arch}=options;
  const state=join(root,'.ctx-repair-failure.json');let db;
  try {
    // Do not depend on the better-sqlite3 binding which this gate repairs.
    // Early Node 22 requires --experimental-sqlite; an unavailable API fails closed.
    const sqlite=await import(typeof globalThis.Bun==='undefined'?'node:sqlite':'bun:sqlite');
    const Database=sqlite.DatabaseSync??sqlite.Database;
    db=new Database(join(root,'.ctx-repair-gate.sqlite3'));
    db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
  } catch(error) {
    try {db?.close();} catch {}
    const busy=error?.errcode===5 || error?.errcode===6 || error?.code==='SQLITE_BUSY' || error?.code==='SQLITE_LOCKED';
    return {status:busy?'inflight':'state-unavailable',key,error:String(error?.code??error?.message)};
  }
  try {
    // The preceding owner may have changed failure state just before releasing.
    if(recentFailure(state,key,retryMs))return {status:'backoff',key};
    const ok=await repair();if(ok!==true)throw Error('repair did not produce a loadable dependency');
    rmSync(state,{force:true});return {status:'success',key};
  } catch(error) {
    const message=String(error?.message??error),temp=state+'.'+process.pid+'-'+Date.now();let failureRecorded=false;
    try {writeFileSync(temp,JSON.stringify({key,at:Date.now(),error:message}));renameSync(temp,state);failureRecorded=true;}
    catch {try {rmSync(temp,{force:true});} catch {}}
    return {status:'failure',key,error:message,...(options.reportFailureWrite?{failureRecorded}:{})};
  } finally {
    // OS locks span await and release on process death. Never unlink the mutex DB.
    try {db.exec('ROLLBACK');} catch {}
    try {db.close();} catch {}
  }
}
