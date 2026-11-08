import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {SubtitleStatus,StatusMessages,ValidateSubtitleStatus} from '../extension/lib/subtitle-status.js';
import {GetJobRowSignature} from '../extension/job-row.js';
Test('subtitle detection distinguishes disabled, missing source, existing target and scheduled translation',()=>{
 const Tracks=[{language:'en'},{language:'ja'}];
 Assert.equal(SubtitleStatus(Tracks).translation,'off');
 Assert.equal(SubtitleStatus([], {enabled:true,targetLanguage:'ko'}).translation,'no_source');
 Assert.equal(SubtitleStatus(Tracks,{enabled:true,targetLanguage:'ko'}).translation,'pending');
 Assert.equal(SubtitleStatus([{language:'ko-KR'}],{enabled:true,targetLanguage:'ko'}).translation,'not_needed');
 const Status=SubtitleStatus(Tracks,{enabled:true,targetLanguage:'ko'});
 Assert.deepEqual(Status.languages,['en','ja']); Assert.equal(ValidateSubtitleStatus(Status),true);
 Assert.equal(StatusMessages(Status)[1][0],'caption_translation_pending');
 Assert.equal(StatusMessages()[0][0],'caption_unknown');
});
Test('undetected subtitles do not produce an unnecessary subtitle or translation notice',()=>{
 Assert.deepEqual(StatusMessages(SubtitleStatus([], {enabled:true,targetLanguage:'ko'})),[]);
});
Test('manager rerenders when translation changes without transfer metric changes',()=>{
 const A={requestId:'same',state:'active',subtitleStatus:SubtitleStatus([{language:'en'}],{enabled:true,targetLanguage:'ko'})};
 const B={...A,subtitleStatus:{...A.subtitleStatus,translation:'translating'}};
 Assert.notEqual(GetJobRowSignature(A),GetJobRowSignature(B));
 Assert.equal(ValidateSubtitleStatus({...B.subtitleStatus,key:'private'}),false);
 Assert.equal(ValidateSubtitleStatus({...B.subtitleStatus,count:-1}),false);
});
import {ReadSubtitles} from '../extension/lib/subtitles.js';
Test('caption acquisition reports actual monotonic counts and preserves partial counts on failure',async()=>{
 const Vtt='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCaption\n';
 const Progress=[];
 await Assert.rejects(ReadSubtitles([...Array.from({length:21},()=>({text:Vtt})),{text:'broken'},{text:'broken'}],{onProgress:async P=>{Progress.push(P);}}));
 Assert.equal(Progress.length,21);
 Assert.deepEqual(Progress.map(P=>P.completed),Array.from({length:Progress.length},(_,I)=>I+1));
 Assert.ok(Progress.every(P=>P.total===23));
 const Status={...SubtitleStatus(Array.from({length:23},()=>({language:'en'})),{enabled:true}),phase:'failed',completed:21,translation:'failed'};
 Assert.deepEqual(StatusMessages(Status),[['caption_count','21/23'],['caption_translation_failed','ko']]);
 Assert.equal(ValidateSubtitleStatus(Status),true);
 Assert.equal(ValidateSubtitleStatus({...Status,completed:24}),false);
});
