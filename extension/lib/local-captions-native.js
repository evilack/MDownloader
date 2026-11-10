export const CaptionHostName='com.mdownloader.captions';
export function CreateCaptionNativeClient(Api,OnEvent=()=>{})
{
 let Port,Sequence=0,Scopes=new Map();const Pending=new Map();
 function Connect(){
  if(Port)return Port;
  Port=Api.runtime.connectNative(CaptionHostName);const Current=Port,CurrentScopes=new Map();Scopes=CurrentScopes;
  Current.onMessage.addListener(Message=>{
   if(Current!==Port)return;
   if(Message?.event){OnEvent(Message);return;}
   const P=Pending.get(Message?.id);if(!P)return;Pending.delete(Message.id);
   if(Message.ok&&['complete','forget','cancel'].includes(P.action)&&CurrentScopes.get(P.jobId)===P.attempt)CurrentScopes.delete(P.jobId);
   if(Message.ok&&P.attempt!==undefined&&Message.data?.attempt!==undefined&&Message.data.attempt!==P.attempt)P.reject(new Error('caption_stale_attempt'));
   else if(Message.ok)P.resolve(Message.data);else P.reject(new Error(typeof Message.error==='string'?Message.error:'caption_native_failed'));
  });
  Current.onDisconnect.addListener(()=>{const Reason=Api.runtime.lastError?.message;if(Current!==Port)return;Port=undefined;for(const P of Pending.values())P.reject(new Error('caption_helper_missing'));Pending.clear();OnEvent({event:'disconnected',reason:Reason,jobs:[...CurrentScopes].map(([jobId,attempt])=>({jobId,attempt}))});});
  return Current;
 }
 return {
  request(Message){return new Promise((resolve,reject)=>{const Id=++Sequence;try{const P=Connect();if(Message.jobId)Scopes.set(Message.jobId,Message.attempt);Pending.set(Id,{resolve,reject,attempt:Message.attempt,jobId:Message.jobId,action:Message.action});P.postMessage({...Message,id:Id});}catch{Pending.delete(Id);reject(new Error('caption_helper_missing'));}});},
  reset(){
   const Previous=Port;Port=undefined;
   for(const P of Pending.values())P.reject(new Error('caption_helper_missing'));Pending.clear();
   try{Previous?.disconnect();}catch{}
  },
 };
}
