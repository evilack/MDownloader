import {CaptionText as T} from './local-captions-ui.js';
import {SendRequest,CreateElement,CreateButton} from './lib/ui.js';
import {CaptionFailurePresentation} from './lib/caption-failure.js';
const Phases={waiting:['영상 저장 후 생성 대기','Waiting for the video to be saved'],staging:['오디오 전달 중','Staging audio'],preparing:['오디오 준비 중','Preparing audio'],'audio-ready':['오디오 준비됨 · 영상 저장 대기','Audio ready · Waiting for video save'],queued:['음성 인식 대기 중','Queued for recognition'],'loading-model':['음성 인식 모델 로딩 중','Loading speech recognition model'],'windowed-ready':['음성 인식 결과 정리 중','Preparing recognition results'],recognizing:['음성 인식 중','Recognizing speech'],recognized:['자막 저장 대기','Waiting to save captions'],saving:['자막 저장 중','Saving captions'],translating:['생성한 자막 번역 중','Translating generated captions'],complete:['생성 완료','Complete'],failed:['생성 실패 · 영상은 별도로 저장됩니다','Failed · Video save is independent'],canceled:['자막 생성 취소됨','Caption generation canceled']};
Phases['metadata-waiting']=['원본 파일의 오디오 메타데이터 수신 대기','Waiting for audio metadata from the original file'];
const Errors={caption_engine_options_unsupported:['이 도우미에서 지원하지 않는 인식 옵션입니다. 프리셋을 변경하거나 도우미를 업데이트해 주세요.','This helper does not support the selected recognition option. Change the preset or update the helper.'],caption_output_failed:['최종 자막 파일을 만들지 못했습니다.','Could not create the final captioned output.'],caption_translation_failed:['번역 실패 · 원본 음성 자막은 저장되었습니다','Translation failed · Original speech captions were saved'],caption_helper_update_required:['도우미 업데이트 필요','Update the helper'],caption_helper_missing:['보조 프로그램 연결 필요','Connect the helper'],caption_engine_missing:['인식 엔진 설치 필요','Install the recognition engine'],caption_model_missing:['모델 준비 필요','Prepare the model'],caption_converter_missing:['오디오 변환 도구 준비 필요','Prepare the audio converter'],caption_no_audio:['인식할 오디오 없음','No audio to recognize'],caption_source_missing:['원본 파일 또는 임시 입력 없음','Source file or cached input is missing'],caption_disk_full:['임시 저장 공간 부족','Insufficient temporary disk space'],caption_interrupted:['보조 프로그램이 종료됨','Helper was interrupted']};
export function CreateCaptionJobStatus(Job,Announce,Refresh)
{
 const Node=CreateElement('section','','caption-job'),Status=CreateElement('p','','caption-job-status'),Actions=CreateElement('div','','caption-job-actions');
 Status.setAttribute('role','status');Node.append(Status,Actions);
 const Phase=Job.captionStatus?.phase||'waiting';
 function Action(Text,Action){const B=CreateButton(Text,async()=>{B.disabled=true;try{await SendRequest('captionControl',{requestId:Job.requestId,action:Action});}catch{Announce(T('자동 자막 작업을 변경하지 못했습니다. 연결을 확인해 주세요.','Could not update caption generation. Check the helper connection.'));}finally{B.disabled=false;Refresh([Job.requestId]);}});Actions.append(B);}
 if(!Job.captionStatus?.canceledByRestart&&['failed','canceled'].includes(Phase)&&(['complete','interrupted'].includes(Job.state)||Job.captionStatus?.retryAvailable))Action(T('자막 다시 시도','Retry captions'),'retry');
 if(Phase==='failed'){const Link=CreateElement('a',T('자동 자막 설정','Caption settings'));Link.href='options.html?section=captions';Link.target='_blank';Link.rel='noopener';Actions.append(Link);}
 Actions.hidden=Actions.children.length===0;
 function Update(Current){Node.hidden=!Current.localCaptions?.enabled||!!Current.snapshot;const State=Current.captionStatus||{},P=State.phase||'waiting',Label=Current.captionPipeline==='staged'?({waiting:!State.mediaReady&&['active','starting'].includes(Current.state)?['다운로드 중 · 음성 인식 준비 중','Downloading · Preparing speech recognition']:['음성 인식 준비 중','Preparing speech recognition'],'audio-ready':['오디오 준비됨 · 다운로드 중','Audio ready · Downloading'],recognized:['음성 자막 준비 완료','Captions prepared'],'windowed-ready':['음성 인식 결과 정리 중','Preparing recognition results'],'loading-model':['음성 인식 모델 로딩 중','Loading speech recognition model'],muxing:['영상에 자막 삽입 중','Embedding captions'],saving:['최종 파일 저장 중','Saving final files'],failed:['처리 또는 저장 실패','Processing or save failed'],canceled:['다운로드 취소됨','Download canceled']}[P]||Phases[P]):P==='failed'&&State.translation==='failed'&&State.originalOutputs?.length?['자막 생성 완료 · 번역 실패','Captions generated · Translation failed']:Phases[P]||Phases.waiting;
  const Concurrent=Current.captionPipeline==='staged'&&!State.mediaReady&&['early-audio','windowed'].includes(State.mode)&&['queued','loading-model','recognizing','recognized','windowed-ready'].includes(P);
  Status.textContent=T('음성 자막 · ','Speech captions · ')+(Concurrent?T('다운로드 중 · ','Downloading · '):'')+T(...Label)+(Current.captionPipeline==='staged'&&State.error==='caption_translation_failed'?' · '+T('번역을 완료하지 못했습니다.','Translation could not be completed.'):Errors[State.error]?' · '+T(...Errors[State.error]):'');Status.dataset.failed=String(P==='failed');
  if(P==='failed'){
   const Failure=CaptionFailurePresentation(State.error||State.lastFailure?.code,State.errorDetails||State.lastFailure?.details);
   Status.textContent=T('음성 자막 · ','Speech captions · ')+T(...Failure.label)+' · '+T(...Failure.reason)+' ['+Failure.code+']';
  }
  if(P==='complete'&&State.outputs?.length)Status.textContent+=' · '+State.outputs.join(' / ');
  if(State.warningCount>0&&P!=='failed'&&P!=='canceled')Status.textContent+=' · '+T('자막 시간 자동 보정 '+State.warningCount+'건 (경고)','Caption timing adjusted '+State.warningCount+' time(s) (warning)');
  if(State.canceledByRestart)Status.textContent=T('앱 재시작으로 취소됨','Canceled by app restart')+(Current.restartCancellationPending||State.cancellationPending?' · '+T('작업 종료 확인 대기','Awaiting shutdown confirmation'):'');
  if(P==='canceled'&&State.lastFailure&&State.lastFailure.attempt===(State.attempt??null)){
   const Failure=CaptionFailurePresentation(State.lastFailure.code,State.lastFailure.details);
   Status.textContent+=' · '+T('취소 전 실패: ','Previous failure: ')+T(...Failure.label)+' · '+T(...Failure.reason)+' ['+Failure.code+']';
  }
 }
 Update(Job);return {node:Node,update:Update};
}
