import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {SubtitleStatus,ValidateSubtitleStatus} from '../extension/lib/subtitle-status.js';
import {SubtitleMetadata} from '../extension/lib/row-presentation.js';
import {GetJobRowSignature} from '../extension/job-row.js';
Test('subtitle detection distinguishes disabled, missing source, existing target and scheduled translation',()=>{
 const Tracks=[{language:'en'},{language:'ja'}];
 Assert.equal(SubtitleStatus(Tracks).translation,'off');
 Assert.equal(SubtitleStatus([], {enabled:true,targetLanguage:'ko'}).translation,'no_source');
 Assert.equal(SubtitleStatus(Tracks,{enabled:true,targetLanguage:'ko'}).translation,'pending');
 Assert.equal(SubtitleStatus([{language:'ko-KR'}],{enabled:true,targetLanguage:'ko'}).translation,'not_needed');
 const Status=SubtitleStatus(Tracks,{enabled:true,targetLanguage:'ko'});
 Assert.deepEqual(Status.languages,['en','ja']); Assert.equal(ValidateSubtitleStatus(Status),true);
 Assert.equal(SubtitleMetadata(Status)[1].text,'Trans(ko)');
 Assert.deepEqual(SubtitleMetadata(),[]);
});
Test('undetected subtitles do not produce an unnecessary subtitle or translation notice',()=>{
 Assert.deepEqual(SubtitleMetadata(SubtitleStatus([], {enabled:true,targetLanguage:'ko'})),[]);
});
Test('subtitle error counts are validated independently of completed caption count',()=>{
 const S={...SubtitleStatus([{language:'en'}]),phase:'failed',completed:0,errorCount:1};
 Assert.equal(ValidateSubtitleStatus(S),true);
 Assert.equal(ValidateSubtitleStatus({...S,errorCount:-1}),false);
 Assert.equal(ValidateSubtitleStatus({...S,errorCount:257}),false);
});
Test('manager rerenders when translation changes without transfer metric changes',()=>{
 const A={requestId:'same',state:'active',subtitleStatus:SubtitleStatus([{language:'en'}],{enabled:true,targetLanguage:'ko'})};
 const B={...A,subtitleStatus:{...A.subtitleStatus,translation:'translating'}};
 Assert.notEqual(GetJobRowSignature(A),GetJobRowSignature(B));
 Assert.equal(ValidateSubtitleStatus({...B.subtitleStatus,key:'private'}),false);
 Assert.equal(ValidateSubtitleStatus({...B.subtitleStatus,count:-1}),false);
});
import {ReadSubtitles} from '../extension/lib/subtitles.js';
Test('legacy unavailable receipts render subtitle errors and never become a video failure',()=>{
 const S={phase:'ready',count:23,completed:0,unavailable:23,languages:[],targetLanguage:'ko',translation:'no_source'};
 Assert.equal(ValidateSubtitleStatus(S),true);
 Assert.equal(ValidateSubtitleStatus({...S,completed:1}),false);
 Assert.ok(SubtitleMetadata(S).some(M=>M.text==='Error(23)' && M.failed));
});
Test('caption acquisition reports actual monotonic counts and preserves partial counts on failure',async()=>{
 const Vtt='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCaption\n';
 const Progress=[];
 await Assert.rejects(ReadSubtitles([...Array.from({length:21},()=>({text:Vtt})),{text:'broken'},{text:'broken'}],{onProgress:async P=>{Progress.push(P);}}));
 Assert.equal(Progress.length,21);
 Assert.deepEqual(Progress.map(P=>P.completed),Array.from({length:Progress.length},(_,I)=>I+1));
 Assert.ok(Progress.every(P=>P.total===23));
 const Status={...SubtitleStatus(Array.from({length:23},()=>({language:'en'})),{enabled:true}),phase:'failed',completed:21,translation:'failed'};
 Assert.deepEqual(SubtitleMetadata(Status),[{text:'Subs(21/23)',failed:false},{text:'Error(2)',failed:true}]);
 Assert.equal(ValidateSubtitleStatus(Status),true);
 Assert.equal(ValidateSubtitleStatus({...Status,completed:24}),false);
});
