// Product policy belongs to the extension; the native bridge only observes headers.
const Host='com.mdownloader.kakao';
const Filter=Object.freeze({host:'dapi.kakao.com',pathPrefix:'/translation/v2/translate.json',headerName:'authorization'});
const TimeoutMs=120000;
export function SelectKakaoCaptureProcess(Processes){
 if(!Array.isArray(Processes))throw Error('capture_process_selection');
 const Matches=Processes.filter(P=>typeof P?.name==='string'&&['potplayermini64.exe','potplayer64.exe'].includes(P.name.toLowerCase()));
 if(Matches.length!==1||!Number.isInteger(Matches[0].pid)||Matches[0].pid<1||Matches[0].pid>4294967295)throw Error('capture_process_selection');
 return Matches[0].pid;
}
export function ParseKakaoCaptureHeaders(Headers){
 if(typeof Headers!=='string'||Headers.length>65536)throw Error('capture_credential_missing');
 const Values=Headers.split(/\r?\n/).filter(Line=>/^authorization:/i.test(Line));
 const Match=Values.length===1&&/^authorization:[\t ]*KakaoAK[\t ]+([!-~]+)[\t ]*$/i.exec(Values[0]);
 if(!Match)throw Error('capture_credential_missing');return Match[1];
}
export function StartKakaoCapture({connect=()=>chrome.runtime.connectNative(Host),onMessage=()=>{},onDisconnect=()=>{}}={}){
 const Port=connect();let Phase='ping',Closed=false,Timer;
 const Stop=()=>{if(Closed)return;Closed=true;clearTimeout(Timer);Port.disconnect();};
 const Failure=Code=>{if(Closed)return;const Result=onMessage({status:'error',code:Code});Stop();return Result;};
 const Deadline=Ms=>{clearTimeout(Timer);Timer=setTimeout(()=>Failure('capture_timeout'),Ms);};
 Port.onMessage.addListener(Message=>{
  if(Closed)return;
  try{
   if(Phase==='ping'){
    if(Message?.ok!==true||Message.captureProtocol!==2||!Message.capabilities?.includes('listProcesses')||!Message.capabilities?.includes('captureHeaders'))return Failure('capture_helper_update_required');
    Phase='processes';Port.postMessage({action:'listProcesses'});return;
   }
   if(Message?.ok!==true||Message.status==='error')return Failure(Message?.code||'capture_failed');
   if(Phase==='processes'){
    const Pid=SelectKakaoCaptureProcess(Message.processes);Phase='capture';Deadline(TimeoutMs+10000);
    Port.postMessage({action:'capture',pid:Pid,timeoutMs:TimeoutMs,filter:{...Filter}});return;
   }
   if(Message.status==='waiting')return onMessage({status:'waiting'});
   if(Message.status==='captured'){
    const Key=ParseKakaoCaptureHeaders(Message.headers);Phase='captured';Stop();
    return onMessage({status:'captured',key:Key});
   }
   return Failure('capture_invalid_reply');
  }catch(ErrorValue){return Failure(ErrorValue?.message||'capture_failed');}
 });
 Port.onDisconnect.addListener(()=>{void globalThis.chrome?.runtime?.lastError;if(Closed)return;Closed=true;clearTimeout(Timer);onDisconnect();});
 Deadline(15000);try{Port.postMessage({action:'ping'});}catch(ErrorValue){Stop();throw ErrorValue;}
 return {disconnect:Stop};
}
