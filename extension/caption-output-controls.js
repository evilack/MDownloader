import {CreateElement as El} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';
const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
export function CaptionOutputLabel(Value){return [...(Value.container!==false?[T('컨테이너에 포함','Embed in container')]:[]),...(Value.formats||[]).map(F=>F.toUpperCase())].join(' + ');}
export function CreateCaptionOutputControls(ClassName='caption-formats'){
 const Element=El('fieldset','',ClassName);Element.append(El('legend',T('출력 형식','Output formats')));
 const Checks=['container','srt','vtt'].map(Id=>{const Label=El('label'),Input=El('input');Input.type='checkbox';Input.name=Id;Input.value=Id;Label.append(Input,document.createTextNode(Id==='container'?T('컨테이너에 포함','Embed in container'):Id.toUpperCase()));Element.append(Label);return Input;});
 return {element:Element,checks:Checks,read(){return {container:Checks[0].checked,formats:Checks.slice(1).filter(C=>C.checked).map(C=>C.value)};},write(Value){Checks[0].checked=Value.container!==false;for(const C of Checks.slice(1))C.checked=Value.formats?.includes(C.value)===true;}};
}
