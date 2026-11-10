import {Translate} from './lib/i18n.js';

const StorageKey='panelMediaSplitRatio',MinimumPane=96,Step=16;
const ValidRatio=Value=>typeof Value==='number'&&Number.isFinite(Value)&&Value>=0&&Value<=1;

// Own only layout and its preference. Candidate/job components keep their data,
// actions and scroll positions while this component changes the shared boundary.
export function BindPanelMediaResize(Container,Media,Divider)
{
 const Handle=Divider.querySelector('#panel-media-resizer');
 let Ratio=null,Enabled=false,Edited=false,Drag,SaveQueue=Promise.resolve();
 function Bounds(){const Available=Math.max(0,Container.clientHeight-Divider.offsetHeight),Min=Math.min(MinimumPane,Available/2);return {available:Available,min:Min,max:Available-Min};}
 function Save(){const Value=Ratio;SaveQueue=SaveQueue.catch(()=>{}).then(()=>Value===null?chrome.storage.local.remove(StorageKey):chrome.storage.local.set({[StorageKey]:Value})).catch(()=>{});}
 function Layout(){
  if(!Enabled)return;
  const B=Bounds();if(!B.available)return;
  if(Ratio!==null){
   const Height=Math.max(B.min,Math.min(B.max,Ratio*B.available)),Value=Height+'px';
   Container.dataset.resized='true';if(Container.style.getPropertyValue('--panel-media-height')!==Value)Container.style.setProperty('--panel-media-height',Value);
  }else{delete Container.dataset.resized;Container.style.removeProperty('--panel-media-height');}
  const Height=Media.getBoundingClientRect().height,Percent=Height/B.available*100,Movable=B.max>B.min;
  Handle.setAttribute('aria-valuemin',String(Math.round(B.min/B.available*100)));
  Handle.setAttribute('aria-valuemax',String(Math.round(B.max/B.available*100)));
  Handle.setAttribute('aria-valuenow',String(Math.round(Percent)));
  Handle.setAttribute('aria-valuetext',Translate('panel_media_size',String(Math.round(Percent))));
  Handle.setAttribute('aria-disabled',String(!Movable));Handle.tabIndex=Movable?0:-1;
 }
 function SetHeight(Height){const B=Bounds();if(!B.available)return;Edited=true;Ratio=Math.max(B.min,Math.min(B.max,Height))/B.available;Layout();}
 function FinishDrag(Commit){
  if(!Drag)return;const Previous=Drag;Drag=undefined;delete Container.dataset.resizing;
  if(!Commit){Ratio=Previous.ratio;Layout();}else Save();
  if(Handle.hasPointerCapture(Previous.id))Handle.releasePointerCapture(Previous.id);
 }
 Handle.addEventListener('pointerdown',Event=>{
  if(!Enabled||Drag||!Event.isPrimary||Event.button!==0||Bounds().max<=Bounds().min)return;
  Event.preventDefault();Handle.focus();Edited=true;
  Drag={id:Event.pointerId,y:Event.clientY,height:Media.getBoundingClientRect().height,ratio:Ratio};
  Handle.setPointerCapture(Event.pointerId);Container.dataset.resizing='true';
 });
 Handle.addEventListener('pointermove',Event=>{if(Drag?.id===Event.pointerId)SetHeight(Drag.height+Event.clientY-Drag.y);});
 Handle.addEventListener('pointerup',Event=>{if(Drag?.id===Event.pointerId){SetHeight(Drag.height+Event.clientY-Drag.y);FinishDrag(true);}});
 Handle.addEventListener('pointercancel',Event=>{if(Drag?.id===Event.pointerId)FinishDrag(false);});
 Handle.addEventListener('lostpointercapture',()=>FinishDrag(true));
 Handle.addEventListener('keydown',Event=>{
  if(!Enabled||Event.altKey||Event.ctrlKey||Event.metaKey)return;
  if(Event.key==='Escape'&&Drag){Event.preventDefault();FinishDrag(false);return;}
  const B=Bounds(),Height=Media.getBoundingClientRect().height;
  const Next=Event.key==='ArrowUp'?Height-Step:Event.key==='ArrowDown'?Height+Step:Event.key==='Home'?B.min:Event.key==='End'?B.max:undefined;
  if(Next===undefined)return;Event.preventDefault();SetHeight(Next);Save();
 });
 Handle.addEventListener('dblclick',()=>{if(!Enabled)return;FinishDrag(false);Edited=true;Ratio=null;Layout();Save();});
 const Observer=new ResizeObserver(Layout);Observer.observe(Container);Observer.observe(Media);Observer.observe(Divider);
 window.addEventListener('blur',()=>FinishDrag(true));
 window.addEventListener('pagehide',()=>{FinishDrag(true);Observer.disconnect();},{once:true});
 void chrome.storage.local.get(StorageKey).then(Saved=>{if(!Edited&&ValidRatio(Saved[StorageKey])){Ratio=Saved[StorageKey];Layout();}}).catch(()=>{});
 return {setEnabled(Value){if(!Value)FinishDrag(false);Enabled=Value;Layout();}};
}
