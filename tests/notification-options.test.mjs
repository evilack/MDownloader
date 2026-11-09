import test from 'node:test';import assert from 'node:assert/strict';
import {SetNotificationOption} from '../extension/options-notifications.js';
test('notification options request permission from the gesture before writing preferences',async t=>{
 const calls=[];globalThis.chrome={permissions:{request:async v=>{calls.push(['permission',v]);return true;}},notifications:{getPermissionLevel:async()=> 'granted'},storage:{local:{set:async v=>calls.push(['set',v])}}};t.after(()=>delete globalThis.chrome);
 const pending=SetNotificationOption('notifyDownloadComplete',true);assert.equal(calls[0][0],'permission');await pending;assert.deepEqual(calls.at(-1),['set',{notifyDownloadComplete:true}]);
 calls.length=0;await SetNotificationOption('notifyScheduledStart',false);assert.deepEqual(calls,[['set',{notifyScheduledStart:false}]]);
});
test('denied Chrome/OS permissions and invalid settings never enable a notification option',async t=>{
 const writes=[];let allowed=false;globalThis.chrome={permissions:{request:async()=>allowed},notifications:{getPermissionLevel:async()=> 'denied'},storage:{local:{set:async v=>writes.push(v)}}};t.after(()=>delete globalThis.chrome);
 await assert.rejects(SetNotificationOption('notifyDownloadComplete',true),{key:'opt_notifications_permission_denied'});allowed=true;await assert.rejects(SetNotificationOption('notifyScheduledStart',true),{key:'opt_notifications_blocked'});await assert.rejects(SetNotificationOption('language',true),TypeError);assert.equal(writes.length,0);
});
