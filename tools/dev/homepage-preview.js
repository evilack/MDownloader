/** Homepage demo: production UI components, with in-memory data and no extension backend. */
import {InitializeLocale, Translate} from '../../extension/lib/i18n.js';
import {CreateElement as El, CreateButton, SetButtonIcon} from '../../extension/lib/ui.js';
import {CreateCandidateRow} from '../../extension/candidate-row.js';
import {CreateJobRow, UpdateJobRowMetrics} from '../../extension/job-row.js';
import {CreateDownloadOptionsDialog} from '../../extension/download-options-dialog.js';
import {CaptionPackageVersion} from '../../extension/data/caption-runtime-metadata.js';

const Params = new URL(location.href).searchParams;
const Locale = Params.get('lang') === 'ko' ? 'ko' : 'en';
const T = (Ko, En) => Locale === 'ko' ? Ko : En;
const IsManager = Params.get('view') === 'manager';
const Stored = {
 localCaptions: {enabled:false,engine:'faster-whisper',model:'base',language:'auto',container:true,formats:['srt'],presetId:'balanced'},
 subtitleTranslation: {enabled:false,provider:'deepl',targetLanguage:Locale,providers:{}},
};
let Jobs = [], Entries = new Map();
const Notice = document.querySelector('#demo-status');
const Announce = Text => {Notice.textContent = Text || T('프리뷰 · 예시 데이터만 변경합니다.','Preview · Only example data changes.');};
const CaptionRuntime = {connected:true,executionProtocol:2,engineReady:true,converterReady:true,modelManagement:true,modelDownloadVersion:3,captionTranslationVersion:1,recognitionOptionsVersion:1,captionPackageVersion:CaptionPackageVersion,installedModels:['base','small']};

// All production requests terminate here. No native connection, provider call or download API exists.
globalThis.chrome = {
 storage:{local:{get:async Keys => Object.fromEntries((Array.isArray(Keys)?Keys:[Keys]).map(Key=>[Key,Stored[Key]])),set:async Values=>Object.assign(Stored,Values)},onChanged:{addListener(){}}},
 permissions:{contains:async()=>true,request:async()=>false},
 runtime:{getPlatformInfo:async()=>({os:'win'}),openOptionsPage:async()=>OpenOptions(Candidates[0]),
  connectNative(){
   let Receive;
   return {onMessage:{addListener(Fn){Receive=Fn;}},onDisconnect:{addListener(){}},disconnect(){},postMessage(){queueMicrotask(()=>Receive?.({ok:true,protocol:1,helperVersion:9,helperRevision:1,platform:'win',capabilities:['captionSetup','captionPackageUpdate','genericPackageManifest']}));}};
  },
  async sendMessage(Message){
   let Data;
   switch(Message.type){
    case 'hlsQualities': Data=[{resolution:'1920x1080',bandwidth:4500000},{resolution:'1280x720',bandwidth:2400000},{resolution:'854x480',bandwidth:900000}];break;
    case 'webrtcQualities': Data=[{name:'Original',resolution:'1280x720'}];break;
    case 'candidateSubtitleOptions': Data=[{id:'en',language:'en',label:'English',selected:true},{id:'ko',language:'ko',label:'한국어',selected:true}];break;
    case 'captionProbe': Data=CaptionRuntime;break;
    case 'control': ChangeJob(Message.requestId,Message.action);break;
    case 'removeJob': Jobs=Jobs.filter(Job=>Job.requestId!==Message.requestId);RenderJobs();Announce(T('예시 기록을 삭제했습니다.','Example history entry removed.'));break;
    case 'jobUrl': Data='https://example.com/media';break;
    default: Announce(T('프리뷰에서는 실제 작업을 실행하지 않습니다.','The preview does not execute real operations.'));
   }
   return {ok:true,data:Data};
  },
 },
};

await InitializeLocale(Locale);
document.documentElement.lang=Locale;
document.title=T('MDownloader UI 프리뷰','MDownloader UI preview');
document.body.className=IsManager?'panel':'popup';
document.querySelector('#candidate-section').setAttribute('aria-label',Translate('html_detected_media'));
document.querySelector('#scan').setAttribute('aria-label',T('프리뷰 초기화','Reset preview'));
document.querySelector('#scan').title=T('프리뷰 초기화','Reset preview');
const OptionsButton=SetButtonIcon(CreateButton('',()=>OpenOptions(Candidates[0])),Translate('view_options'),'options');
document.querySelector('.window-actions').append(OptionsButton);
document.querySelector('#demo-label').textContent=IsManager?T('다운로드 관리 · 예시','Download manager · Example'):T('감지된 미디어 · 예시','Detected media · Example');
document.querySelector('#demo-hint').textContent=T('버튼을 눌러 보세요. 실제 파일·설정은 변경하지 않습니다.','Try the controls. Your real files and settings stay untouched.');

