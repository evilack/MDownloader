import {IdentifyYoutubeUrl} from '../../lib/youtube-source-policy.js';
/** Read the user's already-authorized player response. Account credentials are never read. */
export async function ReadAuthorizedYoutubePlayer(Item,{executeScript=Value=>chrome.scripting.executeScript(Value)}={})
{
 const Identity=IdentifyYoutubeUrl(Item.url),Page=IdentifyYoutubeUrl(Item.page);
 if(!Number.isInteger(Item.tabId)||!Item.documentId||!Identity||Page?.videoId!==Identity.videoId)return null;
 try{
  const [Frame]=await executeScript({target:{tabId:Item.tabId,documentIds:[Item.documentId]},world:'MAIN',args:[Identity.videoId,Item.page],func:(Id,ExpectedPage)=>{
   if(location.href!==ExpectedPage||location.origin!=='https://www.youtube.com'||document.visibilityState!=='visible')return null;
   const Player=document.querySelector('#movie_player')?.getPlayerResponse?.();
   if(Player?.videoDetails?.videoId!==Id||Player.playabilityStatus?.status!=='OK'||Player.videoDetails.isUpcoming||Player.videoDetails.isLive)return null;
   const ClientVersion=globalThis.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION');
   if(typeof ClientVersion!=='string'||!/^[-\w.]{1,64}$/.test(ClientVersion))return null;
   let ResolvedUrl;
   if(Player.streamingData?.serverAbrStreamingUrl){
    const Base=new URL(Player.streamingData.serverAbrStreamingUrl),Extra=new Set(['cpn','cver','rn','alr']);
    const Entry=performance.getEntriesByType('resource').filter(Entry=>{
     if(Entry.responseStatus<200||Entry.responseStatus>=300)return false;
     try{const Url=new URL(Entry.name);return Url.protocol==='https:'&&Url.origin===Base.origin&&Url.pathname===Base.pathname&&[...new Set([...Base.searchParams.keys(),...Url.searchParams.keys()])].every(Key=>Key==='n'||Extra.has(Key)&&!Base.searchParams.has(Key)||JSON.stringify(Base.searchParams.getAll(Key))===JSON.stringify(Url.searchParams.getAll(Key)));}catch{return false;}
    }).at(-1);ResolvedUrl=Entry?.name;
   }
   const Result={clientVersion:ClientVersion,...(ResolvedUrl?{resolvedUrl:ResolvedUrl}:{}),player:{videoDetails:Player.videoDetails,playabilityStatus:Player.playabilityStatus,streamingData:Player.streamingData,playerConfig:Player.playerConfig,captions:Player.captions}};
   return JSON.stringify(Result).length<=2*1024*1024?Result:null;
  }});
  return Frame?.result??null;
 }catch{return null;}
}
