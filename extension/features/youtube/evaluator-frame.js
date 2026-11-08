import{CanUseYoutube}from'../../lib/distribution-policy.js';
export function CreateSandboxEvaluatorWorker()
{
 if(!CanUseYoutube())throw Error('youtube_distribution_disabled');
 const Frame=document.createElement('iframe'),Channel=new MessageChannel();let Pending,Ready=false,Closed=false,Cleanup,FinishCleanup;
 const Remove=()=>{Channel.port1.close();Channel.port2.close();Frame.remove();};
 const Adapter={onmessage:null,onerror:null,postMessage(Value){if(Closed)return;Pending=Value;if(Ready)Channel.port1.postMessage({kind:'evaluate',payload:Pending});},terminate(){
  if(Closed)return Cleanup;Closed=true;
  if(!Ready){Remove();return Promise.resolve();}
  Cleanup=new Promise((Resolve,Reject)=>{const Timer=setTimeout(()=>{Remove();Reject(Error('evaluator_cleanup_failed'));},1000);FinishCleanup=()=>{clearTimeout(Timer);Remove();Resolve();};Channel.port1.postMessage({kind:'dispose'});});return Cleanup;
 }};
 Channel.port1.onmessage=Event=>{if(Event.data?.disposed){FinishCleanup?.();return;}if(Closed)return;if(Event.data?.ready){Ready=true;if(Pending)Channel.port1.postMessage({kind:'evaluate',payload:Pending});}else Adapter.onmessage?.({data:Event.data});};
 Channel.port1.onmessageerror=()=>Adapter.onerror?.();
 Frame.hidden=true;Frame.src=new URL('./evaluator-sandbox.html',import.meta.url).href;
 Frame.addEventListener('load',()=>{if(!Closed)Frame.contentWindow.postMessage({kind:'youtube-evaluator-init'},'*',[Channel.port2]);},{once:true});
 Frame.addEventListener('error',()=>Adapter.onerror?.(),{once:true});
 (document.body??document.documentElement).append(Frame);return Adapter;
}
