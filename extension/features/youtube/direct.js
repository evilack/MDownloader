import {CanUseYoutube} from '../../lib/distribution-policy.js';
import {YoutubeError} from './evaluator.js';
/** 추출기의 서명 URL은 메모리로만 받고, 실제 수신은 이 문서가 소유합니다. */
export async function ReceiveYoutubeFile(Source,{createWriter,hasPermission,fetch:Fetch=globalThis.fetch,signal:Signal=new AbortController().signal,report=()=>{},chunkBytes:ChunkBytes=4*1024**2}={})
{
	if(!CanUseYoutube())throw new YoutubeError('youtube_distribution_disabled');
	const Url=new URL(Source.url);
	if(Url.protocol!=='https:'||!(Url.hostname==='googlevideo.com'||Url.hostname.endsWith('.googlevideo.com')))throw new YoutubeError('youtube_unexpected_host');
	if(!await hasPermission(Url.origin))throw new YoutubeError('youtube_permission_denied');
	if(!Number.isSafeInteger(ChunkBytes)||ChunkBytes<1||ChunkBytes>32*1024**2)throw new YoutubeError('youtube_sabr_size_limit');
	if(Source.contentLength!==undefined&&(!Number.isSafeInteger(Source.contentLength)||Source.contentLength<1||Source.contentLength>16*1024**3))throw new YoutubeError('youtube_session_changed');
	const Writer=await createWriter();let Received=0,Total=Source.contentLength,Validator,ActiveResponse;
	try
	{
		do
		{
			Signal.throwIfAborted();
			const End=Total?Math.min(Total-1,Received+ChunkBytes-1):Received+ChunkBytes-1;
			const Response=ActiveResponse=await Fetch(new Request(Url,{redirect:'error',credentials:'omit',signal:AbortSignal.any([Signal,AbortSignal.timeout(30000)]),headers:{Range:`bytes=${Received}-${End}`,...(Validator?{'If-Range':Validator}:{})}}));
			const Range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(Response.headers.get('content-range')??'');
			if(Response.status!==206||!Range||+Range[1]!==Received||+Range[2]!==Math.min(End,+Range[3]-1)||!Response.body||/html|json/i.test(Response.headers.get('content-type')??''))
			{
				await Response.body?.cancel();throw new YoutubeError(Response.status===403?'youtube_automated_request_rejected':'youtube_session_changed');
			}
			if((Total&&Total!==+Range[3])||+Range[3]>16*1024**3||+Range[3]<1)throw new YoutubeError('youtube_session_changed');
			Total=+Range[3];const Etag=Response.headers.get('etag'),Modified=Response.headers.get('last-modified');
			const CurrentValidator=Etag?.startsWith('"')&&Etag.endsWith('"')?Etag:Number.isFinite(Date.parse(Modified))?Modified:undefined;
			if((Validator&&Validator!==CurrentValidator)||(!CurrentValidator&&+Range[2]<Total-1))throw new YoutubeError('youtube_session_changed');
			Validator??=CurrentValidator;const Reader=Response.body.getReader();let Count=0;
			try
			{
				for(;;){Signal.throwIfAborted();const{done,value}=await Reader.read();if(done)break;Count+=value.byteLength;if(Count>+Range[2]-Received+1)throw new YoutubeError('youtube_session_changed');await Writer.write(value);}
			}
			finally{await Reader.cancel().catch(()=>{});Reader.releaseLock();}
			if(Count!==+Range[2]-Received+1)throw new YoutubeError('youtube_session_changed');
			ActiveResponse=undefined;Received+=Count;report({received:Received,total:Total});
		}while(Received<Total);
		Signal.throwIfAborted();await Writer.close();return{bytes:Received,total:Total};
	}
	catch(ErrorValue){await ActiveResponse?.body?.cancel().catch(()=>{});await Writer.abort().catch(()=>{});throw ErrorValue;}
}
