import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Enqueue, ControlJob} from '../extension/jobs.js';
const Tick=()=>new Promise(Resolve=>setImmediate(Resolve));

function NativeStart(T,Id,{cancel=async()=>{},beforeWrite=async()=>{}}={})
{
	const Page='https://source.test/watch',Doc='native-start-document';
	const Local={usePageTitle:false,useDownloadDateTime:false};
	const Session={'scan:22':{scanId:'scan',documentId:Doc,page:Page,candidates:[
		{id:0,supported:true,name:'video.mp4',format:'MP4',url:'https://cdn.test/file.mp4'}]}};
	const Read=Data=>async Keys=>Object.fromEntries((Keys==null?Object.keys(Data):Array.isArray(Keys)?Keys:[Keys]).map(Key=>[Key,Data[Key]]));
	const Download=Promise.withResolvers(),Entered=Promise.withResolvers(),Canceled=[];
	globalThis.chrome={storage:{local:{get:Read(Local),set:async Values=>{await beforeWrite(Values);Object.assign(Local,structuredClone(Values));}},
		session:{get:Read(Session),set:async Values=>Object.assign(Session,Values)}},permissions:{contains:async()=>true},
		runtime:{id:'owner',getURL:Path=>'chrome-extension://owner/'+Path,getContexts:async()=>[{}],sendMessage:async()=>({ok:true})},
		scripting:{executeScript:async({func})=>[{documentId:Doc,result:func.name==='ReadPageSubtitles'?[]:{page:Page,active:true,pageTitle:'Source'}}]},
		downloads:{onDeterminingFilename:{addListener(){},removeListener(){}},
			download:()=>{Entered.resolve();return Download.promise;},cancel:async BrowserId=>{Canceled.push(BrowserId);await cancel();},search:async()=>[]}};
	T.after(()=>delete globalThis.chrome);
	const Registration=Enqueue({tabId:22,scanId:'scan',candidateId:0,requestId:Id});
	Registration.catch(()=>{});
	return {local:Local,entered:Entered.promise,download:Download,registration:Registration,canceled:Canceled};
}

Test('cancel during native Start persists intent and cancels the actual ID once issued',async T=>
{
	const Id='00111111-1111-4111-8111-111111111111',Canceled=Promise.withResolvers(),FinishCancel=Promise.withResolvers();
	const F=NativeStart(T,Id,{cancel:async()=>{Canceled.resolve();await FinishCancel.promise;}});
	await F.entered;
	const Control=ControlJob(Id,'cancel');Control.catch(()=>{});await Tick();
	Assert.equal(F.local['job:'+Id].pendingAction,'cancel');
	F.download.resolve(71);await Canceled.promise;
	Assert.equal(F.local['job:'+Id].downloadId,71);Assert.equal(F.local['job:'+Id].pendingAction,'cancel');
	FinishCancel.resolve();await Control;Assert.deepEqual(await F.registration,{state:'canceled'});
	Assert.deepEqual(F.canceled,[71]);Assert.equal(F.local['job:'+Id].state,'canceled');Assert.equal(F.local['job:'+Id].pendingAction,undefined);
});

Test('native ID handoff cannot overwrite a cancel write already in flight',async T=>
{
	const Id='00222222-2222-4222-8222-222222222222',Writing=Promise.withResolvers(),Commit=Promise.withResolvers();
	const F=NativeStart(T,Id,{beforeWrite:async Values=>{if(Values['job:'+Id]?.state==='starting'&&Values['job:'+Id].pendingAction==='cancel'){Writing.resolve();await Commit.promise;}}});
	await F.entered;
	const Control=ControlJob(Id,'cancel');Control.catch(()=>{});await Writing.promise;
	F.download.resolve(72);await Tick();Commit.resolve();
	await Control;await F.registration;
	Assert.deepEqual(F.canceled,[72]);Assert.equal(F.local['job:'+Id].downloadId,72);Assert.equal(F.local['job:'+Id].state,'canceled');
});

Test('native Start failure clears cancel intent without inventing a successful cancellation',async T=>
{
	const Id='00333333-3333-4333-8333-333333333333',F=NativeStart(T,Id);
	await F.entered;const Control=ControlJob(Id,'cancel');Control.catch(()=>{});await Tick();
	Assert.equal(F.local['job:'+Id].pendingAction,'cancel');
	F.download.reject(new Error('native start failed'));
	Assert.deepEqual(await F.registration,{state:'failed'});await Assert.rejects(Control);
	Assert.deepEqual(F.canceled,[]);Assert.equal(F.local['job:'+Id].state,'failed');Assert.equal(F.local['job:'+Id].pendingAction,undefined);
});

Test('native cancel failure clears its intent and retains the issued browser ID for retry',async T=>
{
	const Id='00444444-4444-4444-8444-444444444444',Failure=new Error('native cancellation failed');
	const F=NativeStart(T,Id,{cancel:async()=>{throw Failure;}});
	await F.entered;const Control=ControlJob(Id,'cancel');Control.catch(()=>{});await Tick();
	Assert.equal(F.local['job:'+Id].pendingAction,'cancel');F.download.resolve(74);
	await Assert.rejects(Control,Failure);await Assert.rejects(F.registration,Failure);
	Assert.equal(F.local['job:'+Id].state,'started');Assert.equal(F.local['job:'+Id].downloadId,74);Assert.equal(F.local['job:'+Id].pendingAction,undefined);
});
