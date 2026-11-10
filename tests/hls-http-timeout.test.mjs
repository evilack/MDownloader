import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Turn} from 'node:timers/promises';
import {FetchMedia,CopyResponse} from '../extension/lib/hls-http.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';
const Timeout=RuntimePolicy.Transfer.RequestTimeoutMs;
function Setup(T)
{
	T.mock.timers.enable({apis:['setTimeout']});
	T.mock.method(AbortSignal,'timeout',Ms=>{const C=new AbortController();setTimeout(()=>C.abort(new DOMException('timeout','TimeoutError')),Ms);return C.signal;});
	let Body,Aborted=false;
	T.mock.method(globalThis,'fetch',async(_Url,Options)=>new Response(new ReadableStream({start(C){Body=C;Options.signal.addEventListener('abort',()=>{Aborted=true;C.error(Options.signal.reason);},{once:true});}})));
	return {get body(){return Body;},get aborted(){return Aborted;}};
}
Test('a progressing media response may take longer than the header timeout to finish',async T=>
{
	const Source=Setup(T), Signal=new AbortController().signal;
	const Response=await FetchMedia('https://media.test/large.ts',Signal);
	const Chunks=[],Result=CopyResponse(Response,100,Signal,B=>Chunks.push(...B));
	const Observed=Result.then(Value=>({Value}),Error=>({Error}));
	for(let I=0;I<3;I++){
		T.mock.timers.tick(Timeout/2);
		Assert.equal(Source.aborted,false,'progressing response must not inherit an expired header deadline');
		Source.body.enqueue(new Uint8Array([I+1]));await Turn();
	}
	Source.body.close();
	Assert.deepEqual(await Observed,{Value:3});Assert.deepEqual(Chunks,[1,2,3]);
});
Test('a stalled response body times out and cancels its reader',async T=>
{
	T.mock.timers.enable({apis:['setTimeout']});let Canceled=false;
	const HttpResponse=new Response(new ReadableStream({cancel(){Canceled=true;}}));
	const Result=CopyResponse(HttpResponse,100,new AbortController().signal,()=>{});
	const Check=Assert.rejects(Result,{key:'stream_http_timeout'});
	T.mock.timers.tick(Timeout+1);await Check;Assert.equal(Canceled,true);
});
Test('caller cancellation interrupts a pending body read without waiting for its idle timeout', async T =>
{
	let Canceled = false, Body;
	const Controller = new AbortController(), Reason = new DOMException('stop transfer', 'AbortError');
	const HttpResponse = new Response(new ReadableStream({start(Value) { Body = Value; }, cancel() { Canceled = true; }}));
	let Settled;
	const Pending = CopyResponse(HttpResponse, 100, Controller.signal, () => {}).then(Value => { Settled = {Value}; }, Error => { Settled = {Error}; });
	T.after(async () => { if (!Settled) { try { Body.error(Reason); } catch {} } await Pending; });
	Controller.abort(Reason);
	for (let I = 0; I < 5; I++) await Turn();
	Assert.equal(Settled?.Error, Reason, 'the pending read must observe cancellation immediately');
	await Pending;
	Assert.equal(Canceled, true);
});

Test('response headers still have a deadline and caller cancellation retains its reason',async T=>
{
	T.mock.timers.enable({apis:['setTimeout']});
	T.mock.method(globalThis,'fetch',async(_Url,Options)=>new Promise((_Resolve,Reject)=>Options.signal.addEventListener('abort',()=>Reject(Options.signal.reason),{once:true})));
	const Pending=FetchMedia('https://media.test/stalled.ts',new AbortController().signal);
	const Check=Assert.rejects(Pending,{key:'stream_http_timeout'});T.mock.timers.tick(Timeout+1);await Check;
	const Controller=new AbortController(),Reason=new DOMException('user canceled','AbortError');
	const Canceled=FetchMedia('https://media.test/canceled.ts',Controller.signal);
	const Verify=Assert.rejects(Canceled,Error=>Error===Reason);Controller.abort(Reason);await Verify;
});
