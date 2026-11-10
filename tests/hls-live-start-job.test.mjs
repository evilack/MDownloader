import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {Enqueue} from '../extension/jobs.js';

function Fixture(T)
{
	const Page='https://source.test/watch', Doc='live-start-doc', Master='https://source.test/master.m3u8', Variant='https://cdn.test/live.m3u8';
	const Local={}, Session={'scan:27':{scanId:'start-scan',documentId:Doc,page:Page,candidates:[{
		id:0,supported:true,name:'live.m3u8',format:'M3U8',url:Master,documentId:Doc,initiator:'https://source.test',
		qualities:[{url:Variant}],observedVariants:[{url:Variant,format:'M3U8',documentId:Doc,initiator:'https://source.test'}],
	}]}};
	const Read=Data=>async Keys=>Object.fromEntries((Keys==null?Object.keys(Data):Array.isArray(Keys)?Keys:[Keys]).map(K=>[K,Data[K]]));
	const Sent=[];
	globalThis.chrome={storage:{local:{get:Read(Local),set:async V=>Object.assign(Local,structuredClone(V))},
		session:{get:Read(Session),set:async V=>Object.assign(Session,structuredClone(V))}},permissions:{contains:async()=>true},
		runtime:{id:'owner',getURL:P=>'chrome-extension://owner/'+P,getContexts:async()=>[{}],sendMessage:async M=>{Sent.push(M);return {ok:true};}},
		scripting:{executeScript:async({func})=>[{documentId:Doc,result:['ReadPageSubtitles','CollectPlayerPreviews'].includes(func.name)?[]:{page:Page,active:true,pageTitle:'Live'}}]}};
	T.after(()=>delete globalThis.chrome);
	return {local:Local,sent:Sent,variant:Variant,input:{tabId:27,scanId:'start-scan',candidateId:0}};
}

Test('enqueue persists current start and forwards it through the observed-rendition fast path to the runner',async T=>
{
	const F=Fixture(T), Id='10111111-1111-4111-8111-111111111111';
	Assert.equal((await Enqueue({...F.input,requestId:Id,variantUrl:F.variant,liveStart:'current'})).state,'started');
	Assert.equal(F.local['job:'+Id].liveStart,'current');
	const Run=F.sent.find(M=>M.type==='hlsRun');
	Assert.equal(Run.job.liveStart,'current'); Assert.equal(Run.job.url,F.variant); Assert.equal(Run.job.variantUrl,undefined);
});

Test('default enqueue does not invent a current-start setting, and malformed modes never launch a transfer',async T=>
{
	const F=Fixture(T);
	await Assert.rejects(Enqueue({...F.input,requestId:'20222222-2222-4222-8222-222222222222',liveStart:'invalid'}),{key:'job_invalid_request'});
	Assert.equal(F.sent.some(M=>M.type==='hlsRun'),false);
	await Enqueue({...F.input,requestId:'30333333-3333-4333-8333-333333333333'});
	Assert.equal(F.sent.find(M=>M.type==='hlsRun').job.liveStart,undefined);
});
