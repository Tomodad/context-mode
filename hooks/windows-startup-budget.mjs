import {performance} from 'node:perf_hooks';
const key=Symbol.for('context-mode.windows-startup-budget');
export function beginWindowsStartupBudget(timeoutMs=25000) {
  if(process.platform!=='win32') return null;
  if(globalThis[key]) return globalThis[key];
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new RangeError('Invalid startup deadline');
  const controller=new AbortController(),end=performance.now()+timeoutMs;
  let stage='release asset',grace;
  const timer=setTimeout(()=>{
    process.stderr.write(`[context-mode] Windows startup deadline exceeded at ${stage}; retry after correcting this stage\n`);
    controller.abort();
    grace=setTimeout(()=>process.exit(1),1500);
  },timeoutMs);
  const budget={
    signal:controller.signal,
    remaining(limit=timeoutMs) { this.assert(); return Math.max(1,Math.min(limit,Math.floor(end-performance.now()))); },
    assert() { if(controller.signal.aborted||performance.now()>=end) {controller.abort();throw Error('Windows startup deadline exceeded');} },
    stage(value) {this.assert();stage=value;},
    complete() {this.assert();clearTimeout(timer);clearTimeout(grace);delete globalThis[key];},
  };
  globalThis[key]=budget;
  return budget;
}
export function windowsStartupBudget() {return globalThis[key]??null;}
export function windowsStartupOptions(limit=180000) {
  const budget=windowsStartupBudget();
  return budget?{timeoutMs:budget.remaining(limit),signal:budget.signal}:{};
}
