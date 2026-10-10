// Experimental local retry gate. Not deployed to an installed plugin.
import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
const defaults={retryMs:15*60*1000,leaseMs:5*60*1000};
export async function withRepairGate(root,repair,options={}) {
  const {retryMs,leaseMs,key=process.version+':'+process.versions.modules+':'+process.platform+':'+process.arch}= {...defaults,...options};
  const lock=join(root,'.ctx-repair-lock'),state=join(root,'.ctx-repair-failure.json');
  const now=Date.now();
  try{const s=JSON.parse(readFileSync(state,'utf8'));if(s.key===key&&now-s.at>=0&&now-s.at<retryMs)return {status:'backoff',key};}catch{}
  try{mkdirSync(lock)}catch(e){
    if(e.code!=='EEXIST')return {status:'state-unavailable',error:e.code};
    // Never steal a live owner's lock. Dead-owner recovery waits for the lease;
    // this deliberately avoids immediate races around a partially written owner.
    let owner;try{owner=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'))}catch{}
    let live=false;if(owner?.pid){try{process.kill(owner.pid,0);live=true}catch{}}
    let age=0;try{age=now-statSync(lock).mtimeMs}catch{}
    if(live||age<leaseMs)return {status:'inflight',key};
    // Serialize stale-lock recovery as well as ordinary acquisition.
    const reclaim=lock+'.reclaim';try{mkdirSync(reclaim)}catch{return {status:'inflight',key}}
    try{let again;try{again=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'))}catch{}
      if(again?.pid){try{process.kill(again.pid,0);return {status:'inflight',key}}catch{}}
      rmSync(lock,{recursive:true,force:true});mkdirSync(lock);
    }catch{return {status:'inflight',key}}finally{rmSync(reclaim,{recursive:true,force:true})}
  }
  const token=process.pid+':'+now;
  try{writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid,at:now,key,token}))}catch{rmSync(lock,{recursive:true,force:true});return {status:'state-unavailable'}}
  try{
    const ok=await repair();if(ok!==true)throw Error('repair did not produce a loadable dependency');
    rmSync(state,{force:true});return {status:'success',key};
  }catch(e){const temp=state+'.'+token.replace(':','-');try{writeFileSync(temp,JSON.stringify({key,at:Date.now(),error:String(e.message)}));renameSync(temp,state)}catch{try{rmSync(temp,{force:true})}catch{}}
    return {status:'failure',key,error:e.message};
  }finally{try{const owner=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));if(owner.token===token)rmSync(lock,{recursive:true,force:true})}catch{}}
}
