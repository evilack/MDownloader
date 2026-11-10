import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CreateDownloadOptionsDialog} from '../extension/download-options-dialog.js';

// A small DOM test double exercises production handlers; native layout/focus is covered in the browser harness.
class Node {
 constructor(tag='',text='') {this.tagName=tag;this.children=[];this.events={};this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this.checked=false;this._text=text;this._value='';this.className='';this.classList={add:(...v)=>{this.className=[...new Set([...this.className.split(' '),...v])].join(' ');}};}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');} set textContent(v){this._text=String(v);this.children=[];}
 append(...nodes){for(let n of nodes){if(typeof n==='string')n=new Node('#text',n);if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);n.parentElement=this;this.children.push(n);}}
 prepend(...nodes){for(const n of nodes.reverse()){n.parentElement=this;this.children.unshift(n);}}
 insertBefore(node,before){if(!before){this.append(node);return node;}const index=this.children.indexOf(before);if(index<0)throw Error('missing child');if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(c=>c!==node);node.parentElement=this;this.children.splice(index,0,node);return node;}
 replaceChildren(...nodes){this.children=[];this._text='';this._value='';this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=v;} getAttribute(k){return this.attributes[k];} removeAttribute(k){delete this.attributes[k];}
 addEventListener(k,f){(this.events[k] ||= []).push(f);} async emit(k){for(const f of this.events[k]||[])await f({preventDefault(){},target:this});}
 get options(){return this.children;} add(n){this.append(n);}
 get value(){if(this.tagName==='select')return this.options.some(n=>n.value===this._value)?this._value:this.options[0]?.value||'';return this._value;}
 set value(v){this._value=String(v);} get selectedIndex(){return this.options.findIndex(n=>n.value===this.value);} set selectedIndex(v){this._value=this.options[v]?.value||'';}
 get disabled(){return this._disabled||false;} set disabled(value){this._disabled=value;if(value && globalThis.document?.activeElement===this)document.activeElement=document.body;}
 showModal(){this.open=true;(walk(this,n=>n.autofocus&&!n.disabled)||walk(this,n=>n.tagName==='button'&&!n.disabled))?.focus();} close(value=''){this.returnValue=value;this.open=false;void this.emit('close');} focus(){if(!this.disabled){this.focused=true;document.activeElement=this;}}
}
function walk(node,predicate){if(predicate(node))return node;for(const child of node.children){const found=walk(child,predicate);if(found)return found;}}
function nodes(node,predicate){return [...(predicate(node)?[node]:[]),...node.children.flatMap(c=>nodes(c,predicate))];}
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
const en={id:'1'.repeat(64),language:'en',label:'English'},ja={id:'2'.repeat(64),language:'ja',label:'Japanese'},ko={id:'3'.repeat(64),language:'ko',label:'Korean'};
function setup(t,{tracks=[en,ja],qualities=[{resolution:'1920x1080'},{resolution:'1280x720'}],format='M3U8',settings={enabled:true,provider:'openai',targetLanguage:'ko',providers:{openai:{key:'test-only',model:'model-from-api',effort:'low',models:[{id:'model-from-api',efforts:['low','high']}]}}},failure=false,pending=false}={}){
 const body=new Node('body'),requests=[],permissions=[],releases=[];let fail=failure;
 globalThis.document={body,createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
 globalThis.Option=class extends Node{constructor(label,value){super('option',label);this.value=value;}};
 globalThis.chrome={i18n:{getMessage:k=>k},storage:{local:{get:async()=>({subtitleTranslation:structuredClone(settings)})}},runtime:{sendMessage:async m=>{requests.push(m);if(pending)await new Promise(r=>{releases.push(r);});if(fail)return{ok:false,error:{key:'failed',args:[]}};return{ok:true,data:m.type==='candidateSubtitleOptions'?tracks:qualities};}},permissions:{request:async data=>{permissions.push(data);return true;}}};
 t.after(()=>{delete globalThis.document;delete globalThis.Option;delete globalThis.chrome;});
 const controller=CreateDownloadOptionsDialog(),dialog=body.children[0],candidate={format,name:'Original title.m3u8',mediaKey:'test'};
 const open=()=>controller.open(candidate,{tabId:1,scanId:'scan',candidateId:1});const result=open();
 const name=k=>walk(dialog,n=>n.name===k),cls=k=>walk(dialog,n=>n.className.split(' ').includes(k)),button=label=>walk(dialog,n=>n.tagName==='button'&&(n.textContent===label||n.attributes['aria-label']===label));
 return {controller,dialog,result,open,name,cls,button,requests,permissions,body,fail:v=>{fail=v;},release:()=>{pending=false;for(const release of releases)release();},tracks:()=>nodes(cls('download-options-tracks'),n=>n.tagName==='input')};
}
test('production editor identifies its media and summarizes real quality, selections and translation',async t=>{
 const h=setup(t);await flush();assert.equal(h.cls('download-options-media-name').textContent,'Original title.m3u8');assert.equal(h.cls('download-options-count').textContent,'2/2');assert.match(h.cls('download-options-summary').textContent,/1080p.*Subs\(2\).*Trans\(ko\)/);assert.match(h.cls('download-options-service-summary').textContent,/OpenAI.*model-from-api.*low/);
});

test('quality selection uses one resolution label without repeating dimensions below it',async t=>{
 const h=setup(t);await flush();const quality=h.name('html_resolution_bitrate');
 assert.deepEqual(quality.options.map(option=>option.textContent),['1080p','720p']);
 const section=quality.parentElement.parentElement;
 assert.equal(nodes(section,n=>n.tagName==='p'&&!n.hidden&&!!n.textContent).length,0);
 quality.value='1';await quality.emit('change');
 await walk(h.dialog,n=>n.tagName==='form').emit('submit');
 assert.equal((await h.result).quality.resolution,'1280x720');
});

test('HLS options expose current/beginning start, default to beginning and remember the choice on reopen',async t=>{
 const h=setup(t,{tracks:[]});await flush();const start=h.name('download_options_live_start');
 assert.ok(start);assert.equal(start.parentElement.parentElement.hidden,false);assert.equal(start.value,'beginning');
 assert.deepEqual(start.options.map(O=>O.value),['beginning','current']);
 assert.equal(start.attributes['aria-describedby'],h.cls('download-options-live-help').id);
 start.value='current';await start.emit('change');h.controller.close();await h.result;
 const next=h.open();await flush();assert.equal(start.value,'current');
 await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await next).liveStart,'current');
});

