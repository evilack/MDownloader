import {CreateElement, CreateButton, SendRequest, SetButtonIcon} from './lib/ui.js';
import {Translate} from './lib/i18n.js';
import {DescribeSubtitleTracks} from './lib/download-options-selection.js';
import {SameLanguage} from './lib/subtitle-translation.js';
import {DiscoverModels} from './lib/translation-providers.js';

const Providers = ['deepl','google','azure','gemini','deepseek','openai','kakao'];
const ProviderNames = {deepl:'DeepL',google:'Google Translate',azure:'Azure Translator',gemini:'Gemini',deepseek:'DeepSeek',openai:'OpenAI',kakao:'Kakao'};
const Hosts = {deepl:['https://api-free.deepl.com/*','https://api.deepl.com/*'],google:['https://translation.googleapis.com/*'],gemini:['https://generativelanguage.googleapis.com/*'],deepseek:['https://api.deepseek.com/*'],openai:['https://api.openai.com/*'],kakao:['https://dapi.kakao.com/*']};
function Origins(Provider, Config)
{
	if (Provider !== 'azure') return Hosts[Provider] || [];
	const Url = new URL(Config.endpoint || 'https://api.cognitive.microsofttranslator.com');
	if (Url.protocol !== 'https:' || Url.username || Url.password || Url.search || Url.hash || Url.pathname !== '/' || !(Url.hostname === 'api.cognitive.microsofttranslator.com' || Url.hostname.endsWith('.cognitiveservices.azure.com'))) throw new Error('endpoint');
	return [Url.origin + '/*'];
}
const El = (Tag, Key, Class) => CreateElement(Tag, Key ? Translate(Key) : '', Class);
function Field(Parent, Key, Control)
{
	const Label = El('label', Key, 'download-options-field');
	Control.id = 'download-option-' + crypto.randomUUID(); Control.name = Key; Label.htmlFor = Control.id;
	Label.append(Control); Parent.append(Label); return Control;
}

