import {CreateElement,CreateButton} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';
import {CreateSettingsDialog} from './settings-dialog.js';
const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
function DownloadError(Code){
 const Messages={
  caption_disk_full:['모델을 저장할 공간이 부족합니다. 모델 설치 드라이브의 여유 공간을 확보해 주세요.','There is not enough space on the model installation drive. Free up space and try again.'],
  caption_model_permission:['모델 파일을 쓰거나 이동하지 못했습니다. 폴더 쓰기 권한과 파일을 사용 중인 프로그램을 확인해 주세요.','Could not write or move the model files. Check folder permissions and programs using those files.'],
  caption_model_timeout:['모델 서버 응답 시간이 초과되었습니다. 연결을 확인하고 다시 시도해 주세요.','The model server timed out. Check your connection and try again.'],
  caption_model_network_failed:['모델 서버에 연결하지 못했거나 전송이 중단되었습니다. 네트워크 연결을 확인해 주세요.','The model server could not be reached or the transfer was interrupted. Check your network connection.'],
  caption_model_tls_failed:['모델 서버의 보안 연결을 확인하지 못했습니다. 시스템 시간과 네트워크 인증서를 확인해 주세요.','Could not verify the secure connection. Check your system clock and network certificates.'],
  caption_model_access_denied:['모델 서버가 다운로드 접근을 거부했습니다. 네트워크나 프록시의 차단 여부를 확인해 주세요.','The model server denied access. Check network or proxy restrictions.'],
  caption_model_unavailable:['선택한 모델 파일을 서버에서 찾을 수 없습니다.','The selected model files are unavailable on the server.'],
  caption_model_rate_limited:['모델 서버의 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.','The model server request limit was reached. Try again later.'],
  caption_model_metadata_invalid:['모델 파일의 크기나 검증 정보를 확인하지 못했습니다. 다시 시도해 주세요.','Could not verify the model file sizes or metadata. Try again.'],
  caption_model_incomplete:['모델 파일 전송이 끝까지 완료되지 않았습니다. 다시 다운로드해 주세요.','The model file transfer was incomplete. Download it again.'],
  caption_model_invalid:['다운로드한 모델 파일의 검증에 실패했습니다. 다시 다운로드해 주세요.','The downloaded model files failed verification. Download them again.'],
  caption_model_worker_failed:['모델 다운로드 프로그램이 예기치 않게 종료되었습니다. 도우미를 업데이트하거나 다시 시도해 주세요.','The model downloader exited unexpectedly. Update the helper or try again.'],
  caption_model_worker_crashed:['모델 다운로드 프로그램에서 런타임 충돌이 발생했습니다. 도우미 탭에서 최신 설치 파일로 업데이트해 주세요.','The model downloader crashed. Update it with the latest installer from the Helper tab.'],
  caption_model_monitor_failed:['모델 다운로드 프로그램의 종료 감시에 실패했습니다. 도우미를 업데이트한 뒤 다시 시도해 주세요.','The model downloader could not monitor its parent process. Update the helper and try again.'],
  caption_model_io_failed:['모델 파일을 저장하지 못했습니다. 모델 폴더와 드라이브 상태를 확인해 주세요.','Could not save the model files. Check the model folder and drive.'],
  caption_engine_missing:['음성 인식 엔진이 준비되지 않았습니다. 도우미 탭에서 설치를 완료해 주세요.','The speech recognition engine is not ready. Complete setup from the Helper tab.'],
  caption_helper_missing:['도우미 연결이 끊어졌습니다. 도우미 탭에서 연결을 확인해 주세요.','The helper disconnected. Check its connection from the Helper tab.'],
  caption_busy:['다른 모델 작업이 진행 중입니다. 작업이 끝난 뒤 다시 시도해 주세요.','Another model operation is in progress. Try again after it finishes.'],
 };
 return Messages[Code]?T(...Messages[Code]):T('모델 다운로드에 실패했습니다. 아래 오류 코드로 원인을 확인해 주세요.','The model download failed. Use the error code below to identify the cause.');
}
export function ShowCaptionModelDownload({engine,model,label,prepare,cancel})
{
 const operationId=crypto.randomUUID().replaceAll('-',''),Options={engine,model,operationId};
 const {dialog,body,footer}=CreateSettingsDialog(T('모델 다운로드','Download model'));
 const Name=CreateElement('p',label),Status=CreateElement('p',T('다운로드 준비 중…','Preparing download…')),Stats=CreateElement('p','','muted'),ErrorCode=CreateElement('p','','muted'),Progress=CreateElement('progress','','caption-model-progress');
 Status.id='model-status-'+operationId;Status.setAttribute('role','status');Progress.max=100;Progress.setAttribute('aria-label',T('모델 다운로드 진행률','Model download progress'));Progress.removeAttribute('value');ErrorCode.hidden=true;body.append(Name,Status,Progress,Stats,ErrorCode);
 let Closed=false,Settled=false,CancelRequested=false,Resolve,Outcome={canceled:true};const result=new Promise(R=>{Resolve=R;});
 const Button=CreateButton(T('취소','Cancel'),()=>void RequestCancel());Button.autofocus=true;Button.setAttribute('aria-describedby',Status.id);footer.append(Button);
 async function RequestCancel(){
  if(Settled){dialog.close();return;}if(CancelRequested)return;
  CancelRequested=true;Button.disabled=true;Status.textContent=T('다운로드 취소 중…','Canceling download…');
  try{const Response=await cancel(Options);if(Response?.canceled===false&&!Closed)Status.textContent=T('다운로드 완료 상태를 확인하고 있습니다…','Checking whether the download has finished…');}
  catch{CancelRequested=false;Button.disabled=false;Status.textContent=T('취소 요청을 보내지 못했습니다. 다시 시도해 주세요.','Could not send the cancellation request. Try again.');}
 }
 dialog.addEventListener('cancel',Event=>{if(!Settled){Event.preventDefault();void RequestCancel();}});
 dialog.addEventListener('close',()=>{
  Closed=true;if(!Settled&&!CancelRequested){CancelRequested=true;void cancel(Options).catch(()=>{});}
  dialog.returnValue='';dialog.remove();Resolve(Outcome);
 },{once:true});
 dialog.showModal();
 void (async()=>{
  try{
   await prepare(Options);Outcome={success:true,canceled:false};Settled=true;if(!Closed)dialog.close('complete');
  }catch(ErrorValue){
   Settled=true;Outcome={success:false,canceled:ErrorValue?.message==='caption_canceled'};
   if(Closed)return;
   if(Outcome.canceled){dialog.close('canceled');return;}
   if(!Progress.hasAttribute('value')){Progress.value=0;Stats.hidden=true;}
   const Code=/^caption_[a-z_]+$/.test(ErrorValue?.message||'')?ErrorValue.message:'caption_model_download_failed';
   Status.textContent=DownloadError(Code);Status.dataset.error='true';ErrorCode.textContent=T('오류 코드: ','Error code: ')+Code;ErrorCode.hidden=false;Button.disabled=false;Button.textContent=T('닫기','Close');
  }
 })();
 return {operationId,result,cancel:RequestCancel,update(Event){
  if(Closed||Settled||Event.operationId!==operationId||Event.engine!==engine||Event.model!==model)return;
  if(!CancelRequested){const Text=Event.phase==='model-queued'?T('다른 모델 작업이 끝나기를 기다리는 중…','Waiting for another model operation…'):Event.phase==='model-metadata'?T('모델 다운로드 크기를 확인하는 중…','Checking the model download size…'):Event.phase==='model-verifying'?T('모델 파일을 확인하고 설치를 마무리하는 중…','Verifying model files and completing installation…'):Event.phase==='model-ready'?T('모델 다운로드를 완료했습니다.','Model download complete.'):T('모델 다운로드 중…','Downloading model…');if(Status.textContent!==Text)Status.textContent=Text;}
  const Format=new Intl.NumberFormat(GetLocale(),{minimumFractionDigits:1,maximumFractionDigits:1});
  if(Number.isFinite(Event.total)&&Event.total>0&&Number.isFinite(Event.received)&&Event.received>=0){const Percent=Event.phase==='model-ready'?100:Math.min(99.9,Event.received/Event.total*100);Progress.value=Percent;Stats.textContent=Format.format(Percent)+'% · '+Format.format(Math.min(Event.received,Event.total)/1_000_000)+' / '+Format.format(Event.total/1_000_000)+' MB';}
  else if(Number.isFinite(Event.received)&&Event.received>=0){Progress.removeAttribute('value');Stats.textContent=Event.received?Format.format(Event.received/1_000_000)+T(' MB 다운로드됨',' MB downloaded'):T('전체 크기 확인 중','Checking total size');}
 }};
}
