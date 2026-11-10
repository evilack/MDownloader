// Offscreen-only ownership. Functions, file handles and abort controllers never
// enter the durable job record or a runtime message.
import {CaptionPolicy} from './concurrent-captions-contract.js';
const Sessions=new Map();
export function CaptionOutputSession(Job){
 let Session=Sessions.get(Job.requestId);
 if(!Session){Session={job:Job,leases:[],captionSources:new Set(),receipts:{media:null,sidecars:{}},controller:new AbortController(),rawFile:null,finalFile:null,running:null,finalMappingReceipt:null,finalMappingDigest:null,finalMappingResultRevision:null};Sessions.set(Job.requestId,Session);}
 return Session;
}
export function RetainCaptionSource(Job,Release){
 if(!Job.localCaptions?.enabled||Job.snapshot){void Release();return;}
 CaptionOutputSession(Job).leases.push(Release);
}
export function FindCaptionOutputSession(Id){return Sessions.get(Id);}
export function CaptionOutputSessionIds(){return [...Sessions].filter(([,S])=>S.running).map(([Id])=>Id);}
export function ClearCaptionOutputExpiry(Session){clearTimeout(Session.expiryTimer);Session.expiryTimer=null;Session.failed=false;}
export function ExpireCaptionOutputSession(Session,Expire,Deadline=Date.now()+CaptionPolicy.retentionMs){
 ClearCaptionOutputExpiry(Session);Session.failed=true;Session.expiresAt=Math.min(Deadline,Date.now()+CaptionPolicy.retentionMs);
 Session.expiryTimer=setTimeout(()=>{
  if(Sessions.get(Session.job.requestId)!==Session||Session.running||!Session.failed)return;
  Session.expiring=true;Session.controller.abort(new DOMException('Caption input expired','AbortError'));void Expire(Session).catch(()=>{});
 },Math.max(0,Session.expiresAt-Date.now()));
}
export async function ReleaseCaptionOutputSession(Id){
 const Session=Sessions.get(Id);if(!Session)return;
 ClearCaptionOutputExpiry(Session);
 // A failed physical close keeps the owner and every source/workspace lease.
 for(const Source of Session.captionSources){await Source.release();Session.captionSources.delete(Source);}
 while(Session.leases.length){await Session.leases[0]();Session.leases.shift();}
 Sessions.delete(Id);
}
export async function CancelCaptionOutputSession(Id){
 const Session=Sessions.get(Id);if(!Session)return;
 Session.controller.abort(new DOMException('Canceled','AbortError'));
 await Session.running?.catch(()=>{});await ReleaseCaptionOutputSession(Id);
}
