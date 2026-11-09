import test from 'node:test';import assert from 'node:assert/strict';
import {CreateNotificationView,NotificationViewRefresh} from '../extension/lib/notification-view.js';
test('a popup refresh reconnects after worker suspension and acknowledges current represented items',async t=>{
 const page={},states=[];let refresh,disconnected,connections=0;
 globalThis.window=page;globalThis.document={hidden:false,addEventListener(){}};
 globalThis.chrome={extension:{getViews:()=>[page]},runtime:{id:'test',onMessage:{addListener(F){refresh=F;}},connect(){connections++;let reply;return{onMessage:{addListener(F){reply=F;}},onDisconnect:{addListener(F){disconnected=F;}},postMessage(M){states.push(M);reply({ack:M.serial});}};}}};t.after(()=>{delete globalThis.window;delete globalThis.document;delete globalThis.chrome;});
 const report=CreateNotificationView();report(['one']);assert.deepEqual(states.at(-1).requestIds,['one']);disconnected();await new Promise(Resolve=>refresh({type:NotificationViewRefresh},{id:'test'},Resolve));assert.equal(connections,2);assert.deepEqual(states.at(-1).requestIds,['one']);
 document.hidden=true;await new Promise(Resolve=>refresh({type:NotificationViewRefresh},{id:'test'},Resolve));assert.equal(states.at(-1).visible,false);
});
test('popup HTML in a normal tab does not register a notification view',t=>{
 globalThis.window={};globalThis.chrome={extension:{getViews:()=>[]},runtime:{connect(){assert.fail('ordinary tab connected');}}};t.after(()=>{delete globalThis.window;delete globalThis.chrome;});CreateNotificationView()(['one']);
});