const Candidates=[
 {id:'film',name:T('숲속 산책 · 1080p','A walk in the woods · 1080p'),format:'M3U8',live:false,subtitleStatus:{phase:'detected',count:2}},
 {id:'live',name:T('저녁 라이브 · DVR','Evening live · DVR'),format:'M3U8',live:true,dvr:true},
 {id:'audio',name:T('작업할 때 듣는 음악.m4a','Music for a quiet afternoon.m4a'),format:'M4A',live:false},
];
function Thumbnail(Index=0){
 const Control=El('div','','candidate-preview demo-thumbnail');
 const Image=El('img');Image.src='icons/app-media-48.png';Image.alt='';Image.width=24;Image.height=24;
 Control.dataset.tone=String(Index);Control.append(Image);
 return {control:Control};
}
const Dialog=CreateDownloadOptionsDialog();
async function OpenOptions(Candidate,Container){
 Announce(T('실제 확장과 같은 옵션 화면입니다. 적용 결과는 예시 데이터에만 반영됩니다.','These are the extension’s actual options. Choices apply only to example data.'));
 const Input={id:Candidate.id,url:'https://example.com/media.m3u8',format:Candidate.format};
 const Result=Container?await Dialog.openInline(Candidate,Input,Container):await Dialog.open(Candidate,Input);
 if(Result) StartCandidate(Candidate);
}
function StartCandidate(Candidate){
 const Entry=Entries.get(Candidate.id);
 Entry?.update({state:'active',hls:Candidate.format==='M3U8',live:Candidate.live,bytesReceived:12800000,finished:32,count:100},{progress:'12.8 MB',speed:'2.4 MB/s'});
 Announce(T('예시 다운로드가 시작되었습니다. 다운로드 관리 프리뷰에서 저장 동작도 살펴보세요.','Example download started. Explore save controls in the manager preview too.'));
}
function RenderCandidates(){
 const List=document.querySelector('#candidates');List.replaceChildren();Entries.clear();
 Candidates.forEach((Candidate,Index)=>{
  const Download=SetButtonIcon(CreateButton('',Event=>{if(Event.shiftKey)void OpenOptions(Candidate,Options);else StartCandidate(Candidate);},true),Translate('view_action_download'),'download');
  const Entry=CreateCandidateRow(Candidate,{thumbnail:Thumbnail(Index),download:Download,announce:Announce});
  const Options=El('div','','demo-inline-options');
  Entry.row.append(Options);List.append(Entry.row);Entries.set(Candidate.id,Entry);
 });
}
function SeedJobs(){
 const Now=Date.now();
 Jobs=[
  {requestId:'film',filename:T('숲속_산책_1080p.mp4','A_walk_in_the_woods_1080p.mp4'),state:'active',hls:true,finished:48,count:100,bytesReceived:86400000,totalBytes:180000000,snapshotAvailable:true,created:Now-40000,subtitleStatus:{phase:'collecting',count:2,completed:1},localCaptions:{enabled:true},captionPipeline:'staged',captionStatus:{phase:'recognizing',mode:'early-audio'}},
  {requestId:'live',filename:T('저녁_라이브.mp4','Evening_live.mp4'),state:'active',hls:true,live:true,dvr:true,finished:70,bytesReceived:42600000,snapshotAvailable:true,created:Now-70000},
  {requestId:'done',filename:T('저장한_영상.mp4','Saved_video.mp4'),state:'complete',exists:true,hls:true,finished:100,count:100,bytesReceived:128000000,startTime:new Date(Now-80000).toISOString(),endTime:new Date(Now-20000).toISOString(),subtitleStatus:{phase:'ready',count:2,completed:2}},
 ];
 RenderJobs();
}
function RenderJobs(){
 const Main=document.querySelector('#job-sections');Main.replaceChildren();
 for(const [States,Key] of [[['active','paused'],'html_downloading'],[['complete'],'html_completed_downloads'],[['canceled'],'html_needs_attention']]){
  const Values=Jobs.filter(Job=>States.includes(Job.state));if(!Values.length)continue;
  const Section=El('section'),Header=El('header','','job-section-heading'),List=El('ul');Header.append(El('h2',Translate(Key)));Section.append(Header,List);Main.append(Section);
  for(const Job of Values){
   const Entry=CreateJobRow(Job,Thumbnail(Job.live?1:0),{Announce,Refresh:()=>{},CountFormat:new Intl.NumberFormat(Locale),bShowDiagnostics:false});
   Entry.previous={time:1000,bytes:Math.max(0,Job.bytesReceived-2400000)};UpdateJobRowMetrics(Entry,Job,2000);List.append(Entry.row);
  }
 }
}
function ChangeJob(Id,Action){
 const Job=Jobs.find(Value=>Value.requestId===Id);if(!Job)return;
 if(Action==='show'||Action==='play'){Announce(T('프리뷰에서는 실제 파일을 열지 않습니다.','No real file is opened in the preview.'));return;}
 if(Action==='snapshot')Jobs.push({...Job,requestId:Id+'-partial-'+crypto.randomUUID(),filename:Job.filename.replace('.mp4','_partial.mp4'),state:'complete',exists:true,live:false,snapshot:true,endTime:new Date().toISOString()});
 if(Action==='finish')Object.assign(Job,{state:'complete',exists:true,endTime:new Date().toISOString(),...(Job.localCaptions?.enabled?{captionStatus:{phase:'complete'}}:{})});
 if(Action==='cancel'){Job.state='canceled';if(Job.localCaptions?.enabled)Job.captionStatus={phase:'canceled'};}
 if(Action==='pause')Job.state='paused';
 if(Action==='resume')Job.state='active';
 RenderJobs();Announce(T('프리뷰의 예시 작업을 변경했습니다. 초기화 버튼으로 되돌릴 수 있습니다.','Example job updated. Use Reset preview to restore it.'));
}
document.querySelector('#candidate-section').hidden=IsManager;
document.querySelector('#job-sections').hidden=!IsManager;
document.querySelector('#scan').addEventListener('click',()=>{Dialog.close();IsManager?SeedJobs():RenderCandidates();Announce(T('프리뷰를 초기화했습니다.','Preview reset.'));});
document.addEventListener('click',Event=>{const Link=Event.target.closest('a');if(Link){Event.preventDefault();Announce(T('확장 설정 연결은 실제 앱에서 사용할 수 있습니다.','Settings links are available in the installed extension.'));}});
if(IsManager)SeedJobs();else RenderCandidates();
Announce();
