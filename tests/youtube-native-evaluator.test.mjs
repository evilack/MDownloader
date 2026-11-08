import{test}from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import vm from'node:vm';
const source=await readFile(new URL('../extension/features/youtube/evaluator-native-worker.js',import.meta.url),'utf8');
function run(script,environment={},setup=''){const messages=[];const context=vm.createContext({postMessage:value=>messages.push(JSON.parse(JSON.stringify(value))),close(){},TextEncoder});if(setup)vm.runInContext(setup,context);vm.runInContext(source,context);vm.runInContext('YoutubeEvaluatorWorkerBoot()',context);context.onmessage({data:{script,environment}});return messages[0];}
test('native isolated evaluator executes a function body and constructor prototypes',()=>{
 assert.deepEqual(run('function C(value){this.value=value;} C.prototype.get=function(){return this.value;}; return {n:new C(n).get()};',{n:'fixture'}),{ok:true,value:{n:'fixture'}});
});
test('native isolated evaluator removes network storage and extension capabilities',()=>{
 assert.deepEqual(run('return {n:[typeof fetch,typeof Worker,typeof chrome,typeof indexedDB,typeof importScripts,typeof BroadcastChannel].join(",")};'),{ok:true,value:{n:'undefined,undefined,undefined,undefined,undefined,undefined'}});
});
test('blocked capabilities cannot be recovered from the worker global prototype',()=>{
 assert.deepEqual(run('return {n:typeof Object.getPrototypeOf(globalThis).fetch};',{},'Object.setPrototypeOf(globalThis,{fetch(){return "network";}})'),{ok:true,value:{n:'undefined'}});
});
test('native evaluator bounds input and results and never forwards thrown text',()=>{
 for(const script of ['x'.repeat(4*1024**2+1),'return {n:"x".repeat(8193)};','throw Error("private-source-token");']){
  assert.deepEqual(run(script),{ok:false});
 }
});