test('other formats do not expose or submit HLS start options',async t=>{
 const h=setup(t,{tracks:[],format:'MP4'});await flush();const start=h.name('download_options_live_start');
 assert.ok(start);assert.equal(start.parentElement.parentElement.hidden,true);
 await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await h.result).liveStart,undefined);
});

test('a current-start choice made while lookup is pending survives lookup completion and retry',async t=>{
 const h=setup(t,{tracks:[],pending:true});const start=h.name('download_options_live_start');
 start.value='current';await start.emit('change');h.release();await flush();assert.equal(start.value,'current');
 h.controller.close();await h.result;
 const next=h.open();await flush();assert.equal(start.value,'current');h.controller.close();await next;
});
test('footer uses shared icon buttons with accessible download and cancel names',async t=>{
 const h=setup(t);await flush();const footer=walk(h.dialog,n=>n.tagName==='footer');const buttons=nodes(footer,n=>n.tagName==='button');assert.equal(buttons.length,2);assert.deepEqual(buttons.map(n=>n.attributes['aria-label']),['html_cancel','download_options_download']);assert.deepEqual(buttons.map(n=>n.children[0]?.src),['icons/cancel.png','icons/download.png']);
});
test('clear, individual selection, translation toggle and reopen retain choices',async t=>{
 const h=setup(t);await flush();await h.button('download_options_none').emit('click');assert.equal(h.cls('download-options-count').textContent,'0/2');h.tracks()[1].checked=true;await h.tracks()[1].emit('change');h.name('translation-enabled').checked=false;await h.name('translation-enabled').emit('change');assert.match(h.cls('download-options-summary').textContent,/Subs\(1\)/);assert.doesNotMatch(h.cls('download-options-summary').textContent,/Trans/);h.controller.close();assert.equal(await h.result,null);const next=h.open();await flush();assert.deepEqual(h.tracks().map(n=>n.checked),[false,true]);h.controller.close();await next;
});
test('many subtitle search filters rows without discarding hidden selections',async t=>{
 const h=setup(t,{tracks:[...Array.from({length:23},(_,i)=>({id:String(i).padStart(64,'0'),language:'l'+i,label:'Language '+i}))]});await flush();const search=walk(h.dialog,n=>n.type==='search');assert.equal(search.hidden,false);search.value='Language 22';await search.emit('input');assert.equal(h.tracks().length,1);assert.equal(h.cls('download-options-count').textContent,'23/23');search.value='';await search.emit('input');assert.equal(h.tracks().length,23);
});
test('selected existing target bypasses translation without locking any subtitle checkbox',async t=>{
 const h=setup(t,{tracks:[en,ko],settings:{enabled:true,targetLanguage:'ko',provider:'openai',providers:{}}});await flush();
 assert.deepEqual(h.tracks().map(n=>[n.checked,n.disabled]),[[true,false],[true,false]]);
 assert.equal(walk(h.dialog,n=>n.tagName==='details').hidden,true);assert.equal(h.cls('download-options-credential').hidden,true);
 await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await h.result).subtitleOptions.trackIds.length,2);assert.equal(h.permissions.length,0);
});
test('unchecking target-language caption activates translation and preserves the choice across target changes and reopen',async t=>{
 const h=setup(t,{tracks:[en,ko]});await flush();const korean=h.tracks()[1];assert.equal(korean.disabled,false);
 korean.checked=false;await korean.emit('change');
 assert.equal(h.tracks()[1],korean,'changing selection does not replace the focused checkbox');
 assert.match(h.cls('download-options-summary').textContent,/Subs\(1\).*Trans\(ko\)/);
 assert.equal(h.name('download_options_source').disabled,false);assert.equal(walk(h.dialog,n=>n.tagName==='details').hidden,false);
 const target=h.name('translation_target');target.value='ja';await target.emit('change');target.value='ko';await target.emit('change');
 assert.equal(h.tracks()[1].checked,false);
 h.controller.close();await h.result;const next=h.open();await flush();assert.equal(h.tracks()[1].checked,false);
 await walk(h.dialog,n=>n.tagName==='form').emit('submit');const chosen=await next;
 assert.deepEqual(chosen.subtitleOptions.trackIds,[en.id]);assert.equal(chosen.subtitleOptions.translation.enabled,true);assert.equal(chosen.subtitleOptions.translation.targetLanguage,'ko');
 assert.equal(h.permissions.length,1);
});
test('clear all can uncheck the target and checking it again skips translation',async t=>{
 const h=setup(t,{tracks:[en,ko]});await flush();await h.button('download_options_none').emit('click');
 assert.deepEqual(h.tracks().map(n=>[n.checked,n.disabled]),[[false,false],[false,false]]);
 assert.equal(h.cls('download-options-count').textContent,'0/2');
 h.tracks()[1].checked=true;await h.tracks()[1].emit('change');assert.doesNotMatch(h.cls('download-options-summary').textContent,/Trans/);
 assert.equal(h.name('download_options_source').disabled,true);
});

