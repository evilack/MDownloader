/** No extension APIs; only a private channel from the embedding parent is accepted. */
'use strict';
addEventListener('message',function Initialize(Event){
 if(Event.source!==parent||Event.data?.kind!=='youtube-evaluator-init'||Event.ports.length!==1)return;
 removeEventListener('message',Initialize);
 const Port=Event.ports[0];let WorkerInstance,Used=false;
 Port.onmessage=Event=>{
  if(Event.data?.kind==='dispose'){WorkerInstance?.terminate();Port.postMessage({disposed:true});Port.close();return;}
  if(Used||Event.data?.kind!=='evaluate')return;Used=true;
  try{
   const Url=URL.createObjectURL(new Blob([`(${YoutubeEvaluatorWorkerBoot.toString()})()`],{type:'text/javascript'}));
   WorkerInstance=new Worker(Url);URL.revokeObjectURL(Url);
   WorkerInstance.onmessage=Message=>{const Result=Message.data;const Value=Result?.value;if(Result?.ok&&Value&&typeof Value==='object'&&['sig','n'].every(Key=>Value[Key]===undefined||(typeof Value[Key]==='string'&&Value[Key].length<=8192)))Port.postMessage({ok:true,value:{sig:Value.sig,n:Value.n}});else Port.postMessage({ok:false});WorkerInstance.terminate();};
   WorkerInstance.onerror=()=>{Port.postMessage({ok:false});WorkerInstance.terminate();};
   WorkerInstance.postMessage(Event.data.payload);
  }catch{Port.postMessage({ok:false});WorkerInstance?.terminate();}
 };
 Port.postMessage({ready:true});
});
