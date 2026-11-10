import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateCaptionNativeClient} from '../extension/lib/local-captions-native.js';
function Event(){const SetOf=new Set();return {addListener:F=>SetOf.add(F),emit:V=>{for(const F of SetOf)F(V);}};}
test('native RPC correlates concurrent replies and separates progress events',async()=>{
 const Port={onMessage:Event(),onDisconnect:Event(),sent:[],postMessage(M){this.sent.push(M);}},Events=[];
 const Client=CreateCaptionNativeClient({runtime:{connectNative:()=>Port}},V=>Events.push(V));
 const A=Client.request({action:'probe'}),B=Client.request({action:'status',jobId:'x'});
 Port.onMessage.emit({id:Port.sent[1].id,ok:true,data:2});Port.onMessage.emit({event:'state',jobId:'x',phase:'preparing'});Port.onMessage.emit({id:Port.sent[0].id,ok:true,data:1});
 assert.deepEqual(await Promise.all([A,B]),[1,2]);assert.equal(Events[0].phase,'preparing');
});
test('helper disconnect rejects pending requests and permits a fresh connection',async()=>{
 const Port={onMessage:Event(),onDisconnect:Event(),postMessage(){}},Api={runtime:{connectNative:()=>Port,lastError:{message:'missing'}}};
 const Client=CreateCaptionNativeClient(Api,()=>{});const Pending=Client.request({action:'probe'});Port.onDisconnect.emit();await assert.rejects(Pending,/caption_helper_missing/);
});
