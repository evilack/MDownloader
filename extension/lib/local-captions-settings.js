import {CaptionModelCatalog} from '../data/caption-runtime-metadata.js';
export const CaptionModels=Object.freeze(Object.keys(CaptionModelCatalog));
const EmptyModels=Object.freeze([]),ModelsByEngine=Object.freeze(Object.fromEntries(['faster-whisper','whisper.cpp'].map(Engine=>[Engine,Object.freeze(CaptionModels.filter(Id=>Object.hasOwn(CaptionModelCatalog[Id],Engine)))])));
export const CaptionModelsForEngine=Engine=>ModelsByEngine[Engine]||EmptyModels;
export const CaptionModelName=Value=>CaptionModelCatalog[Value]?.label||Value;
export const CaptionLanguages=Object.freeze(['auto','ko','en','ja','zh','es','fr','de','pt','ru','hi','ar']);
export const CaptionSettingKey='localCaptions';
// Chrome storage and runtime transports may reorder dictionary properties.
// Identity must compare values, including nested engine options, not insertion order.
export function CaptionOptionsKey(Value){
 return JSON.stringify(Value,(_Key,Item)=>Item&&typeof Item==='object'&&!Array.isArray(Item)
  ? Object.fromEntries(Object.keys(Item).sort().map(Key=>[Key,Item[Key]])):Item);
}
import {NormalizeRecognitionOptions} from './caption-engine-options.js';
export function NormalizeCaptionSettings(Value={},Platform='win',{strict=false}={})
{
 const Default={enabled:false,engine:'none',model:'',language:'auto',container:true,formats:[],presetId:'balanced',recognition:{}};
 if(!Value || typeof Value!=='object' || Array.isArray(Value)) {if(strict)throw new TypeError('caption_invalid');return Default;}
 const Result={};
 for(const [Key,Fallback] of Object.entries(Default)) {
  let Next=Value[Key] ?? Fallback;
  const Valid=['enabled','container'].includes(Key)?typeof Next==='boolean':Key==='engine'?['none','faster-whisper','whisper.cpp'].includes(Next):Key==='model'?Next===''||CaptionModels.includes(Next):Key==='language'?CaptionLanguages.includes(Next):Key==='presetId'?typeof Next==='string'&&/^(fast|balanced|accuracy|manual|custom-[a-f\d-]{36})$/i.test(Next):Key==='recognition'?Next&&typeof Next==='object'&&!Array.isArray(Next):Array.isArray(Next)&&Next.length<=2&&Next.every(F=>['srt','vtt'].includes(F));
  if(!Valid){if(strict)throw new TypeError('caption_invalid');Next=Fallback;}
  Result[Key]=Key==='formats'?[...new Set(Next)]:Next;
 }
 if(Result.engine!=='none'&&!Result.container&&!Result.formats.length){if(strict)throw new TypeError('caption_invalid');Result.container=true;}
 if(Platform==='mac'&&Result.engine!=='none')Result.engine='whisper.cpp';
 if(Result.model&&!CaptionModelsForEngine(Result.engine).includes(Result.model)){if(strict)throw new TypeError('caption_invalid');Result.model='';}
 Result.recognition=NormalizeRecognitionOptions(Result.recognition,Result.engine==='whisper.cpp'?'whisper.cpp':'faster-whisper',{strict});
 if(Result.engine==='none'){Result.enabled=false;Result.model='';}
 return Result;
}
export function ResolveCaptionOptions(Saved,Override='inherit',Platform='win',Custom)
{
 if(!['inherit','on','off','custom'].includes(Override))throw new TypeError('caption_invalid');
 let Options;
 if(Override==='custom'){
  if(!Custom||typeof Custom!=='object'||Array.isArray(Custom)||Custom.enabled!==true||
   !['faster-whisper','whisper.cpp'].includes(Custom.engine)||Platform==='mac'&&Custom.engine!=='whisper.cpp'||
   !CaptionModelsForEngine(Custom.engine).includes(Custom.model)||!CaptionLanguages.includes(Custom.language)||
   Custom.container!==undefined&&typeof Custom.container!=='boolean'||
   !Array.isArray(Custom.formats)||!Custom.formats.length&&Custom.container===false||Custom.formats.length>2||Custom.formats.some(Format=>!['srt','vtt'].includes(Format)))throw new TypeError('caption_invalid');
  Options=NormalizeCaptionSettings(Custom,Platform,{strict:true});
 }else{
  Options=NormalizeCaptionSettings(Saved,Platform);
  Options.enabled=Options.engine!=='none'&&(Override==='inherit'?Options.enabled:Override==='on');
 }
 // A job owns its values and format array; caller/global settings cannot mutate it.
 return Object.freeze({...Options,formats:Object.freeze([...Options.formats]),recognition:Object.freeze({...Options.recognition})});
}
export function CaptionOutputName(Filename,Format)
{
 if(typeof Filename!=='string'||!Filename||/[\\/\u0000-\u001f]/.test(Filename)||!['srt','vtt'].includes(Format))throw new TypeError('caption_invalid');
 return Filename.replace(/\.[^.]+$/,'')+'.generated.'+Format;
}
