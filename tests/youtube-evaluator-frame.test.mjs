import{test}from'node:test';
import assert from'node:assert/strict';
import{CreateSandboxEvaluatorWorker}from'../extension/features/youtube/evaluator-frame.js';
import{CreateEvaluator}from'../extension/features/youtube/evaluator.js';
test('sandbox disposal waits for worker termination acknowledgement before removing its frame',async()=>{
 const previous=globalThis.document;let stopped=false,removedBeforeStop=false,removed=false,frame;
 globalThis.document={createElement(){const listeners=new Map();frame={contentWindow:{postMessage(message,origin,ports){const port=ports[0];port.onmessage=event=>{if(event.data.kind==='evaluate')port.postMessage({ok:true,value:{n:'fixture'}});if(event.data.kind==='dispose')setTimeout(()=>{stopped=true;port.postMessage({disposed:true});port.close();},5);};port.postMessage({ready:true});}},addEventListener(name,fn){listeners.set(name,fn);},remove(){removedBeforeStop=!stopped;removed=true;},load(){listeners.get('load')();}};return frame;},body:{append(value){queueMicrotask(()=>value.load());}}};
 try{const worker=CreateSandboxEvaluatorWorker();const response=new Promise(resolve=>worker.onmessage=resolve);worker.postMessage({script:'return {n:"fixture"};',environment:{}});await response;await worker.terminate();assert.equal(stopped,true);assert.equal(removed,true);assert.equal(removedBeforeStop,false);}finally{globalThis.document=previous;}
});
test('evaluator waits for asynchronous disposal before resolving a successful evaluation',async()=>{
 let disposed=false;
 const evaluate=CreateEvaluator({createWorker:()=>({postMessage(){queueMicrotask(()=>this.onmessage({data:{ok:true,value:{n:'fixture'}}}));},async terminate(){await new Promise(resolve=>setTimeout(resolve,5));disposed=true;}})});
 await evaluate({output:'return {n:"fixture"};'});assert.equal(disposed,true);
});