test('valid submission freezes subtitle choices until permission finishes and cancel/reopen restores them',async t=>{
 const h=setup(t,{format:'YOUTUBE',tracks:[],qualities:[{resolution:'1920x1080',captions:[en,ko],serverPermission:'https://*.googlevideo.com/*'}],settings:{enabled:true,targetLanguage:'ko',provider:'openai',providers:{}}});
 await flush();let ResolvePermission;chrome.permissions.request=()=>new Promise(R=>{ResolvePermission=R;});
 const Pending=walk(h.dialog,n=>n.tagName==='form').emit('submit');await flush();
 assert.equal(h.tracks()[1].disabled,true);assert.equal(h.name('translation_target').disabled,true);
 assert.equal(walk(h.dialog,n=>n.tagName==='header').children[1].disabled,false,'cancel remains available');
 h.controller.close();assert.equal(await h.result,null);const Next=h.open();await flush();
 assert.equal(h.tracks()[1].disabled,false);assert.equal(h.name('translation_target').disabled,false);
 ResolvePermission(true);await Pending;assert.equal(h.dialog.open,true);assert.equal(h.tracks()[1].disabled,false);
 h.controller.close();assert.equal(await Next,null);
});

test('permission denial restores editable target captions and the prior source disabled state',async t=>{
 const h=setup(t,{format:'YOUTUBE',tracks:[],qualities:[{resolution:'1920x1080',captions:[en,ko],serverPermission:'https://*.googlevideo.com/*'}],settings:{enabled:true,targetLanguage:'ko',provider:'openai',providers:{}}});
 await flush();chrome.permissions.request=async()=>false;await walk(h.dialog,n=>n.tagName==='form').emit('submit');
 assert.equal(h.tracks()[1].disabled,false);assert.equal(h.name('translation_target').disabled,false);
 assert.equal(h.name('download_options_source').disabled,true);assert.equal(h.dialog.open,true);
});

