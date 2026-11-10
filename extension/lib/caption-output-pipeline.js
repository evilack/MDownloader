import {CaptionStage,PrepareCaptionBlob,ConcurrentCaptions} from './local-captions-runner.js';
import {ParseVtt,SubtitleLimits} from './subtitles.js';
import {SameLanguage,TranslateMissingSubtitle} from './subtitle-translation.js';
import {TranslateWithProvider} from './translation-providers.js';
import {GeneratedTranslationRequested,CaptionTextForFormat} from './generated-caption-translation.js';
import {CreateStreamWorkspaces} from './stream-workspaces.js';
import {RequirePickedFolder,WriteToPickedFolder} from './picked-download-folder.js';
import {CaptionOutputName} from './local-captions-settings.js';
import {SubtitleStatus} from './subtitle-status.js';
import {CaptionOutputSession} from './caption-output-session.js';
import {CaptionPolicy,CaptionAbortableWait} from './concurrent-captions-contract.js';

const Workspaces=CreateStreamWorkspaces('mdownloader-caption-output'),Encoder=new TextEncoder();
async function TranslationConfiguration(Options){const Result=await chrome.runtime.sendMessage({type:'subtitleTranslationConfiguration',options:Options});if(!Result?.ok)throw Error('subtitle_translation_failed');return Result.data;}
const Wait=CaptionAbortableWait;
export async function TranslateOutputSubtitles(Job,Signal,Report){
 if(!Job.subtitleTracks?.length||Job.subtitleOptions?.translation?.generated)return Job;
 const Options=await TranslationConfiguration(Job.outputTranslation||Job.subtitleOptions?.translation);
 if(!Options.enabled)return Job;
 if(Job.subtitleStatus?.translation==='failed')throw Error('subtitle_translation_failed');
 const Summary=SubtitleStatus(Job.subtitleTracks,Options),Base=Job.subtitleStatus||{},Before={...Base,...Summary,count:Math.max(Base.count||0,Summary.count),completed:Base.completed??Job.subtitleTracks.length,...(Base.errorCount?{errorCount:Base.errorCount}:{}),phase:Base.phase==='failed'?'failed':'ready'};if(Before.translation!=='pending')return Job;
 await Report(Job.requestId,'subtitleStatus',{status:{...Before,translation:'translating'}});
 if(Job.localCaptions?.enabled&&!Job.snapshot)await CaptionStage(Job,'processing',{phase:'translating'});
 try{
  const Config=Options.providers?.[Options.provider]||{},Tracks=await TranslateMissingSubtitle(Job.subtitleTracks,Options,(Texts,Context)=>TranslateWithProvider(Options.provider,Config,Texts,Context),Signal);
  const Status={...Before,translation:'complete'};await Report(Job.requestId,'subtitleStatus',{status:Status});return {...Job,subtitleTracks:Tracks,subtitleStatus:Status};
 }catch(ErrorValue){Signal.throwIfAborted();await Report(Job.requestId,'subtitleStatus',{status:{...Before,phase:'failed',translation:'failed',errorCount:Math.min(256,(Before.errorCount||0)+1)}});throw Error('subtitle_translation_failed');}
}
async function ReadCaption(Job,Signal){
 const Decoder=new TextDecoder('utf-8',{fatal:true});let Offset=0,Text='';
 for(;;){Signal.throwIfAborted();const Part=await CaptionStage(Job,'readResult',{format:'vtt',offset:Offset}),Bytes=Uint8Array.from(atob(Part.data),C=>C.charCodeAt(0));
  if(Part.offset!==Offset+Bytes.length||Part.offset>SubtitleLimits.resourceBytes||!Part.done&&!Bytes.length)throw Error('caption_prepare_failed');
  Offset=Part.offset;Text+=Decoder.decode(Bytes,{stream:!Part.done});if(Part.done)return Text;
 }
}
export async function PrepareCaptionOutput(Job,MediaFile,Signal){
 if(!Job.localCaptions?.enabled||Job.captionPipeline!=='staged'||Job.snapshot||Job.captionsFinalized)return Job;
 const Session=CaptionOutputSession(Job);if(Session.captionPreparedJob)return Session.captionPreparedJob;
 const Cancel=()=>{if(Signal.reason?.name==='AbortError')void CaptionStage(Job,'cancel').catch(()=>{});};Signal.addEventListener('abort',Cancel,{once:true});
 let Translating=false,SourceLanguage='und';
 try{
  Signal.throwIfAborted();
  const Status=await FinalizeCaptionInput(Job,MediaFile,Signal);
  Job.captionResultRevision=Status.resultRevision||0;
  SourceLanguage=Status.language||Job.localCaptions.language;const Language=SourceLanguage==='auto'?'und':SourceLanguage;
  const Original=Session.originalCaption??=await ReadCaption(Job,Signal);if(!ParseVtt(Original).cues.length)throw Error('caption_no_audio');
  let Tracks=Session.generatedTracks||[{language:Language,label:'Speech captions ('+Language+')',content:Original}];
  if(!Session.generatedTracks&&GeneratedTranslationRequested(Job)){
   Translating=true;
   await CaptionStage(Job,'processing',{phase:'translating'});
   const Options=await TranslationConfiguration(Job.subtitleOptions.translation),Config=Options.providers?.[Options.provider]||{};
   if(!(Job.subtitleTracks||[]).some(Track=>SameLanguage(Track.language,Options.targetLanguage)))Tracks=await TranslateMissingSubtitle(Tracks,{...Options,sourceLanguage:'auto'},(Texts,Context)=>TranslateWithProvider(Options.provider,Config,Texts,{...Context,source:Context.source==='und'?'':Context.source}),Signal);
   await CaptionStage(Job,'translationResult',{result:Tracks.length>1?'complete':'not_needed',language:Language});Translating=false;
  }
  Session.generatedTracks=Tracks;
  const Workspace=await Workspaces.create(Job.requestId),Artifacts=Session.artifacts??=[];
  if(!Session.artifactLease){Session.artifactLease=true;Session.leases.push(()=>Workspaces.release(Job.requestId));}
  for(let Index=0;Index<Tracks.length;Index++){
   const Track=Tracks[Index],Parsed=ParseVtt(Track.content);
   for(const Format of Job.localCaptions.formats){
    Signal.throwIfAborted();const Bytes=Encoder.encode(CaptionTextForFormat(Parsed,Format));if(Bytes.length>SubtitleLimits.resourceBytes)throw Error('caption_translation_failed');
    const Name=Index+'-'+Format;if(Artifacts.some(A=>A.name===Name&&A.ready))continue;
    const Handle=await Workspace.getFileHandle(Name,{create:true}),Writer=await Handle.createWritable();
    try{await Writer.write(Bytes);await Writer.close();}catch(ErrorValue){await Writer.abort().catch(()=>{});throw ErrorValue;}
    if(Index&&!Job.pickedDownloadFolder)for(let Offset=0;Offset<Bytes.length;Offset+=CaptionPolicy.uploadChunkBytes){
     Signal.throwIfAborted();const Chunk=Bytes.subarray(Offset,Offset+CaptionPolicy.uploadChunkBytes);let Text='';for(let I=0;I<Chunk.length;I+=8192)Text+=String.fromCharCode(...Chunk.subarray(I,I+8192));
     await CaptionStage(Job,'appendTranslation',{format:Format,language:Track.language,offset:Offset,data:btoa(Text),done:Offset+Chunk.length===Bytes.length});
    }
    Artifacts.push({name:Name,format:Format,ready:true,...(Index?{language:Track.language}:{})});
   }
  }
  Signal.throwIfAborted();await CaptionStage(Job,'processing',{phase:Job.localCaptions.container?'muxing':'saving'});
  return Session.captionPreparedJob={...Job,captionsFinalized:true,captionArtifacts:Artifacts,subtitleTracks:[...(Job.subtitleTracks||[]),...(Job.localCaptions.container?Tracks:[])]};
 }catch(ErrorValue){
  if(Translating&&!Signal.aborted&&ErrorValue.name!=='AbortError')await CaptionStage(Job,'translationResult',{result:'failed',language:SourceLanguage==='auto'?'und':SourceLanguage}).catch(()=>{});
  const Canceled=Signal.reason?.name==='AbortError'||ErrorValue.name==='AbortError'&&!Session.nativeFailure;
  if(Canceled)Cancel();else await CaptionStage(Job,'failure',{code:Session.nativeFailure?.message||ErrorValue.message}).catch(()=>{});
  if(Canceled)await Workspaces.release(Job.requestId);throw Session.nativeFailure||ErrorValue;
 }finally{Signal.removeEventListener('abort',Cancel);}
}
/** Recognition/finalization precedes either selected translation source. This
 * checkpoint also lets output-only retries keep the same native revision. */
