import {RequestExplorer} from './explorer-native.js';
import {CommonHelperConnected,CommonHelperReady} from './common-helper-contract.js';
import {CaptionRuntimeReady} from './caption-runtime-contract.js';
export {MinimumHelperVersion} from './common-helper-contract.js';

export async function ProbeCommonHelper(Request=RequestExplorer){
 try{const R=await Request({action:'ping'});const Connected=CommonHelperConnected(R),Ready=CommonHelperReady(R);return {connected:Connected,ready:Ready,helperVersion:R?.helperVersion,helperRevision:R?.helperRevision,platform:R?.platform,reason:Ready?'ready':Connected?'update-required':R?.code==='origin_denied'?'permission':'invalid-response'};}
 catch(ErrorValue){return {connected:false,ready:false,reason:ErrorValue?.reason||'unavailable'};}
}
export async function InstallCaptionsWithCommonHelper(Probe,OnState=()=>{},{request=RequestExplorer,wait=Ms=>new Promise(R=>setTimeout(R,Ms)),now=Date.now,timeout=1200000,bundle}={}){
 const End=now()+timeout;let Timer;
 const Deadline=new Promise((_,Reject)=>{Timer=setTimeout(()=>Reject(Error('common_setup_timeout')),timeout);});
 const Call=Value=>Promise.race([Value,Deadline]);
 try{
  const Helper=await Call(ProbeCommonHelper(request));
  if(!Helper.connected)throw Error('common_helper_missing');if(!Helper.ready)throw Error('common_helper_update_required');
  OnState('installing');let State=await Call(request({action:'installCaptions',...(bundle?{package:bundle}:{})}));
  if(!State?.ok)throw Error(State?.code||'common_setup_failed');
  const JobId=State.jobId;if(!/^[a-f0-9]{32}$/.test(JobId??''))throw Error('common_setup_invalid_reply');
  let LastStage='installing';
  while(now()<End){
   if(!State.ok||State.status==='failed')throw Error(State.error||State.code||'common_setup_failed');
   if(State.status==='complete'){
    if(LastStage!=='verifying'){OnState('verifying');LastStage='verifying';}
    const Result=await Call(Probe());if(CaptionRuntimeReady(Result)&&(!bundle||Result.captionPackageVersion>=bundle.packageVersion)){OnState('complete');return Result;}
   }
   await Call(wait(1000));State=await Call(request({action:'captionSetupStatus',jobId:JobId}));
   if(State?.jobId!==JobId)throw Error('common_setup_invalid_reply');
  }
  throw Error('common_setup_timeout');
 }finally{clearTimeout(Timer);}
}