test('no subtitles and live without subtitles omit the whole subtitle and translation sections',async t=>{
 const h=setup(t,{tracks:[]});await flush();assert.equal(h.cls('download-options-subtitles').hidden,true);assert.equal(h.cls('download-options-translation').hidden,true);assert.doesNotMatch(h.cls('download-options-summary').textContent,/Subs|Trans/);
});
test('source selection supports a Japanese-only original without inventing English',async t=>{
 const h=setup(t,{tracks:[ja]});await flush();const source=h.name('download_options_source');assert.deepEqual(source.options.map(n=>n.value),['auto','ja']);source.value='ja';await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await h.result).subtitleOptions.translation.sourceLanguage,'ja');
});
test('missing credentials are visible with real settings link and block confirmation',async t=>{
 const h=setup(t,{settings:{enabled:true,provider:'openai',targetLanguage:'ko',providers:{}}});await flush();assert.equal(h.cls('download-options-credential').hidden,false);assert.match(walk(h.cls('download-options-credential'),n=>n.tagName==='a').href,/options\.html/);await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal(h.dialog.open,true);assert.equal(h.permissions.length,0);
});
test('scheduled YouTube uses only automatic quality and icon label, returns no subtitle request',async t=>{
 const h=setup(t,{format:'YOUTUBE',qualities:[{scheduled:true,quality:{scheduled:true,videoId:'abcdefghijk'}}],tracks:[]});await flush();assert.equal(h.name('html_resolution_bitrate').disabled,true);assert.equal(h.button('download_options_schedule').children[0].src,'icons/download.png');assert.equal(h.cls('download-options-summary').textContent,'download_options_auto · Ready');await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await h.result).subtitleOptions,undefined);
});
test('single quality is disabled and no fake model or effort options are introduced',async t=>{
 const h=setup(t,{qualities:[{resolution:'640x360'}],settings:{enabled:false,provider:'azure',providers:{azure:{key:'local'}}}});await flush();assert.equal(h.name('html_resolution_bitrate').disabled,true);assert.equal(h.name('translation_model').parentElement.hidden,true);assert.equal(h.name('translation_effort').parentElement.hidden,true);
});
test('failed lookup keeps retry visible and can recover',async t=>{
 const h=setup(t,{failure:true});await flush();assert.equal(h.button('download_options_retry').hidden,false);assert.equal(h.button('download_options_download').disabled,true);h.fail(false);await h.button('download_options_retry').emit('click');await flush();assert.equal(h.button('download_options_retry').hidden,true);assert.equal(h.cls('download-options-subtitles').hidden,false);
});
test('lookup failure shows its localized cause and clears it after successful retry',async t=>{
 const h=setup(t,{failure:true});await flush();
 assert.equal(h.cls('download-options-lookup-status').textContent,'download_options_load_failed · failed');
 h.fail(false);await h.button('download_options_retry').emit('click');await flush();
 assert.equal(h.cls('download-options-lookup-status').hidden,true);
 assert.doesNotMatch(h.cls('download-options-summary').textContent,/failed/);
});
test('CSS gives only the outer modal scrolling and compact shared icon controls',async()=>{
 const css=await readFile(new URL('../extension/download-options.css',import.meta.url),'utf8');assert.match(css,/\.download-options-dialog\s*\{[^}]*overflow:\s*auto/s);assert.match(css,/\.download-options-body[^}]*max-block-size:\s*none[^}]*overflow:\s*visible/s);assert.match(css,/\.download-options-tracks\s*\{[^}]*max-block-size:\s*none[^}]*overflow:\s*visible/s);assert.match(css,/\.download-options-actions\s*\{[^}]*gap:\s*4px/s);assert.doesNotMatch(css,/scrollbar-width:\s*none|::-webkit-scrollbar|focus-trap/);
});

