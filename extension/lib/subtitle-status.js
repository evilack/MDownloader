import {SameLanguage} from './subtitle-translation.js';
export function SubtitleStatus(Tracks = [], Options = {})
{
 const Languages=[...new Set(Tracks.map(T=>T.language || 'und'))];
 return {phase:Tracks.length?'detected':'undetected',count:Tracks.length,languages:Languages,
  targetLanguage:Options.targetLanguage || 'ko',translation:!Options.enabled?'off':!Tracks.length?'no_source':Languages.some(L=>SameLanguage(L,Options.targetLanguage || 'ko'))?'not_needed':'pending'};
}
export function StatusMessages(Status)
{
 const S=Status || {phase:'unknown',translation:'unknown'};
 if (S.phase === 'undetected') return [];
 const Completed = S.completed ?? (S.phase==='ready' ? S.count : undefined);
 const Count = Number.isInteger(Completed) ? ['caption_count',`${Completed}/${S.count || 0}`]
  : ['caption_'+(S.phase || 'unknown'),S.count || 0];
 return [Count,['caption_translation_'+(S.translation || 'unknown'),(S.targetLanguage || '').toLowerCase()]];
}
export function JobSubtitleStatus(Job)
{
 const S=Job.subtitleStatus || (Job.subtitleCount>0 ? {phase:'detected',count:Job.subtitleCount,translation:'unknown'} : undefined);
 if (!S || !['failed','canceled','interrupted'].includes(Job.state)) return S;
 return {...S, phase:S.phase==='collecting'?'stopped':S.phase,
  translation:['pending','translating'].includes(S.translation)?'stopped':S.translation};
}
export function ValidateSubtitleStatus(S)
{
 return !!S && ['detected','undetected','collecting','ready','failed'].includes(S.phase)
  && ['off','no_source','not_needed','pending','translating','complete','failed','unknown'].includes(S.translation)
  && Number.isInteger(S.count) && S.count>=0 && S.count<=128
  && Array.isArray(S.languages) && S.languages.length<=128 && S.languages.every(L=>typeof L==='string' && L.length<=35)
  && typeof S.targetLanguage==='string' && S.targetLanguage.length<=35
  && (S.completed===undefined || Number.isInteger(S.completed) && S.completed>=0 && S.completed<=S.count)
  && Object.keys(S).every(K=>['phase','translation','count','completed','languages','targetLanguage'].includes(K));
}
