import {CreateElement as El,CreateButton} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';
import {CaptionPresetKey,EngineOptionFields,NormalizeRecognitionOptions,BuiltinCaptionPresets,NormalizeCustomCaptionPresets} from './lib/caption-engine-options.js';
import {ShowSettingsDialog} from './settings-dialog.js';
const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
const RecognitionFieldOrder=new Map(['cpuThreads','beamSize','bestOf','temperature','computeType','device','conditionOnPreviousText','vadFilter','useGpu'].map((Id,Index)=>[Id,Index]));
async function MutatePresets(Change){return navigator.locks.request('mdownloader-caption-presets',async()=>{const Saved=await chrome.storage.local.get(CaptionPresetKey),Next=Change(NormalizeCustomCaptionPresets(Saved[CaptionPresetKey]));await chrome.storage.local.set({[CaptionPresetKey]:Next});});}
export function CreateCaptionPresetPicker({onChange=()=>{},manual=false}={}){
 const Element=El('div','','field caption-preset-picker'),Label=El('label',T('인식 프리셋','Recognition preset')),Select=El('select');Select.id='caption-preset-'+crypto.randomUUID();Select.name='recognition-preset';Label.htmlFor=Select.id;Element.append(Label,Select);
 let Engine='faster-whisper',Custom=[],Desired='balanced',Manual,Loaded=false,Locked=false;
 function Presets(){return [...BuiltinCaptionPresets(Engine),...Custom.filter(P=>P.engine===Engine)];}
 function Render(){
  const Items=Presets();Select.replaceChildren(...Items.map(P=>new Option(P.name||T(P.ko,P.en),P.id)));
  if(manual&&Desired==='manual')Select.append(new Option(T('개별 설정','Individual settings'),'manual'));
  const Found=Items.some(P=>P.id===Desired)||manual&&Desired==='manual';
  if(!manual&&!Found)Select.prepend(new Option(T('프리셋을 선택해 주세요','Select a preset'),''));
  Select.value=Found?Desired:manual?'balanced':'';Select.disabled=Locked||!Loaded;
 }
 function Read(){const PendingManual=manual&&!Loaded&&Manual&&Desired.startsWith('custom-');return {presetId:PendingManual?Desired:Select.value,recognition:NormalizeRecognitionOptions(PendingManual||Select.value==='manual'?Manual:Presets().find(P=>P.id===Select.value)?.recognition,Engine,{strict:true})};}
 Select.addEventListener('change',()=>{Desired=Select.value;Manual=undefined;onChange(Read());});
 const Notify=()=>{try{onChange(Read());}catch{}};
 const Ready=chrome.storage.local.get(CaptionPresetKey).then(Saved=>{Custom=NormalizeCustomCaptionPresets(Saved[CaptionPresetKey]);Loaded=true;Render();Notify();}).catch(()=>{Loaded=true;Render();Notify();});
 chrome.storage.onChanged?.addListener((Changes,Area)=>{if(Area==='local'&&Changes[CaptionPresetKey]){Custom=NormalizeCustomCaptionPresets(Changes[CaptionPresetKey].newValue);Render();Notify();}});
 Render();
 return {element:Element,select:Select,ready:Ready,read:Read,get loaded(){return Loaded;},get engine(){return Engine;},get custom(){return Custom.find(P=>P.id===Select.value&&P.engine===Engine);},
  set(NextEngine,Id='balanced',Options){Engine=NextEngine==='whisper.cpp'?'whisper.cpp':'faster-whisper';Desired=Id||'balanced';Manual=Options;
   if(manual&&Options){const P=Presets().find(P=>P.id===Desired);if(!P&&Loaded||P&&JSON.stringify(NormalizeRecognitionOptions(Options,Engine))!==JSON.stringify(P.recognition))Desired='manual';}
   Render();},
  setManual(Options){Desired='manual';Manual=Options;Render();},setLocked(Value){Locked=Value;Render();},
  async refresh(){const Saved=await chrome.storage.local.get(CaptionPresetKey);Custom=NormalizeCustomCaptionPresets(Saved[CaptionPresetKey]);Loaded=true;Render();Notify();}
 };
}
export function CreateCaptionRecognitionControls(){
 const Root=El('fieldset','','caption-recognition-options');Root.append(El('legend',T('인식 옵션','Recognition options')));
 let Inputs=new Map(),Engine='faster-whisper',Locked=false,Operation=false,Revision=0;
 const Picker=CreateCaptionPresetPicker({manual:true,onChange:Value=>{Fill(Value.recognition);Root.dispatchEvent(new Event('input',{bubbles:true}));}});
 const Details=El('details','','caption-recognition-details'),Summary=El('summary',T('개별 설정','Individual settings')),Fields=El('div','','caption-recognition-fields');Details.append(Summary,Fields);
 const SaveRow=El('div','','caption-preset-save-row'),Name=El('input'),NameLabel=El('label',T('새 프리셋 이름','New preset name'));Name.id='caption-preset-name-'+crypto.randomUUID();Name.name='preset-name';Name.maxLength=60;Name.autocomplete='off';NameLabel.htmlFor=Name.id;NameLabel.append(Name);
 const Message=El('p','','help');Message.setAttribute('role','status');
 const Save=CreateButton(T('새 프리셋으로 저장','Save as new preset'),async()=>{
  if(Operation||Locked)return;const Owner=Engine,OwnRevision=Revision;Operation=true;Lock();
  try{const Recognition=ReadFields(),Title=Name.value.trim();if(!Title){Message.textContent=T('프리셋 이름을 입력해 주세요.','Enter a preset name.');return;}
   const Preset={id:'custom-'+crypto.randomUUID(),name:Title,engine:Owner,recognition:Recognition};
   await MutatePresets(Presets=>{if(Presets.length>=100)throw Error('caption_preset_limit');return [...Presets,Preset];});
   await Picker.refresh();if(Engine!==Owner||Revision!==OwnRevision)return;Picker.set(Owner,Preset.id);Fill(Recognition);Name.value='';Message.textContent=T('사용자 프리셋을 저장했습니다. 다운로드 창에서도 선택할 수 있습니다.','Custom preset saved. It is available in download options.');Root.dispatchEvent(new Event('input',{bubbles:true}));
  }catch(ErrorValue){Message.textContent=ErrorValue.message==='caption_cpu_precision_invalid'?T('CPU에서는 int8 또는 float32 정밀도를 선택해 주세요.','Choose int8 or float32 for CPU.'):T('프리셋을 저장하지 못했습니다. 입력 범위를 확인해 주세요.','Could not save the preset. Check the option ranges.');}
  finally{Operation=false;Lock();}
 });
 const Delete=CreateButton(T('프리셋 삭제','Delete preset'),async()=>{const Preset=Picker.custom;if(!Preset||Operation||Locked)return;const Owner=Engine,OwnRevision=Revision;Operation=true;Lock();
  try{if(!await ShowSettingsDialog({title:T('프리셋 삭제','Delete preset'),message:Preset.name+T(' 프리셋을 삭제하시겠습니까?',' — Delete this preset?'),danger:true}))return;
   await MutatePresets(Presets=>Presets.filter(P=>P.id!==Preset.id));await Picker.refresh();if(Engine!==Owner||Revision!==OwnRevision)return;
   Picker.set(Owner,'balanced');Fill(Picker.read().recognition);Root.dispatchEvent(new Event('input',{bubbles:true}));Message.textContent=T('프리셋을 삭제했습니다.','Preset deleted.');}catch{Message.textContent=T('프리셋을 삭제하지 못했습니다.','Could not delete the preset.');}finally{Operation=false;Lock();}
 });SaveRow.append(NameLabel,Save,Delete);Details.append(SaveRow,Message);Root.append(Picker.element,El('p',T('프리셋을 선택하거나 개별 설정에서 옵션을 조정하고 새 프리셋으로 저장하세요.','Choose a preset, or open individual settings to adjust options and save a new preset.'),'help'),Details);
 function ReadFields(){const Value={};for(const [Id,Control]of Inputs){Value[Id]=Control.type==='checkbox'?Control.checked:Control.type==='number'?Number(Control.value):Control.value;if(Control.type==='number'&&!Control.value)Value[Id]=NaN;}return NormalizeRecognitionOptions(Value,Engine,{strict:true});}
 function Fill(Value){
  Fields.replaceChildren();Inputs=new Map();for(const [Id,Definition]of EngineOptionFields(Engine).sort(([A],[B])=>(RecognitionFieldOrder.get(A)??RecognitionFieldOrder.size)-(RecognitionFieldOrder.get(B)??RecognitionFieldOrder.size))){
   const Label=El('label',T(Definition.ko,Definition.en),'field'),Control=El(Definition.type==='select'?'select':'input');Control.id='recognition-'+Id+'-'+crypto.randomUUID();Control.name=Id;Label.htmlFor=Control.id;
   if(Definition.type==='select'){for(const Item of Definition.values)Control.append(new Option(Item,Item));Control.value=Value[Id];}
   else if(Definition.type==='boolean'){Control.type='checkbox';Control.checked=Value[Id];Label.classList.add('caption-recognition-checkbox');}
   else{Control.type='number';Control.min=Definition.min;Control.max=Definition.max;Control.step=Definition.step;Control.value=Value[Id];}
   Control.disabled=Locked;Control.addEventListener('input',()=>{const Raw={};for(const [Key,Input]of Inputs)Raw[Key]=Input.type==='checkbox'?Input.checked:Input.type==='number'?Number(Input.value):Input.value;Picker.setManual(Raw);Delete.disabled=true;});
   if(Definition.type==='boolean')Label.prepend(Control);else Label.append(Control);Fields.append(Label);Inputs.set(Id,Control);
  }Lock();
 }
 function Lock(){const Value=Locked||Operation;Picker.setLocked(Value);for(const I of Inputs.values())I.disabled=Value;Save.disabled=Value;Name.disabled=Value;Delete.disabled=Value||!Picker.custom;}
 Picker.select.addEventListener('change',()=>{Revision++;});
 Fill(Picker.read().recognition);
 return {element:Root,read(){return {...Picker.read(),recognition:ReadFields()};},set(NextEngine,Id,Options){++Revision;Engine=NextEngine==='whisper.cpp'?'whisper.cpp':'faster-whisper';Picker.set(Engine,Id,Options);Fill(Options?NormalizeRecognitionOptions(Options,Engine):Picker.read().recognition);},setLocked(Value){Locked=Value;Lock();}};
}
