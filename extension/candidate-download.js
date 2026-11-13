import {ErrorText, Translate, LocalizedError} from './lib/i18n.js';
import {CreateButton, SendRequest} from './lib/ui.js';
import {IsStreamFormat} from './lib/media.js';
import {CreateDownloadOptionsDialog} from './download-options-dialog.js';
import {CandidateJobControl,UpdateCandidateDownloadButton} from './lib/candidate-download-state.js';

export function CreateCandidateDownloadActions(Announce, OnActionFinished, AwaitScan = async () => {}, MakeOptions = CreateDownloadOptionsDialog)
{
	let Options;
	let ActiveActions = 0;
	function CreateDownloadButton(Candidate, Input, IsCurrent, MountOptions)
	{
		const Button = CreateButton('', async UiEvent =>
		{
			if (Button.disabled) return;
			const Control=CandidateJobControl(Button);
			if(Control)
			{
				ActiveActions++;
				UpdateCandidateDownloadButton(Button,{controlRequestId:Control.requestId});
				try {await SendRequest('control',Control);}
				catch(ErrorValue) {UpdateCandidateDownloadButton(Button,{controlRequestId:undefined});Announce(ErrorText(ErrorValue));}
				finally {ActiveActions--;OnActionFinished();}
				return;
			}
			if (ActiveActions) return;
			const WithOptions=UiEvent.shiftKey===true;
			let Placement;
			ActiveActions++;
			UpdateCandidateDownloadButton(Button,{pending:true});
			try
			{
				if (Candidate.sitePermission && !await chrome.permissions.contains({origins: [Candidate.sitePermission]}))
				{
					Announce(Translate('view_site_access_needed', Candidate.sitePermission.slice(0, -2)));
					return;
				}
				const Origins=Candidate.format==='YOUTUBE' ? ['https://www.youtube.com/*','https://youtubei.googleapis.com/*',...(!WithOptions?['https://*.googlevideo.com/*']:[])] : Candidate.serverPermission ? [Candidate.serverPermission] : [];
				if (Origins.length && !await chrome.permissions.request({origins:Origins}))
				{
					Announce(Translate('view_permission_denied')); return;
				}
				await AwaitScan();
				if (!IsCurrent()) return;
				let Selection={};
				if(WithOptions) {
					Options ||= MakeOptions();
					Placement=MountOptions();
					Selection=await (Placement?.container ? Options.openInline(Candidate,Input,Placement.container) : Options.open(Candidate,Input));
				} else if(Candidate.format==='YOUTUBE') {
					const Qualities=await SendRequest('youtubeQualities',Input);
					if(!Qualities?.length) throw new LocalizedError('youtube_format_unavailable');
					Selection={quality:Qualities[0]};
				}
				if (!Selection || !IsCurrent()) return;
				UpdateCandidateDownloadButton(Button,{queued:true}); Announce(Translate('view_download_queueing'));
				const Chosen=Selection.quality;
				const Quality=Candidate.format==='YOUTUBE' ? Chosen?.quality : Candidate.format==='WEBRTC' && Chosen ? {name:Chosen.name,session:Chosen.session} : undefined;
				const Job=await SendRequest('enqueue',{...Input,requestId:crypto.randomUUID(),...(Candidate.format==='M3U8' && Selection.liveStart?{liveStart:Selection.liveStart}:{}),...(Selection.captionOverride?{captionOverride:Selection.captionOverride}:{}),...(Selection.captionSettings?{captionSettings:Selection.captionSettings}:{}),...(Candidate.format==='M3U8' && Chosen?.url?{variantUrl:Chosen.url}:{}),...(Quality?{quality:Quality}:{}),...(Selection.subtitleOptions?{subtitleOptions:Selection.subtitleOptions}:{})});
				if (['complete','failed','canceled','interrupted','unknown'].includes(Job.state)) UpdateCandidateDownloadButton(Button,{queued:false});
				if (!IsCurrent()) return;
				if (Job.state==='started') Announce(IsStreamFormat(Candidate.format)?'':Translate('view_download_started'));
				else Announce(Translate('view_download_check_manager'));
			}
			catch(ErrorValue) {UpdateCandidateDownloadButton(Button,{queued:false});if(IsCurrent()) Announce(ErrorText(ErrorValue));}
			finally {Placement?.dispose(); UpdateCandidateDownloadButton(Button,{pending:false}); ActiveActions--; OnActionFinished();}
		},true);
		return UpdateCandidateDownloadButton(Button,{permission:!!(Candidate.serverPermission || Candidate.sitePermission)});
	}
	return {CreateDownloadButton,IsBusy:()=>ActiveActions>0,CloseQuality:()=>Options?.close()};
}
