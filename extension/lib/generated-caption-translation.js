import {ParseVtt,Serialize,SubtitleLimits} from './subtitles.js';
import {SameLanguage,TranslateMissingSubtitle} from './subtitle-translation.js';
import {TranslateWithProvider} from './translation-providers.js';
import {ReadTranslationConfiguration} from './translation-configuration.js';

const Encoder=new TextEncoder();
export function GeneratedTranslationRequested(Job){return Job.localCaptions?.enabled&&Job.subtitleOptions?.translation?.enabled&&Job.subtitleOptions.translation.generated===true;}

export function CaptionTextForFormat(Parsed,Format){
 if(Format==='vtt')return Serialize(Parsed);
 const Time=Seconds=>{const Ms=Math.round(Seconds*1000);return [Math.floor(Ms/3600000),Math.floor(Ms/60000)%60,Math.floor(Ms/1000)%60].map(N=>String(N).padStart(2,'0')).join(':')+','+String(Ms%1000).padStart(3,'0');};
 return Parsed.cues.map((Cue,Index)=>`${Index+1}\n${Time(Cue.start)} --> ${Time(Cue.end)}\n${Cue.text}`).join('\n\n')+'\n';
}
export async function TranslateGeneratedCaptions(Job,Formats,{api,native,signal,savePicked,onState,onOutput})
{
 const Options=await ReadTranslationConfiguration(Job.subtitleOptions.translation,api);
 const Source=Job.captionStatus?.language||Job.localCaptions.language,Target=Options.targetLanguage;
 if(SameLanguage(Source,Target)||(Job.subtitleTracks||[]).some(Track=>SameLanguage(Track.language,Target))){await onState('not_needed',Source,Target);return [];}
 if(!Job.pickedDownloadFolder){const Probe=await native.request({action:'probe',engine:Job.localCaptions.engine,model:Job.localCaptions.model});if(!(Probe.captionTranslationVersion>=1))throw Error('caption_helper_update_required');}
 await onState('translating',Source,Target);
 const Format=Formats.includes('vtt')?'vtt':Formats[0],Decoder=new TextDecoder('utf-8',{fatal:true});let Offset=0,Content='';
 for(;;){
  signal.throwIfAborted();const Result=await native.request({action:'readResult',jobId:Job.requestId,format:Format,offset:Offset});
  const Bytes=Uint8Array.from(atob(Result.data),C=>C.charCodeAt(0));
  if(Result.offset!==Offset+Bytes.length||!Result.done&&!Bytes.length||Result.offset>SubtitleLimits.resourceBytes)throw Error('caption_translation_failed');
  Offset=Result.offset;Content+=Decoder.decode(Bytes,{stream:!Result.done});if(Result.done)break;
 }
 const Parsed=ParseVtt(Content,Format==='srt'),Config=Options.providers?.[Options.provider]||{};
 const Tracks=await TranslateMissingSubtitle([{language:Source==='auto'?'und':Source,content:Serialize(Parsed)}],{...Options,sourceLanguage:'auto'},(Texts,Context)=>TranslateWithProvider(Options.provider,Config,Texts,{...Context,source:Context.source==='und'?'':Context.source}),signal);
 if(Tracks.length!==2)throw Error('caption_translation_failed');
 const Translated=ParseVtt(Tracks[1].content),Outputs=[];
 for(const Fmt of Formats){
  signal.throwIfAborted();const Bytes=Encoder.encode(CaptionTextForFormat(Translated,Fmt));if(Bytes.length>SubtitleLimits.resourceBytes)throw Error('caption_translation_failed');
  if(Job.pickedDownloadFolder){const Name=await savePicked(Fmt,Target,Bytes);Outputs.push(Name);await onOutput(Fmt,Target,Name);continue;}
  for(let Start=0;Start<Bytes.length;Start+=192*1024){
   signal.throwIfAborted();const Chunk=Bytes.subarray(Start,Start+192*1024);let Data='';for(let I=0;I<Chunk.length;I+=8192)Data+=String.fromCharCode(...Chunk.subarray(I,I+8192));
   await native.request({action:'appendTranslation',jobId:Job.requestId,format:Fmt,language:Target,offset:Start,data:btoa(Data),done:Start+Chunk.length===Bytes.length});
  }
  signal.throwIfAborted();
  const Saved=await native.request({action:'saveResult',jobId:Job.requestId,videoPath:Job.captionVideoPath,formats:[Fmt],translationLanguage:Target});Outputs.push(...Saved.outputs);for(const Name of Saved.outputs)await onOutput(Fmt,Target,Name);
 }
 signal.throwIfAborted();await onState('complete',Source,Target);return Outputs;
}