const CompletedWindowFailures=new Set(['caption_seam_unresolved','caption_window_guard','stream_capture_clock_overlap']);
async function RecoverCompletedWindow(Job,MediaFile,Signal,Failure){
 const Session=CaptionOutputSession(Job),Errors=[Failure,Job.captionSession?.error,Job.captionConcurrencyError,Job.captionPreparationError].filter(Boolean);
 const Reason=Job.captionSession?.error?.message||Failure?.message;
 const Timing=Job.captionFinalTiming,Duration=Timing?.duration??Timing?.outputEnd-Timing?.start;
 const OwnedHls=Job.captionSourceInfo?.windowed===true&&Session.rawFile===MediaFile&&Number.isFinite(Duration)&&Duration>0;
 if(!Errors.length||Errors.some(E=>!CompletedWindowFailures.has(E.message)||E.message!==Reason)||!Job.captionCommittedInput&&!OwnedHls||Job.captionMode!=='windowed'||
  !(MediaFile instanceof Blob)||!MediaFile.size||Session.nativeFailure||Session.finalizedRecognition||Session.finalFile||Session.finalMappingResultRevision!==null||Session.receipts.media||Object.keys(Session.receipts.sidecars).length)return false;
 Signal.throwIfAborted();
 // The finite completed input is now available. Quiesce the old attempt before
 // explicitly recognizing its selected AV timeline. Never invent PCM coverage
 // for an unresolved seam or an AAC window the actual decoder cannot cover.
 await ConcurrentCaptions.fallback(Job,Reason,Signal);
 Signal.throwIfAborted();
 Job.captionMode='postprocess';Job.captionPrepared=false;Job.captionConcurrencyError=null;Job.captionPreparationError=null;
 Job.captionSession.reason=Reason;return true;
}
export async function FinalizeCaptionInput(Job,MediaFile,Signal){
 if(!Job.localCaptions?.enabled||Job.captionPipeline!=='staged'||Job.snapshot)return null;
 const Session=CaptionOutputSession(Job);if(Session.finalizedRecognition){const Original=Session.originalCaption??=await ReadCaption(Job,Signal);if(!ParseVtt(Original).cues.length)throw Error('caption_no_audio');return Session.finalizedRecognition;}
 let Status=await ConcurrentCaptions.resumeFinalization(Job,Signal);
 if(!Status)Status=await ConcurrentCaptions.resumeRecognition(Job,Job.captionFinalTiming,Signal);
 if(!Status){
 ConcurrentCaptions.bind(Job,Signal);await CaptionStage(Job,'processing',{phase:'preparing',mediaReady:true,...(Job.captionSession?.reason?{fallbackReason:Job.captionSession.reason}:{})});
 await Job.captionConcurrentStart;await Job.captionPreparation;
 const PreparationError=Job.captionSession?.error||Job.captionConcurrencyError||Job.captionPreparationError;
 if(PreparationError&&!await RecoverCompletedWindow(Job,MediaFile,Signal,PreparationError))throw PreparationError;
 if(Job.captionSession?.finalInputClipped)await ConcurrentCaptions.clipPrepared(Job,Signal);
 try{Status=await ConcurrentCaptions.finalize(Job,Job.captionFinalTiming,Signal);}
 catch(ErrorValue){if(!await RecoverCompletedWindow(Job,MediaFile,Signal,ErrorValue))throw ErrorValue;}
 if(!Status){
  if(!Job.captionPrepared)await PrepareCaptionBlob(Job,MediaFile,Signal);
  for(;;){try{await CaptionStage(Job,'recognize');break;}catch(ErrorValue){if(ErrorValue.message!=='caption_busy')throw ErrorValue;await Wait(Signal);}}
 }
 for(;!Status;){
  Signal.throwIfAborted();const Current=await CaptionStage(Job,'status');
  if(Current.phase==='recognized'){if(Current.finalizationPending)throw Error('caption_state');Status=Current;break;}
  if(Current.phase==='canceled')throw new DOMException('Caption processing canceled','AbortError');
  if(['failed','preparation-failed'].includes(Current.phase))throw Error(Current.error||'caption_recognition_failed');await Wait(Signal);
 }
 }
 Job.captionResultRevision=Status.resultRevision||0;
 if(Session.finalMappingResultRevision!==null&&Session.finalMappingResultRevision!==Status.resultRevision)throw Error('caption_result_conflict');
 Session.finalizedRecognition=Status;ConcurrentCaptions.markFinalized(Job);
 const Original=Session.originalCaption??=await ReadCaption(Job,Signal);if(!ParseVtt(Original).cues.length)throw Error('caption_no_audio');
 return Status;
}
export async function SaveCaptionArtifacts(Job,Filename,Signal){
 if(!Job.captionArtifacts?.length)return;
 const Session=CaptionOutputSession(Job),Folder=Job.pickedDownloadFolder?await RequirePickedFolder(Job.pickedDownloadFolder):null,Workspace=await Workspaces.create(Job.requestId);
 for(const Artifact of Job.captionArtifacts){
  Signal.throwIfAborted();const File=await(await Workspace.getFileHandle(Artifact.name)).getFile();
  const Key=(Artifact.language||'original')+':'+Artifact.format;if(Session.receipts.sidecars[Key]){await CaptionStage(Job,'outputReceipt',{kind:'sidecar',key:Key,receipt:Session.receipts.sidecars[Key]});continue;}
  let Name=CaptionOutputName(Filename,Artifact.format);if(Artifact.language)Name=Name.replace('.'+Artifact.format,'.'+Artifact.language+'.'+Artifact.format);
  const Saved=Folder?await WriteToPickedFolder(Folder,Name,File.stream(),Signal):(await CaptionStage(Job,'saveArtifact',{format:Artifact.format,...(Artifact.language?{language:Artifact.language}:{})})).outputs[0];
  const Receipt={filename:Saved,bytes:File.size,resultRevision:Job.captionResultRevision||0};Session.receipts.sidecars[Key]=Receipt;
  await CaptionStage(Job,'outputReceipt',{kind:'sidecar',key:Key,receipt:Receipt});
 }
}
export const ReleaseCaptionOutput=Job=>Workspaces.release(Job.requestId);
