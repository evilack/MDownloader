/** Trusted bootstrap; serialized into a worker owned by the opaque sandbox. */
function YoutubeEvaluatorWorkerBoot()
{
 'use strict';
 const Reply=globalThis.postMessage.bind(globalThis),Close=globalThis.close.bind(globalThis);
 for(const Name of ['fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource','Worker','SharedWorker','importScripts','chrome','browser','indexedDB','caches','navigator','FileReader','BroadcastChannel','MessageChannel'])
 {
  for(let Target=Object.getPrototypeOf(globalThis);Target&&Target!==Object.prototype;Target=Object.getPrototypeOf(Target))if(Object.hasOwn(Target,Name))Object.defineProperty(Target,Name,{value:undefined,writable:false,configurable:false});
  Object.defineProperty(globalThis,Name,{value:undefined,writable:false,configurable:false});
 }
 globalThis.console=Object.freeze({log(){},warn(){},error(){},info(){},debug(){}});
 globalThis.onmessage=Event=>{
  globalThis.onmessage=null;
  try{
   const Script=Event.data?.script;
   if(typeof Script!=='string'||new TextEncoder().encode(Script).length>4*1024**2)throw Error();
   const Values=['sig','sp','n'].map(Key=>{const Value=Event.data.environment?.[Key];if(Value!==undefined&&(typeof Value!=='string'||Value.length>8192))throw Error();return Value;});
   // unsafe-eval is permitted only in this sandbox worker, never in an extension page.
   const Value=new Function('sig','sp','n',Script)(...Values);
   if(!Value||typeof Value!=='object'||['sig','n'].some(Key=>Value[Key]!==undefined&&(typeof Value[Key]!=='string'||Value[Key].length>8192)))throw Error();
   Reply({ok:true,value:{sig:Value.sig,n:Value.n}});
  }catch{Reply({ok:false});}
  finally{Close();}
 };
}
