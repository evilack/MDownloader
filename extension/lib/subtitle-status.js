import {SameLanguage} from './subtitle-translation.js';
export function SubtitleStatus(Tracks = [], Options = {})
{
 const Languages=[...new Set(Tracks.map(T=>T.language || 'und'))];
 return {phase:Tracks.length?'detected':'undetected',count:Tracks.length,languages:Languages,
  targetLanguage:Options.targetLanguage || 'ko',translation:!Options.enabled?'off':!Tracks.length?'no_source':Languages.some(L=>SameLanguage(L,Options.targetLanguage || 'ko'))?'not_needed':'pending'};
}
// Merge against the original acquisition summary, never a prior generated result.
export function MergeGeneratedSubtitleStatus(Base={},Language,Target,Translation)
{
 const Failed=Base.phase==='failed'||Base.errorCount>0||Base.unavailable>0||Base.translation==='failed'||Translation==='failed';
 return {...Base,phase:Failed?'failed':'ready',count:(Base.count||0)+1,
  completed:(Base.completed ?? (Base.phase==='ready'?Base.count||0:0))+1,
  languages:[...new Set([...(Base.languages||[]),Language==='auto'?'und':Language])],
  targetLanguage:Target,translation:Translation,
  ...(Translation==='failed'?{errorCount:(Base.errorCount||0)+1}:{})};
}
export function JobSubtitleStatus(Job)
{
 let S=Job.subtitleStatus || (Job.subtitleCount>0 ? {phase:'detected',count:Job.subtitleCount,translation:'unknown'} : undefined);
 if(Job.subtitleOptions?.translation?.enabled&&Job.subtitleOptions.translation.generated&&Job.localCaptions?.enabled&&!['complete','failed','canceled'].includes(Job.captionStatus?.phase))S={phase:'undetected',count:0,languages:[],...S,translation:['complete','not_needed','failed'].includes(Job.captionStatus?.translation)?Job.captionStatus.translation:Job.captionStatus?.phase==='translating'?'translating':'pending',targetLanguage:Job.subtitleOptions.translation.targetLanguage};
 if (!S || !['failed','canceled','interrupted'].includes(Job.state)) return S;
 return {...S, phase:S.phase==='collecting'?'stopped':S.phase,
  translation:['pending','translating'].includes(S.translation)?'stopped':S.translation};
}
export function ValidateSubtitleStatus(S)
{
 return !!S && ['detected','undetected','collecting','ready','failed'].includes(S.phase)
  && ['off','no_source','not_needed','pending','translating','complete','failed','unknown'].includes(S.translation)
  && Number.isInteger(S.count) && S.count>=0 && S.count<=129
  && Array.isArray(S.languages) && S.languages.length<=129 && S.languages.every(L=>typeof L==='string' && L.length<=35)
  && typeof S.targetLanguage==='string' && S.targetLanguage.length<=35
  && (S.completed===undefined || Number.isInteger(S.completed) && S.completed>=0 && S.completed<=S.count)
  && (S.errorCount===undefined || Number.isInteger(S.errorCount) && S.errorCount>=0 && S.errorCount<=256)
  && (S.unavailable===undefined || Number.isInteger(S.unavailable) && S.unavailable>=0 && S.unavailable+(S.completed ?? 0)<=S.count)
  && Object.keys(S).every(K=>['phase','translation','count','completed','unavailable','errorCount','languages','targetLanguage'].includes(K));
}
