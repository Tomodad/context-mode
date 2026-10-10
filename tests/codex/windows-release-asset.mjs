// Serial cold release/previous compiler gap regressions; no global configuration.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnWindowsOwned,waitWindowsOwned,prepareWindowsJobHelper} from '../../hooks/windows-owned-process.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'ctx-release-中文 space-'));
const rows=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const check=(name,passed,detail)=>{rows.push({name,passed,detail});console.log(JSON.stringify(rows.at(-1)));};
async function until(test,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(test())return;await wait(10)}throw Error('fixture readiness deadline');}
const hooks=path.join(root,'hooks');fs.mkdirSync(hooks);
for(const f of ['windows-owned-process.mjs','windows-process-job.cs','windows-job-entry.cs','windows-job-runtime.exe','windows-job-runtime.json','windows-process-job.ps1'])fs.copyFileSync(path.join(repo,'hooks',f),path.join(hooks,f));
// Preserve the former real CodeDom fault shape. If any PS/Add-Type fallback is
// invoked it will run the synthetic compiler and record it. Compiler is finite.
const framework=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319'),compilerDir=path.join(root,'compiler');fs.mkdirSync(compilerDir);
const compilerMarker=path.join(compilerDir,'compiler.pid'),childMarker=path.join(compilerDir,'child.pid');
const literal=value=>'@"'+value.replaceAll('"','""')+'"';
const cs=path.join(root,'CompilerFixture.cs');fs.writeFileSync(cs,`using System;using System.IO;using System.Diagnostics;using System.Threading;class CompilerFixture{static int Main(string[] args){string dir=Path.GetDirectoryName(typeof(CompilerFixture).Assembly.Location);var p=new ProcessStartInfo(${literal(process.execPath)},"\\\""+Path.Combine(dir,"child.js")+"\\\"");p.UseShellExecute=false;p.CreateNoWindow=true;p.RedirectStandardInput=true;p.RedirectStandardOutput=true;p.RedirectStandardError=true;var child=Process.Start(p);child.StandardInput.Close();File.WriteAllText(Path.Combine(dir,"compiler.pid"),Process.GetCurrentProcess().Id.ToString());Thread.Sleep(8000);return 1;}}`);
fs.writeFileSync(path.join(compilerDir,'child.js'),`require('node:fs').writeFileSync(${JSON.stringify(childMarker)},String(process.pid));setTimeout(()=>process.exit(0),8000)`);
const build=spawnWindowsOwned(path.join(framework,'csc.exe'),['/nologo','/noconfig','/target:exe','/reference:'+path.join(framework,'System.dll'),'/out:'+path.join(compilerDir,'csc.exe'),cs],{cwd:root,env:process.env,terminateDescendantsOnRootExit:true});build.stdout.resume();build.stderr.resume();const built=await waitWindowsOwned(build,{timeoutMs:15000});if(built.code!==0)throw Error('owned fixture compile failed');
fs.writeFileSync(path.join(hooks,'windows-process-job.ps1'),`$providerOptions=New-Object 'System.Collections.Generic.Dictionary[string,string]'\n$providerOptions.Add('CompilerDirectoryPath','${compilerDir.replaceAll("'","''")}')\n$provider=New-Object Microsoft.CSharp.CSharpCodeProvider -ArgumentList (, $providerOptions)\nAdd-Type -CodeDomProvider $provider -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'windows-process-job.cs')))\nexit 1\n`);
const wrapper=await import(pathToFileURL(path.join(hooks,'windows-owned-process.mjs')).href);
check('cold prepare requires no mutable cache or compiler',await wrapper.prepareWindowsJobHelper({timeoutMs:2000})&&!fs.existsSync(path.join(hooks,'.windows-job-cache'))&&!fs.existsSync(compilerMarker),{mutableCache:false});
for(const mode of ['cancel','timeout']){
  const marker=path.join(root,mode+'.pid'),heartbeat=path.join(root,mode+'.heartbeat');
  const child=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),20);setTimeout(()=>process.exit(0),15000)`;
  const code=`const cp=require('node:child_process');cp.spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,windowsHide:true,stdio:['ignore',process.stdout,process.stderr]}).unref();setInterval(()=>{},1000);setTimeout(()=>process.exit(0),15000)`;
  const proc=wrapper.spawnWindowsOwned(process.execPath,['-e',code],{cwd:root,env:process.env,terminateDescendantsOnRootExit:true});proc.stdout.resume();proc.stderr.resume();
  const control=new AbortController(),start=performance.now(),done=wrapper.waitWindowsOwned(proc,{timeoutMs:mode==='timeout'?1200:10000,signal:control.signal});
  await until(()=>fs.existsSync(marker));const pid=Number(fs.readFileSync(marker));if(mode==='cancel')control.abort();const result=await done;
  const atReturnAlive=alive(pid),writes=fs.existsSync(heartbeat)?fs.statSync(heartbeat).size:0;await wait(150);const delta=(fs.existsSync(heartbeat)?fs.statSync(heartbeat).size:0)-writes;
  check('former pre-Job '+mode+' gap closes after real child readiness',!atReturnAlive&&!delta&&!fs.existsSync(compilerMarker)&&!fs.existsSync(childMarker)&&!result.terminationUncertain&&result[mode==='cancel'?'cancelled':'timedOut'],{result,ms:performance.now()-start,pid,atReturnAlive,postReturnWrites:delta,compilerInvoked:fs.existsSync(compilerMarker)});
}
const target=path.join(root,'must-not-run'),asset=path.join(hooks,'windows-job-runtime.exe'),saved=fs.readFileSync(asset);
for(const fault of ['missing','tampered']){
  if(fault==='missing')fs.unlinkSync(asset);else fs.writeFileSync(asset,Buffer.from('invalid'));
  let rejected=false;try{wrapper.spawnWindowsOwned(process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(target)},'ran')`],{cwd:root,env:process.env})}catch(e){rejected=e.message.includes('release asset')}
  check(fault+' immutable asset fails closed without compiler or target',rejected&&!fs.existsSync(target)&&!fs.existsSync(compilerMarker),{rejected});fs.writeFileSync(asset,saved);
}
const recovered=wrapper.spawnWindowsOwned(process.execPath,['-e','console.log("恢复中文");process.exit(37)'],{cwd:root,env:process.env});let output='';recovered.stdout.on('data',b=>output+=b);recovered.stderr.resume();const recovery=await wrapper.waitWindowsOwned(recovered,{timeoutMs:3000});check('restored release recovers with exact exit and Unicode',recovery.code===37&&output.includes('恢复中文'),{recovery,output});
const before=fs.readFileSync(path.join(hooks,'windows-process-job.cs'),'utf8');fs.writeFileSync(path.join(hooks,'windows-process-job.cs'),before.replaceAll('\n','\r\n'));check('LF and CRLF checkouts share source digest',await wrapper.prepareWindowsJobHelper({timeoutMs:2000}),{});
const aborted=new AbortController();aborted.abort();check('pre-cancel prepare launches no helper',await prepareWindowsJobHelper({signal:aborted.signal,timeoutMs:2000})===false,{});
const result={node:process.version,root,rows,passed:rows.every(r=>r.passed),noRuntimeCompiler:true,noGlobalChanges:true};fs.writeFileSync(process.argv[2]??path.join(root,'results.json'),JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