test('loading exposes subtitle status and disables confirmation until real lookup resolves',async t=>{
 const h=setup(t,{pending:true});await flush();assert.equal(h.cls('download-options-subtitles').hidden,false);assert.equal(h.cls('download-options-translation').hidden,true);assert.equal(h.cls('download-options-lookup-status').textContent,'view_quality_checking');assert.equal(h.button('download_options_download').disabled,true);h.release();await flush();assert.equal(h.cls('download-options-lookup-status').hidden,true);assert.equal(h.button('download_options_download').disabled,false);
});
test('closing before lookup resolves ignores stale result and resolves cancellation',async t=>{
 const h=setup(t,{pending:true});h.controller.close();assert.equal(await h.result,null);h.release();await flush();assert.equal(h.dialog.open,false);assert.equal(h.tracks().length,0);
});
test('model changes use only discovered efforts and retained provider choices',async t=>{
 const h=setup(t,{settings:{enabled:true,provider:'openai',providers:{openai:{key:'local',model:'first',effort:'low',models:[{id:'first',efforts:['low']},{id:'second',efforts:['medium','high']}]},azure:{key:'local'}}}});await flush();const model=h.name('translation_model'),effort=h.name('translation_effort'),provider=h.name('translation_provider');model.value='second';await model.emit('change');assert.deepEqual(effort.options.map(n=>n.value),['','medium','high']);effort.value='high';await effort.emit('change');assert.match(h.cls('download-options-service-summary').textContent,/second.*high/);provider.value='azure';await provider.emit('change');assert.equal(model.parentElement.hidden,true);provider.value='openai';await provider.emit('change');assert.equal(model.value,'second');assert.equal(effort.value,'high');
});
test('inline editor uses the same form, request validation and icon actions without opening a modal',async t=>{
 const h=setup(t);await flush();h.controller.close();await h.result;const container=new Node('div');h.body.append(container);const result=h.controller.openInline({format:'MP4',name:'Inline.mp4'},{tabId:2,candidateId:3},container);await flush();assert.equal(h.dialog.open,false);const form=walk(container,n=>n.tagName==='form');assert.equal(walk(form,n=>n.className==='download-options-media-name').textContent,'Inline.mp4');await form.emit('submit');assert.equal((await result).subtitleOptions.trackIds.length,2);assert.equal(form.hidden,true);
});
test('selected quality and manually cleared quality-specific tracks survive switching away and back',async t=>{
 const h=setup(t,{format:'YOUTUBE',tracks:[],qualities:[{resolution:'1920x1080',captions:[en,ja]},{resolution:'1280x720',captions:[ko]}],settings:{enabled:false,provider:'deepl',providers:{}}});await flush();h.tracks()[1].checked=false;await h.tracks()[1].emit('change');const quality=h.name('html_resolution_bitrate');quality.value='1';await quality.emit('change');assert.match(h.cls('download-options-summary').textContent,/720p/);quality.value='0';await quality.emit('change');assert.deepEqual(h.tracks().map(n=>n.checked),[true,false]);await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await h.result).quality.resolution,'1920x1080');
});

