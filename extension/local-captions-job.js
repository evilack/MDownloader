import {CaptionText as T} from './local-captions-ui.js';
import {SendRequest,CreateElement,CreateButton} from './lib/ui.js';
import {CaptionProcessingPolicy} from './data/caption-runtime-metadata.js';
import {RememberLiveCaptionFile,ForgetLiveCaptionFile,LiveCaptionFileName} from './lib/live-caption-file-store.js';
const Phases={waiting:['영상 저장 후 생성 대기','Waiting for the video to be saved'],staging:['오디오 전달 중','Staging audio'],preparing:['오디오 준비 중','Preparing audio'],'audio-ready':['오디오 준비됨 · 영상 저장 대기','Audio ready · Waiting for video save'],queued:['음성 인식 대기','Queued for recognition'],'loading-model':['음성 인식 모델 불러오는 중','Loading speech recognition model'],'windowed-ready':['인식 결과 정리 중','Preparing recognition results'],recognizing:['음성 인식 중','Recognizing speech'],recognized:['자막 저장 대기','Waiting to save captions'],saving:['자막 저장 중','Saving captions'],translating:['생성한 자막 번역 중','Translating generated captions'],complete:['생성 완료','Complete'],failed:['생성 실패 · 영상은 별도로 저장됩니다','Failed · Video save is independent'],canceled:['자막 생성 취소됨','Caption generation canceled']};
Phases['metadata-waiting']=['원본 파일의 오디오 메타데이터 수신 대기','Waiting for audio metadata from the original file'];
const Errors={caption_engine_options_unsupported:['이 도우미에서 지원하지 않는 인식 옵션입니다. 프리셋을 변경하거나 도우미를 업데이트해 주세요.','This helper does not support the selected recognition option. Change the preset or update the helper.'],caption_output_failed:['최종 자막 파일을 만들지 못했습니다.','Could not create the final captioned output.'],caption_translation_failed:['번역 실패 · 원본 음성 자막은 저장되었습니다','Translation failed · Original speech captions were saved'],caption_helper_update_required:['도우미 업데이트 필요','Update the helper'],caption_helper_missing:['보조 프로그램 연결 필요','Connect the helper'],caption_engine_missing:['인식 엔진 설치 필요','Install the recognition engine'],caption_model_missing:['모델 준비 필요','Prepare the model'],caption_converter_missing:['오디오 변환 도구 준비 필요','Prepare the audio converter'],caption_no_audio:['인식할 오디오 없음','No audio to recognize'],caption_source_missing:['원본 파일 또는 임시 입력 없음','Source file or cached input is missing'],caption_disk_full:['임시 저장 공간 부족','Insufficient temporary disk space'],caption_interrupted:['보조 프로그램이 종료됨','Helper was interrupted']};
export function CreateCaptionJobStatus(Job,Announce,Refresh)
{
 const Node=CreateElement('section','','caption-job'),Status=CreateElement('p','','caption-job-status'),Actions=CreateElement('div','','caption-job-actions');
 Status.setAttribute('role','status');Node.append(Status,Actions);
 let CurrentJob=Job,SelectingFile=false;
 const FileStatus=CreateElement('p','','caption-live-note'),FileButton=CreateButton(T('라이브 자막 파일 저장','Save live captions'),async()=>{
  let Key;SelectingFile=true;FileButton.disabled=true;
  try{
   const Current=CurrentJob,Scope={requestId:Current.requestId,attempt:Current.captionStatus?.attempt,controlRevision:Current.captionStatus?.controlRevision||0};
   if(typeof window.showSaveFilePicker!=='function')throw Error('caption_live_file_permission');
   // The picker is the first awaited operation, preserving the click gesture.
   const Handle=await window.showSaveFilePicker({suggestedName:LiveCaptionFileName(Current),types:[{description:T('WebVTT 자막','WebVTT subtitles'),accept:{'text/vtt':['.vtt']}}]});
   Key=await RememberLiveCaptionFile(Handle,Scope);
   await SendRequest('captionControl',{...Scope,action:'attachLiveFile',fileKey:Key});
  }catch(E){if(E.name!=='AbortError')Announce(T('라이브 자막 파일을 연결하지 못했습니다. 현재 작업 상태와 파일 권한을 확인해 주세요.','Could not attach the live caption file. Check the current job and file permission.'));}
  finally{if(Key)await ForgetLiveCaptionFile(Key).catch(()=>{});SelectingFile=false;Update(CurrentJob);}
 });
 Actions.append(FileButton);Node.append(FileStatus);
 const Transcript=CreateElement('section','','caption-live'),Title=CreateElement('p',T('라이브 음성 자막','Live speech captions'),'caption-live-title'),Note=CreateElement('p','','caption-live-note'),Lines=CreateElement('ol','','caption-live-lines');
 Lines.tabIndex=0;Lines.setAttribute('role','region');Lines.setAttribute('aria-label',T('인식한 자막 · 최근 구간','Recognized captions · recent section'));
 Transcript.hidden=true;Transcript.append(Title,Note,Lines);Node.append(Transcript);let LiveKey='';
 const Timestamp=Sample=>{const Seconds=Math.floor(Sample/CaptionProcessingPolicy.sampleRate);return [Math.floor(Seconds/3600),Math.floor(Seconds/60)%60,Seconds%60].map(N=>String(N).padStart(2,'0')).join(':');};
 function UpdateTranscript(Current){
  const Value=Current.captionStatus?.liveTranscript,Key=(Current.captionStatus?.attempt||0)+':'+(Value?.revision||0);
  if(Key===LiveKey)return;LiveKey=Key;Transcript.hidden=!Value?.cues?.length;if(Transcript.hidden){Lines.replaceChildren();return;}
  const Follow=Lines.scrollHeight-Lines.scrollTop-Lines.clientHeight<32,Rows=Value.cues.map(C=>{
   const Row=CreateElement('li','','caption-live-cue'),Time=CreateElement('span',Timestamp(C.startSample),'caption-live-time'),Text=CreateElement('span',C.text);
   Row.append(Time,Text);if(C.provisional)Row.append(CreateElement('span',T('수정될 수 있음','May be revised'),'caption-live-provisional'));return Row;
  });
  Note.textContent=T('최근 인식 구간입니다. 시간은 수신한 오디오 기준이며 최종 파일 자막과 다를 수 있습니다.','Recent recognition. Times refer to the received audio and may differ from final file captions.')+(Value.truncated?' '+T('이전 내용은 화면에서 생략했습니다.','Earlier text is omitted from this view.'):'');
  Lines.replaceChildren(...Rows);if(Follow)Lines.scrollTop=Lines.scrollHeight;
 }
 const Phase=Job.captionStatus?.phase||'waiting';
 function Action(Text,Action){const B=CreateButton(Text,async()=>{B.disabled=true;try{await SendRequest('captionControl',{requestId:Job.requestId,action:Action});}catch{Announce(T('자동 자막 작업을 변경하지 못했습니다. 연결을 확인해 주세요.','Could not update caption generation. Check the helper connection.'));}finally{B.disabled=false;Refresh([Job.requestId]);}});Actions.append(B);}
 if(!Job.captionStatus?.canceledByRestart&&['failed','canceled'].includes(Phase)&&(['complete','interrupted'].includes(Job.state)||Job.captionStatus?.retryAvailable))Action(T('자막 다시 시도','Retry captions'),'retry');
 if(Phase==='failed'){const Link=CreateElement('a',T('자동 자막 설정','Caption settings'));Link.href='options.html?section=captions';Link.target='_blank';Link.rel='noopener';Actions.append(Link);}
 function Update(Current){CurrentJob=Current;const State=Current.captionStatus||{},P=State.phase||'waiting',Label=Current.captionPipeline==='staged'?({waiting:['다운로드 완료 후 생성 대기','Waiting for download to finish'],'audio-ready':['오디오 준비됨 · 다운로드 중','Audio ready · Downloading'],recognized:['자막 준비 완료','Captions prepared'],'windowed-ready':['인식 결과 정리 중','Preparing recognition results'],'loading-model':['음성 인식 모델 불러오는 중','Loading speech recognition model'],muxing:['영상에 자막 삽입 중','Embedding captions'],saving:['최종 파일 저장 중','Saving final files'],failed:['처리 또는 저장 실패','Processing or save failed'],canceled:['다운로드 취소됨','Download canceled']}[P]||Phases[P]):P==='failed'&&State.translation==='failed'&&State.originalOutputs?.length?['자막 생성 완료 · 번역 실패','Captions generated · Translation failed']:Phases[P]||Phases.waiting;
  const Concurrent=Current.captionPipeline==='staged'&&!State.mediaReady&&['early-audio','windowed'].includes(State.mode)&&['queued','loading-model','recognizing','recognized','windowed-ready'].includes(P);
  Status.textContent=T('자동 자막 · ','Automatic captions · ')+(Concurrent?P==='loading-model'?T('다운로드 중 · 음성 인식 모델 불러오는 중','Downloading · Loading speech recognition model'):P==='windowed-ready'?T('다운로드 중 · 인식 결과 정리 중','Downloading · Preparing recognition results'):T('다운로드 중 · 음성 인식 병행','Downloading · Recognizing speech'):T(...Label))+(Current.captionPipeline==='staged'&&State.error==='caption_translation_failed'?' · '+T('번역을 완료하지 못했습니다.','Translation could not be completed.'):Errors[State.error]?' · '+T(...Errors[State.error]):'');Status.dataset.failed=String(P==='failed');
  if(P==='complete'&&State.outputs?.length)Status.textContent+=' · '+State.outputs.join(' / ');
  if(State.canceledByRestart)Status.textContent=T('앱 재시작으로 취소됨','Canceled by app restart')+(Current.restartCancellationPending||State.cancellationPending?' · '+T('작업 종료 확인 대기','Awaiting shutdown confirmation'):'');
  const File=State.liveFile,Active=State.mode==='windowed'&&['active','starting'].includes(Current.state)&&!['failed','canceled','complete'].includes(P)&&!State.cancelRequested;
  FileButton.hidden=!Active;FileButton.disabled=!Active||SelectingFile;FileButton.textContent=T(File?.filename?'라이브 자막 저장 파일 변경':'라이브 자막 파일 저장',File?.filename?'Change live caption file':'Save live captions');
  FileStatus.hidden=!File&&!Active;
  const FileLabels={'awaiting-selection':['저장할 자막 파일 선택 대기','Choose a file to save live captions'],writing:['라이브 자막 파일 갱신 중','Updating live caption file'],saved:['라이브 자막 파일 저장됨','Live caption file saved'],failed:['라이브 자막 파일 저장 실패 · 인식은 계속됩니다','Live caption save failed · Recognition continues']};
  FileStatus.textContent=T(...(FileLabels[File?.phase]|| (Current.pickedDownloadFolder?['라이브 자막 파일 준비 중','Preparing live caption file']:FileLabels['awaiting-selection'])))+(File?.filename?' · '+File.filename:'');
  if(File?.error==='caption_live_file_conflict')FileStatus.textContent+=' · '+T('파일 변경을 감지해 덮어쓰기를 중단했습니다.','File changes detected; further overwriting stopped.');
  if(!Active&&File&&File.phase!=='failed')FileStatus.textContent=T('라이브 자막 갱신 종료','Live caption updates ended')+(File.filename?' · '+File.filename:'');
  UpdateTranscript(Current);
 }
 Update(Job);return {node:Node,update:Update};
}
