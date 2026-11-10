import {GetLocale} from './lib/i18n.js';
import {CaptionModels,CaptionModelsForEngine,CaptionModelName,CaptionLanguages,NormalizeCaptionSettings} from './lib/local-captions-settings.js';
import {ShowSettingsDialog,ShowSettingsLoading} from './settings-dialog.js';
import {ShowCaptionModelDownload} from './caption-model-dialog.js';
import {FillLanguageChoices} from './language-code-control.js';
import {CreateCaptionOutputControls} from './caption-output-controls.js';
import {CreateCaptionRecognitionControls} from './caption-preset-controls.js';
import {CaptionRuntimeReady} from './lib/caption-runtime-contract.js';
import {CreateCaptionMemoryNotice} from './caption-memory-notice.js';
export const CaptionText=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
const El=(Tag,Text='',Class='')=>{const N=document.createElement(Tag);N.textContent=Text;N.className=Class;return N;};
const T=CaptionText;
const ModelName=CaptionModelName;
function Field(Parent,Name,Label,Entries){const Wrap=El('div','','field'),L=El('label',Label),S=El('select');S.id='caption-'+Name;S.name=Name;L.htmlFor=S.id;for(const [Value,Text]of Entries)S.append(new Option(Text,Value));Wrap.append(L,S);Parent.append(Wrap);return S;}
function Button(Text,Handler){const B=El('button',Text);B.type='button';B.addEventListener('click',Handler);return B;}
function Card(Parent,Title){const C=El('fieldset','','card');C.append(El('legend',Title));Parent.append(C);return C;}
export function CreateCaptionSettings({platform='win',probe,prepare,cancelModel,deleteModel,ensureHelper=async()=>true,onNone=async()=>{}}={})
{
 const Form=El('form','','settings-form captions-form');Form.id='local-captions-form';
 const Recognition=Card(Form,T('음성 인식','Speech recognition'));
 const Engine=Field(Recognition,'engine',T('인식 엔진','Engine'),[['none','None'],...(platform==='mac'?['whisper.cpp']:['faster-whisper','whisper.cpp']).map(X=>[X,X])]);
 Recognition.append(El('p',T('엔진을 선택하면 모델과 음성 언어를 설정할 수 있습니다. None은 음성 인식을 사용하지 않습니다.','Choose an engine to configure its model and speech language. None disables speech recognition.'),'help'));
 const MemoryNotice=CreateCaptionMemoryNotice();Recognition.append(MemoryNotice);Engine.setAttribute('aria-describedby',MemoryNotice.id);
 const Details=El('div','','caption-engine-details');Recognition.append(Details);
 const RecognitionOptions=CreateCaptionRecognitionControls();Details.append(RecognitionOptions.element);
 const ModelField=El('div','','field'),ModelLabel=El('label',T('모델','Model')),ModelRow=El('div','','caption-model-row'),Model=El('select');Model.id='caption-model';Model.name='model';ModelLabel.htmlFor=Model.id;for(const Id of CaptionModels)Model.append(new Option(ModelName(Id),Id));
 Model.setAttribute('aria-describedby',MemoryNotice.id);
 const Download=Button(T('다운로드','Download'),()=>void PrepareModel()),Delete=Button(T('삭제','Delete'),()=>void DeleteModel());Download.id='caption-model-download';Delete.id='caption-model-delete';Delete.className='danger';ModelRow.append(Model,Download,Delete);ModelField.append(ModelLabel,ModelRow);Details.append(ModelField);
 const Language=Field(Details,'language',T('음성 언어','Speech language'),[]);FillLanguageChoices(Language,CaptionLanguages,{auto:true,includeCode:false});
 const Output=CreateCaptionOutputControls(),Checks=Output.checks;Details.append(Output.element,El('p',T('컨테이너에 포함하면 영상에 자막 트랙을 추가합니다. SRT·VTT는 별도 파일로 저장합니다.','Embed in container adds subtitle tracks to the video. SRT and VTT are saved as separate files.'),'help')); const State=El('p','','inline-state');State.id='caption-connection';State.setAttribute('role','status');Details.append(State);
 const Defaults=Card(Form,T('자동 생성 기본값','Automatic caption defaults')),Toggle=El('div','','toggle-row'),Label=El('label'),Enabled=El('input');
 Enabled.type='checkbox';Enabled.name='enabled';Enabled.id='caption-enabled';Enabled.setAttribute('role','switch');Enabled.className='switch';Label.htmlFor=Enabled.id;Label.append(El('strong',T('저장 전 음성 자막 생성','Generate speech captions before saving')),El('span',T('새 다운로드에 적용합니다. 개별 다운로드 옵션에서 바꿀 수 있습니다.','Applies to new downloads. Override it in individual download options.')));Toggle.append(Label,Enabled);Defaults.append(Toggle);
 Enabled.setAttribute('aria-describedby',MemoryNotice.id);
 const Feedback=El('p','','notice');Feedback.id='local-captions-status';Feedback.setAttribute('role','status');Form.append(Feedback);
 let Busy=false,Revision=0,Installed=new Set(),EngineReady=false,HostConnected=false,ModelKnown=false,SavedModel='',ActiveDownload;
 function ModelChoices(Selected=Model.value){const Supported=CaptionModelsForEngine(Engine.value);if([...Model.options].map(O=>O.value).join(',')!==Supported.join(','))Model.replaceChildren(...Supported.map(Id=>new Option(ModelName(Id),Id)));Model.value=Supported.includes(Selected)?Selected:Supported[0]||'';}
 function Render(){
  ModelChoices();const None=Engine.value==='none',Owned=Installed.has(Model.value);Details.hidden=Defaults.hidden=None;
  for(const Option of Model.options)Option.textContent=ModelName(Option.value)+(Installed.has(Option.value)?'':T('(미보유)',' (not downloaded)'));
  Download.disabled=Busy||None||!EngineReady||Owned;Delete.disabled=Busy||None||!HostConnected||!Owned;
  Engine.disabled=Busy;Model.disabled=Language.disabled=Enabled.disabled=Busy;for(const C of Checks)C.disabled=Busy;RecognitionOptions.setLocked(Busy);
 }
 function Read(){const Selection=Output.read();return NormalizeCaptionSettings({enabled:Enabled.checked,engine:Engine.value,model:Installed.has(Model.value)||!ModelKnown&&Model.value===SavedModel?Model.value:'',language:Language.value,...Selection,...RecognitionOptions.read()},platform,{strict:true});}
 function Write(Value){const V=NormalizeCaptionSettings(Value,platform);Engine.value=V.engine;RecognitionOptions.set(V.engine,V.presetId,V.recognition);ModelChoices(V.model||'tiny');SavedModel=V.model;ModelKnown=false;Language.value=V.language;Enabled.checked=V.enabled;Output.write(V);Installed=new Set();EngineReady=HostConnected=false;Render();}
 function ForceNone(){Engine.value='none';Enabled.checked=false;Installed=new Set();EngineReady=HostConnected=false;ModelKnown=false;SavedModel='';Render();}
 function ShowProbe(Result){
  if(Result?.commonHelper?.confirmedMissing){ForceNone();return;}
  if(Result?.connected){Installed=new Set((Result.installedModels||[]).filter(X=>CaptionModelsForEngine(Engine.value).includes(X)));ModelKnown=true;}
  const CommonReady=Result?.commonHelper?!!(Result.commonHelper.connected&&Result.commonHelper.ready):true;
  HostConnected=CommonReady&&!!(Result?.connected&&Result?.modelManagement);EngineReady=CommonReady&&CaptionRuntimeReady(Result);
  State.textContent=!CommonReady?T('도우미 연결을 확인해 주세요. 도우미 탭에서 설치·진단할 수 있습니다.','Check the helper connection. Install or diagnose it in the Helper tab.'):!EngineReady?T('음성 인식 준비가 필요합니다. 도우미 탭에서 설치를 완료해 주세요.','Complete speech recognition setup from the Helper tab.'):Installed.has(Model.value)?T('선택한 모델을 사용할 수 있습니다.','The selected model is ready.'):T('선택한 모델을 다운로드해 주세요.','Download the selected model.');State.classList.toggle('error',!EngineReady);Render();
 }
 async function Refresh(){const Own=++Revision,SelectedEngine=Engine.value;try{const Result=await probe?.({engine:SelectedEngine,model:SelectedEngine==='none'?'':Model.value});if(Own===Revision&&SelectedEngine===Engine.value)ShowProbe(Result);}catch{if(Own===Revision)ShowProbe(null);}}
 async function PrepareModel(){
  if(Busy||Download.disabled)return;Busy=true;++Revision;Render();
  ActiveDownload=ShowCaptionModelDownload({engine:Engine.value,model:Model.value,label:ModelName(Model.value),prepare,cancel:cancelModel});
  try{const Result=await ActiveDownload.result;await Refresh();Feedback.dataset.error='false';Feedback.dataset.saved='false';if(Result.success){Feedback.textContent=T('모델 다운로드를 완료했습니다.','Model download complete.');Form.dispatchEvent(new Event('input',{bubbles:true}));}else if(Result.canceled)Feedback.textContent=T('모델 다운로드를 취소했습니다.','Model download canceled.');}
  finally{ActiveDownload=undefined;Busy=false;Render();}
 }
 async function DeleteModel(){
  if(Busy||Delete.disabled)return;Busy=true;Render();const Selected={engine:Engine.value,model:Model.value};
  try{
   if(!await ShowSettingsDialog({title:T('모델 삭제','Delete model'),message:ModelName(Selected.model)+T(' 모델을 정말 삭제하시겠습니까?',' — Delete this model?'),danger:true}))return;
   await deleteModel(Selected);Enabled.checked=false;await Refresh();Form.dispatchEvent(new Event('input',{bubbles:true}));Feedback.textContent=T('모델을 삭제했습니다. 다시 사용하려면 다운로드해 주세요.','Model deleted. Download it again to use it.');Feedback.dataset.error='false';Feedback.dataset.saved='false';
  }catch(E){Feedback.dataset.error='true';Feedback.textContent=E?.message==='caption_busy'?T('이 모델을 사용 중입니다. 진행 중인 작업이 끝난 뒤 삭제해 주세요.','This model is in use. Wait for the active operation to finish before deleting it.'):T('모델을 삭제하지 못했습니다. 도우미 연결을 확인해 주세요.','Could not delete the model. Check the helper connection.');}
  finally{Busy=false;Render();}
 }
 Engine.addEventListener('change',async()=>{
  if(Busy)return;const Selected=Engine.value;RecognitionOptions.set(Selected,'balanced');++Revision;Installed=new Set();EngineReady=HostConnected=false;ModelKnown=false;SavedModel='';
  const Loading=ShowSettingsLoading();Busy=true;Form.setAttribute('aria-busy','true');Enabled.checked=false;Render();
  try{
   if(Selected==='none'){ForceNone();await onNone();return;}
   if(!await ensureHelper({engine:Selected,loading:false,beforePrompt:()=>Loading.close()})){ForceNone();await onNone();return;}
   Engine.value=Selected;Model.value='tiny';await Refresh();Form.dispatchEvent(new Event('input',{bubbles:true}));
  }
  catch{ForceNone();Feedback.dataset.error='true';Feedback.textContent=Selected==='none'?T('None 설정을 저장하지 못했습니다. 다시 적용해 주세요.','Could not save None. Apply the settings again.'):T('도우미 연결을 확인하지 못했습니다. 도우미 탭에서 진단해 주세요.','Could not verify the helper connection. Run diagnostics from the Helper tab.');}
  finally{Busy=false;Form.setAttribute('aria-busy','false');Render();Loading.close();}
 });
 Model.addEventListener('change',Render);
 Write({});
 return {form:Form,read:Read,write:Write,refresh:Refresh,showProbe:ShowProbe,feedback:Feedback,forceNone:ForceNone,modelProgress(Event){ActiveDownload?.update(Event);},cancelActiveModel(){return ActiveDownload?.cancel()??Promise.resolve();}};
}
export {CreateCaptionDownloadOption} from './caption-download-option.js';