test('target language offers the approved common seven options and selection updates translation',async t=>{
 const h=setup(t);await flush();const target=h.name('translation_target');assert.equal(target.tagName,'select');assert.deepEqual(target.options.slice(0,7).map(n=>n.value),['ko','en','ja','zh','es','fr','de']);target.value='fr';await target.emit('change');assert.match(h.cls('download-options-summary').textContent,/Trans\(fr\)/);assert.equal(h.name('translation_target_custom').parentElement.hidden,true);await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await h.result).subtitleOptions.translation.targetLanguage,'fr');
});
test('genuine saved arbitrary BCP47 target is selectable, retained on reopen and submitted unchanged',async t=>{
 const h=setup(t,{settings:{enabled:false,provider:'deepl',targetLanguage:'pt-BR',providers:{}}});await flush();assert.equal(h.name('translation_target').value,'pt-BR');assert.equal(h.name('translation_target').options.some(n=>n.value==='pt-BR'),true);h.controller.close();await h.result;const result=h.open();await flush();assert.equal(h.name('translation_target').value,'pt-BR');await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await result).subtitleOptions.translation.targetLanguage,'pt-BR');
});
test('custom target input preserves entry of additional valid language tags',async t=>{
 const h=setup(t,{settings:{enabled:false,provider:'deepl',providers:{}}});await flush();const target=h.name('translation_target'),custom=h.name('translation_target_custom');target.value='custom';await target.emit('change');assert.equal(custom.parentElement.hidden,false);custom.value='zh-Hant';await custom.emit('input');await walk(h.dialog,n=>n.tagName==='form').emit('submit');assert.equal((await h.result).subtitleOptions.translation.targetLanguage,'zh-Hant');
});

test('modal has enabled native initial focus while loading and focuses available quality on first completion',async t=>{
 const h=setup(t,{pending:true}),close=walk(h.dialog,n=>n.tagName==='header').children[1];assert.equal(document.activeElement,close);assert.equal(document.activeElement.disabled,false);h.release();await flush();assert.equal(document.activeElement,h.name('html_resolution_bitrate'));assert.equal(document.activeElement.disabled,false);
});
test('initial lookup does not move focus after user keyboard or pointer interaction',async t=>{
 const h=setup(t,{pending:true}),form=walk(h.dialog,n=>n.tagName==='form'),close=walk(h.dialog,n=>n.tagName==='header').children[1];close.focus();await form.emit('keydown');h.release();await flush();assert.equal(document.activeElement,close);
});
test('retry preserves focused retry action rather than refocusing the quality field',async t=>{
 const h=setup(t,{failure:true});await flush();const retry=h.button('download_options_retry');h.fail(false);retry.focus();await retry.emit('click');await flush();assert.notEqual(document.activeElement,h.name('html_resolution_bitrate'));
});
test('single disabled quality leaves enabled native close action focused',async t=>{
 const h=setup(t,{qualities:[{resolution:'1920x1080'}]});await flush();assert.equal(document.activeElement,walk(h.dialog,n=>n.tagName==='header').children[1]);assert.equal(document.activeElement.disabled,false);
});
