/** Download and request opening; completion requires a real native reply. */
export async function RunOneClickSetup({download,open,probe,signal,onState=()=>{},timeout=300000,now=Date.now,wait=Ms=>new Promise(R=>setTimeout(R,Ms))})
{
 signal?.throwIfAborted();const End=now()+timeout;let Timer,Abort;
 const Stop=new Promise((_,Reject)=>{
  Timer=setTimeout(()=>Reject(Error('setup_connection_timeout')),timeout);
  Abort=()=>Reject(signal.reason??new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',Abort,{once:true});
 });
 // Invoke each callback immediately; deferred work could lose the original user gesture.
 const Bound=PromiseValue=>Promise.race([PromiseValue,Stop]);
 try{
  onState('downloading');const Id=await Bound(download());signal?.throwIfAborted();
  onState('starting');await Bound(open(Id));signal?.throwIfAborted();
  onState('installing');
  while(now()<End){signal?.throwIfAborted();let Status;try{Status=await Bound(probe());}catch(ErrorValue){if(ErrorValue?.message==='setup_connection_timeout'||signal?.aborted)throw ErrorValue;}
   if(Status?.connected){onState('complete');return Status;}await Bound(wait(800));
  }
  throw new Error('setup_connection_timeout');
 }finally{clearTimeout(Timer);signal?.removeEventListener('abort',Abort);}
}
