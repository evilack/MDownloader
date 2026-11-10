import {CreateElement as El,SendRequest} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';
import {ProbeCommonHelper} from './lib/common-helper.js';
import {CaptionModelsForEngine,CaptionModelName,CaptionLanguages,NormalizeCaptionSettings} from './lib/local-captions-settings.js';
import {FillLanguageChoices} from './language-code-control.js';
import {CreateCaptionOutputControls,CaptionOutputLabel} from './caption-output-controls.js';
import {CreateCaptionPresetPicker} from './caption-preset-controls.js';
import {CaptionRuntimeReady,CaptionRuntimeOutdated,CaptionRuntimeEngines} from './lib/caption-runtime-contract.js';
import {CreateCaptionMemoryNotice} from './caption-memory-notice.js';

const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
const ModelName=CaptionModelName;

// These controls own a download-local draft. They never write Options storage.
export function CreateCaptionDownloadOption({onChange=()=>{}}={})
{
 const Section=El('section','','download-options-captions'),Heading=El('h3',T('음성 자막 생성','Speech captions'));
 Heading.id='download-caption-heading-'+crypto.randomUUID();Section.append(Heading);
 const Select=El('select');Select.name='captionOverride';Select.setAttribute('aria-labelledby',Heading.id);
 for(const [Id,Label] of [['inherit',T('기본 설정','Default settings')],['on',T('생성','Generate')],['off',T('미생성','Do not generate')],['custom',T('사용자 지정 설정','Custom settings')]])Select.append(new Option(Label,Id));
 const Fields=El('div','','download-options-caption-fields');Fields.id='download-caption-fields-'+crypto.randomUUID();Select.setAttribute('aria-controls',Fields.id);
 function Field(Name,Label){
  const Wrap=El('div','','download-options-field'),Text=El('label',Label),Control=El('select');
  Control.id='download-caption-'+Name+'-'+crypto.randomUUID();Control.name='caption-'+Name;Text.htmlFor=Control.id;Wrap.append(Text,Control);Fields.append(Wrap);return Control;
 }
 const Engine=Field('engine',T('인식 엔진','Recognition engine')),Model=Field('model',T('모델','Model')),Language=Field('language',T('음성 언어','Speech language'));
 const Preset=CreateCaptionPresetPicker({onChange:()=>Render(true)});Fields.insertBefore(Preset.element,Model.parentElement);
 const Names=new Intl.DisplayNames([GetLocale()],{type:'language'});
 FillLanguageChoices(Language,CaptionLanguages,{auto:true,includeCode:false});
 const Output=CreateCaptionOutputControls('download-options-caption-formats'),Checks=Output.checks;Fields.append(Output.element);
 const Summary=El('p','','help');Summary.id='download-caption-summary-'+crypto.randomUUID();Summary.setAttribute('role','status');
 const MemoryNotice=CreateCaptionMemoryNotice();
 for(const Control of [Select,Engine,Model])Control.setAttribute('aria-describedby',Summary.id+' '+MemoryNotice.id);
 const Notice=El('p',T('이 다운로드에만 적용됩니다. 임시 폴더에서 자막 생성·번역을 마친 뒤 최종 파일을 저장합니다.','Applies only to this download. Captions and translation finish in temporary storage before the final files are saved.'),'help');
 const Link=El('a',T('음성 자막 생성 설정','Speech caption settings'),'download-options-link');Link.href='options.html?section=captions';Link.target='_blank';Link.rel='noopener';
 Section.append(Select,MemoryNotice,Fields,Summary,Notice,Link);
 let Settings=NormalizeCaptionSettings({}),Platform='win',Draft={engine:'',model:'',language:'auto',formats:['srt']},Inventory=new Map(),HelperReady=false,EngineUpdateNeeded=false,Pending=false,Known=false,Revision=0,Locked=false;
 const Controls=[Select,Engine,Preset.select,Model,Language,...Checks];
 function Custom(){return {enabled:true,engine:Engine.value,model:Model.value,language:Language.value,...Output.read(),...Preset.read()};}
 function Effective(){return Select.value==='custom'?Custom():{...Settings,enabled:Select.value==='off'?false:Select.value==='on'?true:Settings.enabled};}
 function WantsGeneration(){return Effective().enabled;}
 function ValidationError(){
  if(!WantsGeneration())return '';
  if(Pending||!Known)return T('다운로드된 모델을 확인 중입니다. 잠시 후 다시 눌러 주세요.','Checking downloaded models. Please try again shortly.');
  if(Select.value==='custom'&&!Preset.loaded)return T('프리셋을 불러오고 있습니다. 잠시 후 다시 눌러 주세요.','Loading presets. Please try again shortly.');
  if(Select.value==='custom'&&!Preset.select.value)return T('사용할 인식 프리셋을 선택해 주세요. 개별 설정은 옵션에서 사용자 프리셋으로 저장할 수 있습니다.','Select a recognition preset. Save individual settings as a custom preset in Options.');
  if(!HelperReady)return T('도우미 연결을 확인해 주세요. 옵션의 도우미 탭에서 설치·진단할 수 있습니다.','Check the helper connection in the Helper tab in Options.');
  if(EngineUpdateNeeded&&!Inventory.size)return T('인식 옵션을 적용하려면 도우미 업데이트가 필요합니다. 옵션의 도우미 탭에서 업데이트해 주세요.','Update the helper in Options to apply recognition settings.');
  const Value=Effective(),Found=Inventory.get(Value.engine);
  if(!Found||!Found.installedModels.includes(Value.model))return Select.value==='custom'
   ?T('사용 가능한 모델이 없습니다. 음성 자막 생성 설정에서 모델을 다운로드해 주세요.','No models are available. Download a model in speech caption settings.')
   :T('기본 설정의 엔진·모델을 사용할 수 없습니다. 사용자 지정 설정을 선택하거나 음성 자막 생성 설정을 변경해 주세요.','The default engine or model is unavailable. Choose Custom settings or update speech caption settings.');
  if(!Found.converterReady)return T('음성 인식 준비가 필요합니다. 도우미 탭에서 설치를 완료해 주세요.','Complete speech recognition setup in the Helper tab.');
  if(!Value.container&&!Value.formats.length)return T('출력 형식을 하나 이상 선택해 주세요.','Select at least one output format.');
  return '';
 }
 function FillModels(){
  const Owned=Inventory.get(Engine.value)?.installedModels||[],Wanted=Draft.model;
  Model.replaceChildren(...(Owned.length?Owned.map(Id=>new Option(ModelName(Id),Id)):[new Option(T('다운로드된 모델 없음','No downloaded models'),'')]));
  Model.value=Owned.includes(Wanted)?Wanted:Owned[0]||'';
  if(Engine.value)Draft.engine=Engine.value;if(Model.value)Draft.model=Model.value;
 }
 function FillInventory(){
  const Engines=[...Inventory.keys()],Wanted=Draft.engine;
  Engine.replaceChildren(...(Engines.length?Engines.map(Id=>new Option(Id,Id)):[new Option(T(Pending?'확인 중...':'사용 가능한 엔진 없음',Pending?'Checking...':'No available engines'),'')]));
  Engine.value=Engines.includes(Wanted)?Wanted:Engines[0]||'';FillModels();Preset.set(Engine.value,Draft.presetId||'balanced');
 }
 function Render(Notify=false){
  const IsCustom=Select.value==='custom';Fields.hidden=!IsCustom;Select.setAttribute('aria-expanded',String(IsCustom));Fields.setAttribute('aria-busy',String(Pending));
  Select.disabled=Locked;Engine.disabled=Locked||Pending||!Inventory.size;Model.disabled=Locked||Pending||!Model.value;Language.disabled=Locked;for(const C of Checks)C.disabled=Locked;Preset.setLocked(Locked||Pending||!Engine.value);
  const Value=Effective(),Error=ValidationError();
  Summary.textContent=Pending&&IsCustom?T('다운로드된 엔진과 모델을 확인 중입니다...','Checking downloaded engines and models...'):Error||(!Value.enabled?T('음성 자막을 생성하지 않습니다.','Speech captions will not be generated.'):[Value.engine,ModelName(Value.model),Value.language==='auto'?T('언어 자동 감지','Detect language'):Names.of(Value.language),CaptionOutputLabel(Value)].join(' · '));
  if(Select.value==='inherit')Summary.textContent=T('기본 설정: ','Default settings: ')+Summary.textContent;
  if(Notify)onChange();
 }
 async function LoadInventory(){
  const Own=++Revision;Pending=true;Known=false;HelperReady=false;EngineUpdateNeeded=false;Inventory=new Map();FillInventory();Render(true);
  const Engines=CaptionRuntimeEngines(Platform);
  async function Probe(Engine){
   let Timer;try{return await Promise.race([SendRequest('captionProbe',{engine:Engine,model:''}),new Promise((_,Reject)=>{Timer=setTimeout(()=>Reject(Error('caption_probe_timeout')),20000);})]);}finally{clearTimeout(Timer);}
  }
  const [Helper,...Results]=await Promise.allSettled([ProbeCommonHelper(),...Engines.map(Probe)]);
  if(Own!==Revision)return;
  HelperReady=Helper.status==='fulfilled'&&Helper.value.ready===true;
  Results.forEach((Result,Index)=>{
   if(Result.status!=='fulfilled')return;const Value=Result.value;
   const Owned=CaptionModelsForEngine(Engines[Index]).filter(Id=>Value?.installedModels?.includes(Id));
   if(CaptionRuntimeOutdated(Value))EngineUpdateNeeded=true;
   if(HelperReady&&CaptionRuntimeReady(Value)&&Owned.length)Inventory.set(Engines[Index],{...Value,installedModels:Owned});
  });
  Pending=false;Known=true;FillInventory();Render(true);
 }
 Select.addEventListener('change',()=>Render(true));
 Engine.addEventListener('change',()=>{Draft.engine=Engine.value;Draft.presetId='balanced';FillModels();Preset.set(Engine.value,'balanced');Render(true);});
 Preset.select.addEventListener('change',()=>{Draft.presetId=Preset.select.value;});
 Model.addEventListener('change',()=>{Draft.model=Model.value;Render(true);});
 for(const Control of [Language,...Checks])Control.addEventListener('change',()=>Render(true));
 FillInventory();Language.value='auto';Output.write({container:true,formats:[]});Render();
 return {
  section:Section,select:Select,controls:Controls,
  get canGenerate(){return WantsGeneration()&&!ValidationError();},
  get language(){return Effective().language;},
  get validationError(){return ValidationError();},
  get captionSettings(){return Select.value==='custom'?Custom():undefined;},
  get customSettings(){return {...Draft,language:Language.value,...Output.read(),...Preset.read(),presetId:Preset.select.value||Draft.presetId};},
  set(Value,Override='inherit',CustomValue,Os='win'){
   ++Revision;Platform=Os;Settings=NormalizeCaptionSettings(Value,Platform);Pending=false;Known=false;HelperReady=false;Inventory=new Map();
   const Initial=CustomValue||Settings;Draft={engine:Initial.engine,model:Initial.model,presetId:Initial.presetId||'balanced',language:CaptionLanguages.includes(Initial.language)?Initial.language:'auto',formats:Array.isArray(Initial.formats)?Initial.formats.filter(F=>['srt','vtt'].includes(F)):[]};Preset.set(Initial.engine,Draft.presetId);
   Select.value=['inherit','on','off','custom'].includes(Override)?Override:'inherit';
   Language.value=Draft.language;Output.write({...Draft,container:Initial.container});
   // Keep the desired model while its installed inventory is still unknown.
   Engine.replaceChildren();Model.replaceChildren();Render(true);
  },
  loadInventory:LoadInventory,
  setLocked(Value){Locked=Value;Render();},
  cancel(){++Revision;Pending=false;Known=false;}
 };
}
