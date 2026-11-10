import test from 'node:test';import assert from 'node:assert/strict';
import {RunOneClickSetup} from '../extension/lib/helper-one-click.js';
test('one install click downloads, opens and verifies without a second run or continue action',async()=>{
 const Calls=[];let Probes=0;
 const Result=await RunOneClickSetup({download:async()=>{Calls.push('download');return 7;},open:async Id=>Calls.push('open:'+Id),probe:async()=>{Calls.push('probe');return {connected:++Probes===2};},wait:async()=>{},onState:S=>Calls.push(S),timeout:1000});
 assert.equal(Result.connected,true);assert.ok(Calls.indexOf('download')<Calls.indexOf('open:7'));assert.equal(Calls.filter(X=>X==='open:7').length,1);assert.ok(!Calls.includes('ready-to-run'));
});
test('an execution request is never treated as successful installation',async()=>{
 let Clock=0;await assert.rejects(RunOneClickSetup({download:async()=>7,open:async()=>{},probe:async()=>({connected:false}),wait:async()=>{},now:()=>Clock+=100,timeout:250}),/setup_connection_timeout/);
});
test('cancel before a download completes prevents the execution request',async()=>{
 const Controller=new AbortController();await assert.rejects(RunOneClickSetup({signal:Controller.signal,download:async()=>{Controller.abort();return 7;},open:()=>assert.fail('canceled setup opened installer'),probe:async()=>({connected:false})}),/abort/i);
});
test('a blocked download does not request execution or fake success',async()=>{
 await assert.rejects(RunOneClickSetup({download:async()=>{throw Error('blocked');},open:()=>assert.fail('blocked installer opened'),probe:()=>assert.fail('blocked download checked as installed')}),/blocked/);
});
test('a native connection that never replies still reaches the setup deadline',async()=>{
 await assert.rejects(RunOneClickSetup({download:async()=>7,open:async()=>{},probe:()=>new Promise(()=>{}),timeout:20}),/setup_connection_timeout/);
});
test('closing while an execution prompt is pending releases the setup immediately',async()=>{
 const Controller=new AbortController();let Opened;
 const Setup=RunOneClickSetup({signal:Controller.signal,download:async()=>7,open:()=>{Opened=true;return new Promise(()=>{});},probe:()=>assert.fail('canceled setup must not probe')});
 await new Promise(setImmediate);assert.equal(Opened,true);Controller.abort();await assert.rejects(Setup,/abort/i);
});
