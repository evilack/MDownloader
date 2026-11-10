import {CreateElement as El} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';

const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
export const TranslationLanguages=Object.freeze(['ko','en','ja','zh','es','fr','de']);
export function LanguageCodeLabel(Code,{includeCode=true}={}){
 try{const Name=new Intl.DisplayNames([GetLocale()],{type:'language'}).of(Code);return includeCode?Name+' ('+Code+')':Name;}catch{return Code;}
}
export function FillLanguageChoices(Select,Codes,{auto=false,includeCode=true}={}){
 Select.replaceChildren(...Codes.map(Code=>new Option(Code==='auto'&&auto?T('자동 감지','Detect automatically'):LanguageCodeLabel(Code,{includeCode}),Code)));
}

/** Shared translation-language picker for Options and each download editor. */
export function CreateLanguageCodeControl({label,value='ko',input}={}){
 const Root=El('div','','language-code-control'),Label=El('label',label),Select=El('select');
 Select.id='language-code-'+crypto.randomUUID();Select.name='target-language-choice';Label.htmlFor=Select.id;
 FillLanguageChoices(Select,TranslationLanguages);Select.append(new Option(T('사용자 지정 (예: ko)','Custom (e.g. ko)'),'custom'));
 const Custom=El('label',T('사용자 지정 언어 코드','Custom language code'),'language-code-custom'),Input=input||El('input');
 Input.id||='language-code-custom-'+crypto.randomUUID();Input.name||='target-language-custom';Input.maxLength=35;Input.autocomplete='off';Input.autocapitalize='none';Input.spellcheck=false;Input.removeAttribute('list');Input.pattern='[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*';Custom.htmlFor=Input.id;Custom.append(Input);Root.append(Label,Select,Custom);
 function Sync(){Custom.hidden=Select.value!=='custom';if(Select.value!=='custom')Input.value=Select.value;}
 function Set(Code){Input.value=Code||'ko';Select.value=TranslationLanguages.includes(Input.value)?Input.value:'custom';Sync();}
 Select.addEventListener('change',()=>{Sync();Input.dispatchEvent(new Event('input',{bubbles:true}));});
 Set(value);
 return {element:Root,select:Select,input:Input,customField:Custom,set:Set,sync:Sync,get value(){return Input.value.trim();}};
}
