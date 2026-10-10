// Explicit release-maintainer action, never an install/startup fallback.
// Reuses the previous hash-verified managed asset to own the compiler tree.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';
import {quoteWindowsArgument} from '../hooks/windows-owned-process.mjs';
if(process.platform!=='win32') throw Error('Rebuild the managed Windows asset on Windows; other hosts run assert-windows-job');
const hooks=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../hooks'),sha=b=>createHash('sha256').update(b).digest('hex');
const helper=path.join(hooks,'windows-job-runtime.exe'),manifest=JSON.parse(fs.readFileSync(path.join(hooks,'windows-job-runtime.json'),'utf8'));
if(manifest.protocol!=='CMJ1'||fs.statSync(helper).size!==manifest.bytes||sha(fs.readFileSync(helper))!==manifest.sha256)throw Error('Previous release asset unavailable; refusing unowned compiler bootstrap');
const framework=path.join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319'),compiler=path.join(framework,'csc.exe');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctx-managed-job-build-')),output=path.join(dir,'job.exe');
const sources=['windows-process-job.cs','windows-job-entry.cs'];
const args=['/nologo','/noconfig','/nostdlib+','/platform:anycpu','/target:exe','/out:'+output,'/reference:'+path.join(framework,'mscorlib.dll'),'/reference:'+path.join(framework,'System.dll'),...sources.map(f=>path.join(hooks,f))];
const environment=Object.entries(process.env).filter(([,v])=>v!==undefined).map(([k,v])=>k+'='+v).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase())).join('\0')+'\0\0';
const header=Buffer.alloc(4);header.writeInt32LE(0x314a4d43);
const fields=[compiler,[compiler,...args].map(quoteWindowsArgument).join(' '),hooks,environment,''].flatMap(value=>{const bytes=Buffer.from(value,'utf8'),size=Buffer.alloc(4);size.writeInt32LE(bytes.length);return [size,bytes]});
const proc=spawn(helper,[],{cwd:hooks,windowsHide:true,stdio:['pipe','pipe','pipe']});
let diagnostic='',killTimer,grace,timedOut=false,finish;const append=b=>{if(diagnostic.length<8192)diagnostic+=b.toString('utf8').slice(0,8192-diagnostic.length)};proc.stdout.on('data',append);proc.stderr.on('data',append);proc.stdin.on('error',()=>{});
const timer=setTimeout(()=>{timedOut=true;proc.stdin.end();killTimer=setTimeout(()=>proc.kill('SIGKILL'),1200);grace=setTimeout(()=>{proc.stdin.destroy();proc.stdout.destroy();proc.stderr.destroy();proc.unref();finish(null)},1500)},15000);
proc.stdin.write(Buffer.concat([header,...fields,Buffer.from([1])]));
const code=await new Promise((resolve,reject)=>{finish=resolve;proc.once('error',reject);proc.once('close',resolve)}).finally(()=>{clearTimeout(timer);clearTimeout(killTimer);clearTimeout(grace)});
if(code!==0||timedOut)throw Error('Owned managed release compile failed: '+diagnostic);
const bytes=fs.readFileSync(output),metadata={protocol:'CMJ1',sources:Object.fromEntries(sources.map(f=>[f,sha(Buffer.from(fs.readFileSync(path.join(hooks,f),'utf8').replaceAll('\r\n','\n')))])),sha256:sha(bytes),bytes:bytes.length,build:{compiler:'Microsoft .NET Framework v4.0.30319 csc.exe',compilerSha256:sha(fs.readFileSync(compiler)),platform:'AnyCPU',sourceEncoding:'UTF-8 LF normalized'}};
// Run only against a maintainer checkout. Do not rebuild an active installation.
fs.writeFileSync(helper,bytes);fs.writeFileSync(path.join(hooks,'windows-job-runtime.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({bytes:bytes.length,sha256:metadata.sha256,compilerOwned:true}));