export function CreateDownloadOptionsDialog()
{
	const Dialog = El('dialog', '', 'download-options-dialog'), Form = El('form'), Header = El('header'), Body = El('div', '', 'download-options-body'), Footer = El('footer');
	const Title = El('h2', 'download_options_title'); Title.id = 'download-options-title-' + crypto.randomUUID(); Dialog.setAttribute('aria-labelledby', Title.id);
	const Close = SetButtonIcon(CreateButton('', () => Dialog.close()), Translate('html_cancel'), 'cancel'); Header.append(Title, Close);
	const Quality = Field(Body, 'html_resolution_bitrate', El('select')); Quality.autofocus = true;
	const Subtitles = El('section'), SubTitle = El('h3', 'download_options_subtitles'), Tools = El('div', '', 'download-options-tools');
	const All = CreateButton(Translate('download_options_all'), () => setAll(true)), None = CreateButton(Translate('download_options_none'), () => setAll(false));
	const Search = El('input'); Search.type = 'search'; Search.placeholder = Translate('download_options_search'); Search.setAttribute('aria-label', Translate('download_options_search'));
	const Tracks = El('div', '', 'download-options-tracks'), Empty = El('p', 'download_options_no_subtitles', 'muted'); Tools.append(All, None); Subtitles.append(SubTitle, Tools, Search, Tracks, Empty); Body.append(Subtitles);
	const Translation = El('section'), ToggleLabel = El('label', 'translation_enable'), Toggle = El('input'); Toggle.type='checkbox'; ToggleLabel.prepend(Toggle); Translation.append(ToggleLabel);
	const TranslationFields = El('div'), Target = Field(TranslationFields, 'translation_target', El('input')), Source = Field(TranslationFields, 'download_options_source', El('select'));
	const ExistingNotice=El('p','download_options_existing','notice'); TranslationFields.append(ExistingNotice);
	Target.value='ko'; Target.maxLength=35; Target.autocomplete='off'; Target.autocapitalize='none'; Target.spellcheck=false;
	Toggle.name='translation-enabled'; const Details=El('details'), Summary=El('summary', 'download_options_service'); Details.append(Summary);
	const Provider=Field(Details,'translation_provider',El('select')), Model=Field(Details,'translation_model',El('select')), Effort=Field(Details,'translation_effort',El('select'));
	const RefreshModels=CreateButton(Translate('translation_refresh'),async()=>{
		const Owner=Provider.value, Config={...Settings.providers?.[Owner]}, OwnRevision=Revision;
		if(!Config.key) {setStatus(Translate('download_options_auth_required'),true); return;}
		RefreshModels.disabled=true;
		try {
			const Allowed=await chrome.permissions.request({origins:Origins(Owner,Config)});
			if(!Dialog.open || OwnRevision!==Revision) return;
			if(!Allowed) throw new Error('permission');
			setStatus(Translate('translation_loading'));
			const Models=await DiscoverModels(Owner,Config);
			if(!Dialog.open || OwnRevision!==Revision) return;
			Settings.providers[Owner]={...Settings.providers[Owner],models:Models};
			if(Provider.value===Owner) {fillModels(); setStatus(Translate('translation_models_loaded'));}
		} catch {if(Dialog.open && OwnRevision===Revision && Provider.value===Owner) setStatus(Translate('translation_error'),true);}
		finally {if(OwnRevision===Revision) RefreshModels.disabled=false;}
	});
	Details.append(RefreshModels);
	for(const Name of Providers) Provider.append(new Option(ProviderNames[Name],Name)); TranslationFields.append(Details); Translation.append(TranslationFields); Body.append(Translation);
	const Status=El('p','','notice'); Status.setAttribute('role','status'); Body.append(Status);
	function setStatus(Message, Error=false) {Status.textContent=Message; Status.dataset.error=String(Error);}
	const Retry=CreateButton(Translate('download_options_retry'), () => void load()); Retry.hidden=true; Body.append(Retry);
	const Cancel=CreateButton(Translate('html_cancel'),()=>Dialog.close()), Confirm=El('button','download_options_download','primary'); Confirm.type='submit'; Footer.append(Cancel,Confirm);
	Form.append(Header,Body,Footer); Dialog.append(Form); document.body.append(Dialog);
	let Data, Settings, Choices=[], Qualities=[], PageChoices=[], QualityChoices=[], Busy=false, Failed=false, Submitting=false, Remembered=new Map(), Resolve, CurrentKey, Revision=0;
	function setAll(Value) {for(const T of Choices) T.selected=Value; renderTracks();}
	function renderTracks()
	{
		const Existing=Toggle.checked && Choices.find(T=>SameLanguage(T.language,Target.value)); if(Existing) Existing.selected=true;
		ExistingNotice.hidden=!Existing; Source.disabled=!!Existing; Details.hidden=!!Existing;
		const Query=Search.value.toLowerCase(); Tracks.replaceChildren();
		for(const Track of Choices.filter(T=>(T.label+' '+T.language).toLowerCase().includes(Query)))
		{
			const Label=El('label'), Input=El('input'); Input.type='checkbox'; Input.checked=Track.selected; Input.disabled=Track===Existing;
			Input.addEventListener('change',()=>{Track.selected=Input.checked;}); Label.append(Input,document.createTextNode(Track.label+' ('+Track.language+')')); Tracks.append(Label);
		}
		Subtitles.hidden=Busy || Failed; Translation.hidden=Busy || Failed;
		Empty.hidden=Choices.length>0; Tools.hidden=!Choices.length; Tracks.hidden=!Choices.length;
		Toggle.disabled=!Choices.length; Target.disabled=!Toggle.checked || !Choices.length;
		TranslationFields.hidden=!Toggle.checked || !Choices.length; Search.hidden=Choices.length<=5;
	}
	function fillModels()
	{
		const Config=Settings.providers?.[Provider.value] || {}, Models=Config.models || [];
		Model.replaceChildren(new Option(Translate('translation_default'),''),...Models.map(M=>new Option(M.label || M.id,M.id)));
		if(Config.model && !Models.some(M=>M.id===Config.model)) Model.add(new Option(Config.model,Config.model));
		Model.value=Config.model || ''; fillEfforts();
	}
	function fillEfforts()
	{
		const Config=Settings.providers?.[Provider.value] || {}, M=(Config.models || []).find(X=>X.id===Model.value);
		Effort.replaceChildren(new Option(Translate('translation_default'),''),...(M?.efforts || []).map(E=>new Option(E,E)));
		if(Config.effort && ![...Effort.options].some(X=>X.value===Config.effort)) Effort.add(new Option(Config.effort,Config.effort));
		Effort.value=Config.effort || '';
	}
	function updateQualityChoices(PreviousIds)
	{
		const Old=new Map(Choices.map(T=>[T.id,T.selected]));
		const Items=[...new Map([...PageChoices,...(QualityChoices[Number(Quality.value)] || [])].map(T=>[T.id,T])).values()];
		Choices=Items.map(T=>({...T,selected:Old.has(T.id)?Old.get(T.id):PreviousIds ? PreviousIds.includes(T.id) : true}));
		const PriorSource=Source.value;
		Source.replaceChildren(new Option(Translate('download_options_auto'),'auto'),...Choices.map(T=>new Option(T.label,T.language)));
		Source.value=PriorSource || 'auto'; if(Source.selectedIndex<0) Source.value='auto';
		renderTracks();
	}
	async function load()
	{
		const OwnRevision=++Revision, RequestData=Data;
		Busy=true; Failed=false; Confirm.disabled=true; RefreshModels.disabled=false; Retry.hidden=true; setStatus(Translate('view_quality_checking')); renderTracks();
		try
		{
			const Type=RequestData.format==='YOUTUBE'?'youtubeQualities':RequestData.format==='WEBRTC'?'webrtcQualities':RequestData.format==='M3U8'?'hlsQualities':null;
			const LoadQualities=async()=>{
				if(!Type) return [];
				try {return await SendRequest(Type,RequestData.input);}
				catch(ErrorValue) {if(RequestData.format==='WEBRTC' && ErrorValue.key==='webrtc_quality_unavailable') return []; throw ErrorValue;}
			};
			const [Q, PageTracks, Stored]=await Promise.all([LoadQualities(),RequestData.format==='YOUTUBE'?[]:SendRequest('candidateSubtitleOptions',RequestData.input),chrome.storage.local.get(['subtitleTranslation','includeYoutubeAutoCaptions'])]);
			if(!Dialog.open || OwnRevision!==Revision) return;
			if(RequestData.format==='YOUTUBE' && !Q?.length) throw new Error('youtube_format_unavailable');
			const NextQualities=Q || [];
			const NextQualityChoices=RequestData.format==='YOUTUBE'?NextQualities.map(Quality=>(Quality.captions || []).filter(T=>Stored.includeYoutubeAutoCaptions!==false || T.kind!=='asr')) : await Promise.all(NextQualities.map(Quality=>DescribeSubtitleTracks(Quality.subtitles || [])));
			if(!Dialog.open || OwnRevision!==Revision) return;
			Settings=Stored.subtitleTranslation || {}; Settings.providers ||= {}; Qualities=NextQualities;
			PageChoices=PageTracks; QualityChoices=NextQualityChoices;
			const Previous=Remembered.get(CurrentKey);
			Quality.replaceChildren(...(!Qualities.length?[new Option(Translate('download_options_auto'),'auto')]:Qualities.map((Q,I)=>new Option(Q.scheduled ? Translate('view_youtube_scheduled_quality') : Q.resolution?.replace('x','×') || Q.name || Translate('download_options_auto'),String(I)))));
			Quality.disabled=Qualities.length === 1 && !!Qualities[0].scheduled;
			Confirm.textContent=Qualities[0]?.scheduled ? Translate('download_options_schedule') : Translate('download_options_download');
			Quality.value=Previous?.quality ?? (Qualities.length?'0':'auto'); if(Quality.selectedIndex<0) Quality.selectedIndex=0;
			Toggle.checked=Previous?.translation.enabled ?? !!Settings.enabled; Target.value=Previous?.translation.targetLanguage || Settings.targetLanguage || 'ko'; Provider.value=Previous?.translation.provider || Settings.provider || 'deepl';
			updateQualityChoices(Previous?.ids); Source.value=Previous?.translation.sourceLanguage || Settings.sourceLanguage || 'auto'; if(Source.selectedIndex<0) Source.value='auto';
			fillModels(); if(Previous?.translation.model) Model.value=Previous.translation.model; if(Previous?.translation.effort) Effort.value=Previous.translation.effort;
			setStatus('');
		}
		catch {if(OwnRevision===Revision && Dialog.open) {Failed=true; setStatus(Translate('download_options_load_failed'),true); Retry.hidden=false;}}
		finally {if(OwnRevision===Revision && Dialog.open) {Busy=false; Confirm.disabled=Failed; renderTracks();}}
	}
	Search.addEventListener('input',renderTracks); Toggle.addEventListener('change',renderTracks); Target.addEventListener('input',renderTracks); Provider.addEventListener('change',()=>{fillModels();setStatus('');}); Model.addEventListener('change',fillEfforts); Quality.addEventListener('change',()=>updateQualityChoices());
	Form.addEventListener('submit',async Event=>
	{
		Event.preventDefault(); if(Busy || Failed || Submitting) return;
		const OwnRevision=Revision;
		const Selected=Qualities[Number(Quality.value)], T={enabled:Toggle.checked && Choices.length>0,targetLanguage:Target.value.trim(),sourceLanguage:Source.value || 'auto',provider:Provider.value,model:Model.value,effort:Effort.value};
		if(!T.targetLanguage) T.targetLanguage='ko';
		if(!T.enabled && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(T.targetLanguage)) T.targetLanguage='ko';
		const Existing=Choices.some(Track=>SameLanguage(Track.language,T.targetLanguage));
		const Config=Settings.providers?.[T.provider] || {};
		if(T.enabled && !Existing && (!Config.key || ['gemini','deepseek','openai'].includes(T.provider) && !T.model)) {setStatus(Translate('download_options_auth_required'),true); return;}
		if(T.enabled && !Existing && !Choices.some(Track=>Track.selected)) {setStatus(Translate('download_options_source_required'),true); return;}
		if(T.enabled && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(T.targetLanguage)) {setStatus(Translate('download_options_invalid_language'),true); return;}
		if(T.enabled && !Existing && T.sourceLanguage!=='auto' && !Choices.some(Track=>Track.selected && SameLanguage(Track.language,T.sourceLanguage))) {setStatus(Translate('download_options_source_required'),true); return;}
		const Ids=Choices.filter(X=>X.selected).map(X=>X.id); Remembered.set(CurrentKey,{ids:Ids,quality:Quality.value,translation:T});
		try
		{
			Submitting=true; Confirm.disabled=true;
			const OriginsNeeded=[...(Selected?.serverPermission?[Selected.serverPermission]:[]),...(T.enabled && !Existing?Origins(T.provider,Config):[])];
			const Allowed=!OriginsNeeded.length || await chrome.permissions.request({origins:[...new Set(OriginsNeeded)]});
			if(!Dialog.open || OwnRevision!==Revision) return;
			if(!Allowed) {setStatus(Translate('view_permission_denied'),true); return;}
			Resolve({quality:Selected,...(!Selected?.scheduled ? {subtitleOptions:{trackIds:Ids,translation:T}} : {})}); Resolve=null; Dialog.close('apply');
		}
		catch {if(Dialog.open && OwnRevision===Revision) setStatus(Translate('view_permission_failed'),true);}
		finally {if(OwnRevision===Revision) {Submitting=false; Confirm.disabled=Busy || Failed;}}
	});
	Dialog.addEventListener('close',()=>{
		Revision++;
		Submitting=false;
		if(Resolve) {
			if(Settings && !Failed && !Busy) Remembered.set(CurrentKey,{ids:Choices.filter(T=>T.selected).map(T=>T.id),quality:Quality.value,translation:{enabled:Toggle.checked,targetLanguage:Target.value,sourceLanguage:Source.value,provider:Provider.value,model:Model.value,effort:Effort.value}});
			Resolve(null); Resolve=null;
		}
	});
	return {open(Candidate, Input) {Data={format:Candidate.format,input:Input}; CurrentKey=JSON.stringify([Input.tabId,Candidate.mediaKey || Input.scanId,Input.candidateId,Candidate.format]); Dialog.returnValue=''; Choices=[]; Qualities=[]; Status.textContent=''; Dialog.showModal(); void load(); return new Promise(R=>{Resolve=R;});}, close(){if(Dialog.open) Dialog.close();}};
}
