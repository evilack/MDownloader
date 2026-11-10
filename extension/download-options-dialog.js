import {CreateElement, CreateButton, SendRequest, SetButtonIcon} from './lib/ui.js';
import {Translate,ErrorText} from './lib/i18n.js';
import {DescribeSubtitleTracks} from './lib/download-options-selection.js';
import {SameLanguage} from './lib/subtitle-translation.js';
import {CreateCaptionDownloadOption,CaptionText} from './local-captions-ui.js';
import {DiscoverModels} from './lib/translation-providers.js';
import {CreateLanguageCodeControl,LanguageCodeLabel} from './language-code-control.js';
import {TranslationProviderCatalog, TranslationProviderIds as Providers, TranslationProviderNames as ProviderNames, TranslationProviderOrigins as Origins, ProviderPresentation} from './lib/translation-provider-catalog.js';

const El = (Tag, Key, Class) => CreateElement(Tag, Key ? Translate(Key) : '', Class);
const GeneratedSource='speech-generated';
function Field(Parent, Key, Control)
{
	const Label = El('label', Key, 'download-options-field');
	Control.id = 'download-option-' + crypto.randomUUID(); Control.name = Key; Label.htmlFor = Control.id;
	Label.append(Control); Parent.append(Label); return Control;
}

export function CreateDownloadOptionsDialog()
{
	const Dialog = El('dialog', '', 'download-options-dialog'), Form = El('form', '', 'download-options-editor'), Header = El('header'), Body = El('div', '', 'download-options-body'), Footer = El('footer');
	Form.noValidate=true;
	const Title = El('h2', 'download_options_title'); Title.id = 'download-options-title-' + crypto.randomUUID(); Dialog.setAttribute('aria-labelledby', Title.id);
	Form.setAttribute('aria-labelledby',Title.id);
	const Heading=El('div'), MediaName=El('p','','download-options-media-name'); Heading.append(Title,MediaName);
	const Close = SetButtonIcon(CreateButton('', () => closeOptions()), Translate('html_cancel'), 'cancel'); Header.append(Heading, Close);
	const QualitySection=El('section'), Quality = Field(QualitySection, 'html_resolution_bitrate', El('select')); Close.autofocus=true; Body.append(QualitySection);
	const LiveSection=El('section','','download-options-live-start'), LiveStart=Field(LiveSection,'download_options_live_start',El('select'));
	LiveStart.append(new Option(Translate('download_options_live_beginning'),'beginning'),new Option(Translate('download_options_live_current'),'current'));
	const LiveHelp=El('p','download_options_live_help','muted download-options-live-help'); LiveHelp.id='download-options-live-help-'+crypto.randomUUID();
	LiveStart.setAttribute('aria-describedby',LiveHelp.id); LiveSection.append(LiveHelp); LiveSection.hidden=true; Body.append(LiveSection);
	const Subtitles = El('section','','download-options-subtitles'), SubtitleHeading=El('div','','download-options-subtitle-heading'), SubTitle = El('h3', 'download_options_subtitles'), Count=El('span','','download-options-count'), Tools = El('div', '', 'download-options-tools'); SubTitle.append(Count);
	const All = CreateButton(Translate('download_options_all'), () => setAll(true)), None = CreateButton(Translate('download_options_none'), () => setAll(false));
	const Search = El('input'); Search.type = 'search'; Search.placeholder = Translate('download_options_search'); Search.setAttribute('aria-label', Translate('download_options_search'));
	const Tracks = El('div', '', 'download-options-tracks'), Empty = El('p', 'download_options_no_subtitles', 'muted'); Tools.append(All, None); SubtitleHeading.append(SubTitle,Tools); Subtitles.append(SubtitleHeading, Search, Tracks, Empty); Body.append(Subtitles);
	const Translation = El('section','','download-options-translation'), TranslationTitle=El('h3','translation_heading'), ToggleLabel = El('label', '', 'download-options-toggle'), Toggle = El('input'), ToggleText=El('span'), ToggleName=El('strong','translation_enable'), ToggleHelp=El('small','translation_help'); Toggle.type='checkbox'; Toggle.setAttribute('role','switch'); ToggleText.append(ToggleName,ToggleHelp); ToggleLabel.append(ToggleText,Toggle); Translation.append(TranslationTitle,ToggleLabel);
	const TranslationFields = El('div','','download-options-translation-fields'), Source = Field(TranslationFields, 'download_options_source', El('select'));
	const TargetPicker=CreateLanguageCodeControl({label:Translate('translation_target')}),Target=TargetPicker.select,CustomTarget=TargetPicker.input;TargetPicker.element.classList.add('download-options-field');TranslationFields.append(TargetPicker.element);
	function targetLanguage() {return TargetPicker.value;}
	function setTarget(Code) {TargetPicker.set(Code);}
	const ExistingNotice=El('p','download_options_existing','notice'); TranslationFields.append(ExistingNotice);
	CustomTarget.name='translation_target_custom';
	Toggle.name='translation-enabled'; const Details=El('details','','download-options-service'), Summary=El('summary'), ServiceSummary=El('span','','download-options-service-summary'), ServiceFields=El('div','','download-options-service-fields'); Summary.append(ServiceSummary); Details.append(Summary,ServiceFields);
	const Provider=Field(ServiceFields,'translation_provider',El('select')), Model=Field(ServiceFields,'translation_model',El('select')), Effort=Field(ServiceFields,'translation_effort',El('select'));
	const RefreshModels=CreateButton(Translate('translation_refresh'),async()=>{
		const Owner=Provider.value, Config={...Settings.providers?.[Owner]}, OwnRevision=Revision;
		if(!Config.key) {setStatus(Translate('download_options_auth_required'),true); return;}
		RefreshModels.disabled=true;
		try {
			const Allowed=await chrome.permissions.request({origins:Origins(Owner,Config)});
			if(!isOpen() || OwnRevision!==Revision) return;
			if(!Allowed) throw new Error('permission');
			setStatus(Translate('translation_loading'));
			const Models=await DiscoverModels(Owner,Config);
			if(!isOpen() || OwnRevision!==Revision) return;
			Settings.providers[Owner]={...Settings.providers[Owner],models:Models};
			if(Provider.value===Owner) {fillModels(); setStatus(Translate('translation_models_loaded'));}
		} catch {if(isOpen() && OwnRevision===Revision && Provider.value===Owner) setStatus(Translate('translation_error'),true);}
		finally {if(OwnRevision===Revision) RefreshModels.disabled=false;}
	});
	const CredentialsLink=El('a','translation_heading','download-options-link'); CredentialsLink.href='options.html?section=translation'; CredentialsLink.target='_blank'; CredentialsLink.rel='noopener'; ServiceFields.append(RefreshModels,CredentialsLink);
	const Credential=El('p','','download-options-credential'), CredentialText=El('span','download_options_auth_required'), CredentialLink=El('a','translation_heading'); CredentialLink.href=CredentialsLink.href; CredentialLink.target='_blank'; CredentialLink.rel='noopener'; Credential.append(CredentialText,document.createTextNode(' '),CredentialLink);
	for(const Name of Providers) Provider.append(new Option(ProviderNames[Name],Name)); TranslationFields.append(Details,Credential); Translation.append(TranslationFields); Body.append(Translation);
	const Captions=CreateCaptionDownloadOption({onChange:()=>renderTranslationState()});Body.insertBefore(Captions.section,Translation);
	const GeneratedNotice=El('p','','download-options-live-help muted');GeneratedNotice.id='download-generated-source-'+crypto.randomUUID();GeneratedNotice.textContent=CaptionText('음성 인식으로 생성한 자막을 번역합니다. 원본 자막과 번역본을 함께 저장합니다.','Translate the speech-generated captions. Both the original and translated captions are saved.');TranslationFields.prepend(GeneratedNotice);GeneratedNotice.hidden=true;
	const Status=El('p','','notice download-options-status'); Status.setAttribute('role','status'); Status.tabIndex=-1; Body.append(Status);
	function setStatus(Message, Error=false) {Status.textContent=Message; Status.dataset.error=String(Error); Status.hidden=!Message; if(Error) Status.focus();}
	const LookupStatus=El('p','','notice download-options-lookup-status'); LookupStatus.setAttribute('role','status');
	const Retry=CreateButton(Translate('download_options_retry'), () => void load()); Retry.hidden=true; Subtitles.append(LookupStatus,Retry);
	const FooterSummary=El('p','','download-options-summary'), Actions=El('div','','download-options-actions'), Cancel=SetButtonIcon(CreateButton('',()=>closeOptions()),Translate('html_cancel'),'cancel'), Confirm=SetButtonIcon(El('button','','primary'),Translate('download_options_download'),'download'); Confirm.type='submit'; Actions.append(Cancel,Confirm); Footer.append(FooterSummary,Actions);
	Form.append(Header,Body,Footer); Dialog.append(Form); document.body.append(Dialog);
	let Data, Settings, Choices=[], Qualities=[], PageChoices=[], QualityChoices=[], TrackInputs=[], SubmissionLocks=[], Busy=false, Failed=false, LookupFailure='', Submitting=false, Remembered=new Map(), SelectionById=new Map(), TranslationSource='auto', Resolve, CurrentKey, Revision=0, InlineOpen=false, InitialFocusPending=false;
	function isOpen() {return InlineOpen || Dialog.open;}
	function closeOptions(Value='') {if(InlineOpen) {InlineOpen=false; Form.hidden=true; onClose();} else if(Dialog.open) Dialog.close(Value);}
	function setAll(Value) {for(const T of Choices) T.selected=Value; renderTracks();}
	function currentQuality() {return Qualities[Number(Quality.value)];}
	function generatedTranslationSource() {return Captions.canGenerate && (Source.value===GeneratedSource || Source.value==='auto' && !Choices.some(T=>T.selected));}
	function renderSourceChoices()
	{
		if(TranslationSource===GeneratedSource ? !Captions.canGenerate && !Captions.validationError : TranslationSource!=='auto' && !Choices.some(T=>T.selected && SameLanguage(T.language,TranslationSource))) TranslationSource='auto';
		const Items=[new Option(Translate('download_options_auto'),'auto'),...Choices.map(T=>new Option(T.label,T.language))];
		if(Captions.canGenerate){
		 const Code=Captions.language,Name=Code==='auto'?CaptionText('언어 자동 감지','Detect language'):LanguageCodeLabel(Code);
		 Items.push(new Option(CaptionText('음성 자막 · ','Speech captions · ')+Name,GeneratedSource));
		}
		Source.replaceChildren(...Items);Source.value=TranslationSource;if(Source.selectedIndex<0)Source.value='auto';
	}
	function hasSelectedTarget(Language=targetLanguage()) {return Choices.some(T=>T.selected && SameLanguage(T.language,Language)) || generatedTranslationSource() && SameLanguage(Captions.language,Language);}
	function setSubmitting(Value)
	{
		Submitting=Value;
		Captions.setLocked(Value);
		if(Value)
		{
			SubmissionLocks=[Quality,LiveStart,Toggle,Source,Target,CustomTarget,Provider,Model,Effort,Search,All,None,RefreshModels,...TrackInputs].map(Control=>[Control,Control.disabled]);
			for(const [Control] of SubmissionLocks) Control.disabled=true;
		}
		else
		{
			for(const [Control,Disabled] of SubmissionLocks) Control.disabled=Disabled;
			SubmissionLocks=[];
		}
		Confirm.disabled=Submitting || Busy || Failed;
	}
	function renderSummary()
	{
		const Selected=currentQuality(), Resolution=Selected?.resolution?.replace('x','×'), Height=Selected?.resolution?.split('x')[1], Scheduled=!!Selected?.scheduled;
		const QualityText=Scheduled || !Selected ? Translate('download_options_auto') : Height ? Height+'p' : Selected.name || Resolution || Translate('download_options_auto');
		const Existing=Toggle.checked && hasSelectedTarget(), SelectedCount=Choices.filter(T=>T.selected).length;
		Count.textContent=Busy || Failed ? '' : SelectedCount+'/'+Choices.length;
		FooterSummary.textContent=CaptionText('현재 설정 : ','Current settings : ')+[QualityText, !LiveSection.hidden?Translate(LiveStart.value==='current'?'download_options_live_current':'download_options_live_beginning'):'', Scheduled?'Ready':Busy?Translate('view_quality_checking'):Failed?Translate('download_options_load_failed'):'',!Busy && !Failed && !Scheduled && SelectedCount?'subs('+SelectedCount+')':'',!Busy && !Failed && Captions.canGenerate?'gensub':'',!Busy && !Failed && !Scheduled && Toggle.checked && (SelectedCount || generatedTranslationSource()) && !Existing?'Trans('+targetLanguage()+')':''].filter(Boolean).join(', ');
		ServiceSummary.textContent=[ProviderNames[Provider.value],Model.value,Effort.value].filter(Boolean).join(' · ') || Translate('download_options_service');
		const Config=Settings?.providers?.[Provider.value] || {};
		Credential.hidden=Busy || Failed || !Toggle.checked || !Choices.length && !Captions.canGenerate || Existing || !!Config.key && (!TranslationProviderCatalog[Provider.value]?.capabilities.requiresModel || !!Model.value);
	}
	function renderTranslationState()
	{
		renderSourceChoices();
		const Generated=generatedTranslationSource(),Available=Choices.length>0 || Captions.canGenerate,Existing=Toggle.checked && hasSelectedTarget();
		Translation.hidden=Busy || Failed || !Available;Toggle.disabled=Submitting || !Available;Target.disabled=Submitting || !Toggle.checked || !Available;
		CustomTarget.parentElement.hidden=Target.value!=='custom';CustomTarget.disabled=Target.disabled;TranslationFields.hidden=!Toggle.checked || !Available;
		GeneratedNotice.hidden=!Generated;ExistingNotice.hidden=!Existing;Source.disabled=Submitting || !Available;Details.hidden=Existing;
		Source.setAttribute('aria-describedby',Generated?GeneratedNotice.id:'');
		renderSummary();
	}
	function renderTracks()
	{
		const Query=Search.value.toLowerCase(); Tracks.replaceChildren(); TrackInputs=[];
		for(const Track of Choices.filter(T=>(T.label+' '+T.language).toLowerCase().includes(Query)))
		{
			const Label=El('label'), Input=El('input'); Input.type='checkbox'; Input.checked=Track.selected;
			Input.name='subtitles'; Input.value=Track.id;
			TrackInputs.push(Input);
			const LabelText=El('span'), Meta=El('small'); LabelText.textContent=Track.label; Meta.textContent=Track.language;
			Input.addEventListener('change',()=>{Track.selected=Input.checked; renderTranslationState();}); Label.append(Input,LabelText,Meta); Tracks.append(Label);
		}
		Subtitles.hidden=!Busy && !Failed && !Choices.length; Translation.hidden=Busy || Failed || !Choices.length;
		Empty.hidden=Busy || Failed || Choices.length>0; Tools.hidden=Busy || Failed || !Choices.length; Tracks.hidden=Busy || Failed || !Choices.length;
		Toggle.disabled=!Choices.length; Target.disabled=!Toggle.checked || !Choices.length;
		CustomTarget.parentElement.hidden=Target.value!=='custom'; CustomTarget.disabled=Target.disabled;
		TranslationFields.hidden=!Toggle.checked || !Choices.length; Search.hidden=Busy || Failed || Choices.length<=5;
		LookupStatus.hidden=!Busy && !Failed; LookupStatus.textContent=Busy?Translate('view_quality_checking'):Failed?[Translate('download_options_load_failed'),LookupFailure].filter(Boolean).join(' · '):''; LookupStatus.dataset.error=String(Failed);
		renderTranslationState();
	}
	function fillModels()
	{
		const Config=Settings.providers?.[Provider.value] || {}, Models=Config.models || [], View=ProviderPresentation(Provider.value);
		Model.replaceChildren(new Option(Translate('translation_default'),''),...Models.map(M=>new Option(M.label || M.id,M.id)));
		if(Config.model && !Models.some(M=>M.id===Config.model)) Model.add(new Option(Config.model,Config.model));
		Model.value=Config.model || ''; Model.parentElement.hidden=!View.models || !Models.length && !Config.model; RefreshModels.hidden=!View.refresh; fillEfforts();
	}
	function fillEfforts()
	{
		const Config=Settings.providers?.[Provider.value] || {}, M=(Config.models || []).find(X=>X.id===Model.value);
		Effort.replaceChildren(new Option(Translate('translation_default'),''),...(M?.efforts || []).map(E=>new Option(E,E)));
		if(Config.effort && Config.model===Model.value && ![...Effort.options].some(X=>X.value===Config.effort)) Effort.add(new Option(Config.effort,Config.effort));
		Effort.value=Config.model===Model.value ? Config.effort || '' : ''; Effort.parentElement.hidden=!ProviderPresentation(Provider.value,M?.efforts || []).effort; renderSummary();
	}
	function updateQualityChoices(PreviousIds)
	{
		for(const Track of Choices) SelectionById.set(Track.id,Track.selected);
		const Items=[...new Map([...PageChoices,...(QualityChoices[Number(Quality.value)] || [])].map(T=>[T.id,T])).values()];
		Choices=Items.map(T=>({...T,selected:SelectionById.has(T.id)?SelectionById.get(T.id):PreviousIds ? PreviousIds.includes(T.id) : true}));
		renderTracks();
	}
	async function load()
	{
		const OwnRevision=++Revision, RequestData=Data;
		Busy=true; Failed=false; LookupFailure=''; Confirm.disabled=true; Quality.disabled=true; RefreshModels.disabled=false; Retry.hidden=true; setStatus(''); renderTracks();
		try
		{
			const Type=RequestData.format==='YOUTUBE'?'youtubeQualities':RequestData.format==='WEBRTC'?'webrtcQualities':RequestData.format==='M3U8'?'hlsQualities':null;
			const LoadQualities=async()=>{
				if(!Type) return [];
				try {return await SendRequest(Type,RequestData.input);}
				catch(ErrorValue) {if(RequestData.format==='WEBRTC' && ErrorValue.key==='webrtc_quality_unavailable') return []; throw ErrorValue;}
			};
			const [Q, PageTracks, Stored,Platform]=await Promise.all([LoadQualities(),RequestData.format==='YOUTUBE'?[]:SendRequest('candidateSubtitleOptions',RequestData.input),chrome.storage.local.get(['subtitleTranslation','includeYoutubeAutoCaptions','localCaptions']),chrome.runtime.getPlatformInfo?.() || {os:'win'}]);
			if(!isOpen() || OwnRevision!==Revision) return;
			if(RequestData.format==='YOUTUBE' && !Q?.length) throw new Error('youtube_format_unavailable');
			const NextQualities=Q || [];
			const NextQualityChoices=RequestData.format==='YOUTUBE'?NextQualities.map(Quality=>(Quality.captions || []).filter(T=>Stored.includeYoutubeAutoCaptions!==false || T.kind!=='asr')) : await Promise.all(NextQualities.map(Quality=>DescribeSubtitleTracks(Quality.subtitles || [])));
			if(!isOpen() || OwnRevision!==Revision) return;
			Settings=Stored.subtitleTranslation || {}; Settings.providers ||= {}; Qualities=NextQualities;
			PageChoices=PageTracks; QualityChoices=NextQualityChoices;
			const Previous=Remembered.get(CurrentKey);
			Captions.set(Stored.localCaptions,Previous?.captionOverride || 'inherit',Previous?.captionSettings,Platform.os);
			void Captions.loadInventory();
			Quality.replaceChildren(...(!Qualities.length?[new Option(Translate('download_options_auto'),'auto')]:Qualities.map((Q,I)=>new Option(Q.scheduled ? Translate('view_youtube_scheduled_quality') : Q.resolution ? Q.resolution.split('x')[1]+'p' : Q.name || Translate('download_options_auto'),String(I)))));
			Quality.disabled=Qualities.length <= 1;
			SetButtonIcon(Confirm,Translate(Qualities[0]?.scheduled ? 'download_options_schedule' : 'download_options_download'),'download');
			Quality.value=Previous?.quality ?? (Qualities.length?'0':'auto'); if(Quality.selectedIndex<0) Quality.selectedIndex=0;
			Toggle.checked=Previous?.translation.enabled ?? !!Settings.enabled; setTarget(Previous?.translation.targetLanguage || Settings.targetLanguage || 'ko'); Provider.value=Previous?.translation.provider || Settings.provider || 'deepl';
			updateQualityChoices(Previous?.ids); TranslationSource=Previous?.translationSource || (Previous?.translation.generated?GeneratedSource:Previous?.translation.sourceLanguage || Settings.sourceLanguage || 'auto');
			if(Previous) Settings.providers[Provider.value]={...Settings.providers[Provider.value],model:Previous.translation.model,effort:Previous.translation.effort}; fillModels();
			setStatus('');
		}
		catch(ErrorValue) {if(OwnRevision===Revision && isOpen()) {Failed=true; LookupFailure=typeof ErrorValue?.key==='string'?ErrorText(ErrorValue):''; Retry.hidden=false;}}
		finally {if(OwnRevision===Revision && isOpen()) {
			Busy=false; Confirm.disabled=Failed; renderTracks();
			// Native focus starts on enabled Close while data is pending. Move once to
			// the ready primary field only if the user has not interacted or moved focus.
			const FocusQuality=InitialFocusPending && !Failed && !Quality.disabled && document.activeElement===Close;
			InitialFocusPending=false; if(FocusQuality) Quality.focus();
		}}
	}
	for(const Type of ['pointerdown','keydown','input','change']) Form.addEventListener(Type,()=>{InitialFocusPending=false;});
	Form.addEventListener('focusin',Event=>{if(Event.target!==Close) InitialFocusPending=false;});
	Search.addEventListener('input',renderTracks); Toggle.addEventListener('change',renderTracks); Target.addEventListener('change',renderTracks); CustomTarget.addEventListener('input',renderTracks); Provider.addEventListener('change',()=>{fillModels();setStatus('');}); Model.addEventListener('change',()=>{fillEfforts(); Settings.providers[Provider.value]={...Settings.providers[Provider.value],model:Model.value,effort:Effort.value};}); Effort.addEventListener('change',()=>{Settings.providers[Provider.value]={...Settings.providers[Provider.value],effort:Effort.value};renderSummary();}); Quality.addEventListener('change',()=>updateQualityChoices());
	Source.addEventListener('change',()=>{TranslationSource=Source.value;renderTranslationState();});
	for(const Type of ['input','change']) Form.addEventListener(Type,()=>{if(Status.dataset.error==='true') setStatus('');});
	Form.addEventListener('submit',async Event=>
	{
		Event.preventDefault(); if(Busy || Failed || Submitting) return;
		if(Captions.validationError){setStatus(Captions.validationError,true);return;}
		const CaptionOverride=Captions.select.value,CaptionSettings=Captions.captionSettings;
		const OwnRevision=Revision;
		const Selected=Qualities[Number(Quality.value)],Generated=generatedTranslationSource(),T={enabled:Toggle.checked && (Choices.length>0 || Generated),targetLanguage:targetLanguage(),sourceLanguage:Generated?Captions.language:Source.value || 'auto',provider:Provider.value,model:Model.value,effort:Effort.value,...(Generated?{generated:true}:{})};
		if(!T.targetLanguage) T.targetLanguage='ko';
		if(!T.enabled && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(T.targetLanguage)) T.targetLanguage='ko';
		const Existing=hasSelectedTarget(T.targetLanguage);
		const Config=Settings.providers?.[T.provider] || {};
		if(T.enabled && !Existing && (!Config.key || TranslationProviderCatalog[T.provider]?.capabilities.requiresModel && !T.model)) {setStatus(Translate('download_options_auth_required'),true); return;}
		if(T.enabled && !Existing && !Generated && !Choices.some(Track=>Track.selected)) {setStatus(Translate('download_options_source_required'),true); return;}
		if(T.enabled && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(T.targetLanguage)) {setStatus(Translate('download_options_invalid_language'),true); return;}
		if(T.enabled && !Existing && !Generated && T.sourceLanguage!=='auto' && !Choices.some(Track=>Track.selected && SameLanguage(Track.language,T.sourceLanguage))) {setStatus(Translate('download_options_source_required'),true); return;}
		const Ids=Choices.filter(X=>X.selected).map(X=>X.id); Remembered.set(CurrentKey,{ids:Ids,quality:Quality.value,translation:T,translationSource:Source.value,captionOverride:CaptionOverride,captionSettings:Captions.customSettings,liveStart:LiveStart.value});
		try
		{
			setSubmitting(true);
			const OriginsNeeded=[...(Selected?.serverPermission?[Selected.serverPermission]:[]),...(T.enabled && !Existing?Origins(T.provider,Config):[])];
			const Allowed=!OriginsNeeded.length || await chrome.permissions.request({origins:[...new Set(OriginsNeeded)]});
			if(!isOpen() || OwnRevision!==Revision) return;
			if(!Allowed) {setStatus(Translate('view_permission_denied'),true); return;}
			Resolve({quality:Selected,captionOverride:CaptionOverride,...(CaptionSettings?{captionSettings:CaptionSettings}:{}),...(!LiveSection.hidden?{liveStart:LiveStart.value}:{}),...(!Selected?.scheduled ? {subtitleOptions:{trackIds:Ids,translation:T}} : {})}); Resolve=null; closeOptions('apply');
		}
		catch {if(isOpen() && OwnRevision===Revision) setStatus(Translate('view_permission_failed'),true);}
		finally {if(OwnRevision===Revision) setSubmitting(false);}
	});
	function onClose() {
		Revision++;
		Captions.cancel();
		setSubmitting(false); InitialFocusPending=false;
		if(Resolve) {
			if(Settings && !Failed && !Busy) Remembered.set(CurrentKey,{ids:Choices.filter(T=>T.selected).map(T=>T.id),quality:Quality.value,captionOverride:Captions.select.value,captionSettings:Captions.customSettings,liveStart:LiveStart.value,translationSource:Source.value,translation:{enabled:Toggle.checked,targetLanguage:targetLanguage(),sourceLanguage:Source.value===GeneratedSource?Captions.language:Source.value,provider:Provider.value,model:Model.value,effort:Effort.value}});
			Resolve(null); Resolve=null;
		}
	}
	Dialog.addEventListener('close',onClose);
	function open(Candidate,Input,Container)
	{
		if(isOpen()) closeOptions();
		Data={format:Candidate.format,input:Input}; CurrentKey=JSON.stringify([Input.tabId,Candidate.mediaKey || Input.scanId,Input.candidateId,Candidate.format]);
		LiveSection.hidden=Candidate.format!=='M3U8' || Candidate.live===false; LiveStart.value=Remembered.get(CurrentKey)?.liveStart || 'beginning';
		Dialog.returnValue=''; Choices=[]; Qualities=[]; SelectionById=new Map(); TranslationSource='auto'; Search.value=''; Details.open=false; Form.hidden=false; setStatus('');
		MediaName.textContent=Candidate.name || Candidate.title || ''; MediaName.title=MediaName.textContent; MediaName.hidden=!MediaName.textContent;
		Quality.replaceChildren(new Option(Translate('download_options_auto'),'auto')); Quality.disabled=true; InitialFocusPending=!Container; SetButtonIcon(Confirm,Translate('download_options_download'),'download');
		if(Container) {Container.append(Form); InlineOpen=true;} else {Dialog.append(Form); Dialog.showModal();}
		const Result=new Promise(R=>{Resolve=R;}); void load(); return Result;
	}
	LiveStart.addEventListener('change',renderSummary);
	return {open,openInline(Candidate,Input,Container) {if(!Container) throw new TypeError('Inline container required'); return open(Candidate,Input,Container);},close:closeOptions};
}
