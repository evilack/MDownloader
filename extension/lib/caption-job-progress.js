import {GetLocale} from './i18n.js';

const Labels={
 waiting:['음성 자막 생성 대기','Waiting to generate speech captions'],
 staging:['오디오 전달 중','Staging audio'],preparing:['오디오 준비 중','Preparing audio'],
 'audio-ready':['음성 인식 준비 완료','Audio ready'],queued:['음성 인식 대기','Recognition queued'],
 recognizing:['음성 인식 중','Recognizing speech'],recognized:['음성 인식 완료','Speech recognized'],
 'windowed-ready':['인식 결과 정리 중','Preparing recognition results'],
 'loading-model':['음성 인식 모델 불러오는 중','Loading speech recognition model'],
 translating:['자막 번역 중','Translating captions'],muxing:['자막 삽입 중','Embedding captions'],
 saving:['최종 파일 저장 중','Saving final files'],complete:['음성 자막 생성 완료','Speech captions complete'],
 failed:['음성 자막 처리 실패','Caption processing failed'],canceled:['음성 자막 처리 취소됨','Caption processing canceled']
};
const RecognizedPhases=['recognized','translating','muxing','saving','complete'];
// Audio preparation can run alongside the download. Only switch the shared bar
// after the finished temporary media enters the caption output pipeline.
export function CaptionJobProgress(Job)
{
 if(!Job.localCaptions?.enabled||Job.snapshot||Job.captionPipeline!=='staged')return null;
 const State=Job.captionStatus||{},Phase=State.phase||'waiting';
 if(!State.mediaReady)return null;
 const Samples=Number.isSafeInteger(State.finalSamples)&&State.finalSamples>0&&Number.isSafeInteger(State.committedSamples)&&State.committedSamples>=0;
 const Ratio=Samples?State.committedSamples/State.finalSamples:State.mode==='windowed'?null:State.total>0?(State.completed||0)/State.total:null;
 const Percent=State.mode==='windowed'&&!Samples?null:RecognizedPhases.includes(Phase)?100:Ratio!==null?Math.max(0,Math.min(100,Math.floor(Ratio*100)))
  :State.mode==='windowed'?null:0;
 return {percent:Percent,label:(Labels[Phase]||Labels.waiting)[GetLocale().startsWith('ko')?0:1]};
}
