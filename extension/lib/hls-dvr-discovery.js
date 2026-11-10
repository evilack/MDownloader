import {RuntimePolicy} from './runtime-policy.js';
import {ProbeHlsVariants} from './declared-streams.js';
import {MediaResourceKey} from './media.js';

const Attempts=new Map();
/** A paused player may only have loaded its master. Read one declared rendition
 * through the existing permission/document-bound observation path; never media. */
export async function DiscoverHlsDvr(TabId,DocumentId,Page,Observed)
{
	const Local=Observed.filter(Item=>Item.format==='M3U8' && Item.documentId===DocumentId &&
		Item.initiator===new URL(Page).origin && (!Item.page || Item.page===Page));
	const Masters=Local.filter(Item=>Item.qualities?.length);
	if(Masters.length!==1) return false;
	if(Local.some(Media=>typeof Media.dvr==='boolean' &&
		Masters[0].qualities.some(Q=>MediaResourceKey(Q.url)===MediaResourceKey(Media.url)))) return false;
	const Variant=Masters[0].qualities[0];
	const Key=JSON.stringify([TabId,DocumentId,Page,Masters[0].url,Variant.url]);
	const Previous=Attempts.get(Key);
	if(Previous?.pending) return Previous.pending;
	if(Previous && Date.now()-Previous.at<RuntimePolicy.Detection.NativeManifestRetryMs) return false;
	const Attempt={at:Date.now()};Attempts.set(Key,Attempt);
	if(Attempts.size>RuntimePolicy.Detection.MaxObservedMedia) Attempts.delete(Attempts.keys().next().value);
	Attempt.pending=ProbeHlsVariants(TabId,DocumentId,Page,[Variant],{timeoutMs:RuntimePolicy.Detection.NativeManifestTimeoutMs})
		.then(()=>true,()=>false).finally(()=>{Attempt.pending=undefined;});
	return Attempt.pending;
}
