import {ErrorText, Translate, LocalizedError} from './lib/i18n.js';
import {CreateButton, SendRequest, SetButtonIcon, SetControlLabel} from './lib/ui.js';
import {IsStreamFormat} from './lib/media.js';
import {CreateDownloadOptionsDialog} from './download-options-dialog.js';

export function CreateCandidateDownloadActions(Announce, OnActionFinished, AwaitScan = async () => {}, MakeOptions = CreateDownloadOptionsDialog)
{
	let Options;
	let ActiveActions = 0;
	function CreateDownloadButton(Candidate, Input, IsCurrent)
	{
		const Label = Translate(Candidate.serverPermission ? 'view_download_with_permission' : 'view_download');
		const Button = CreateButton('', async UiEvent =>
		{
			if (ActiveActions) return;
			ActiveActions++;
			try
			{
				const WithOptions=!!UiEvent.shiftKey;
				const Origins=Candidate.format==='YOUTUBE' ? ['https://www.youtube.com/*','https://youtubei.googleapis.com/*',...(!WithOptions?['https://*.googlevideo.com/*']:[])] : Candidate.serverPermission ? [Candidate.serverPermission] : [];
				if (Origins.length && !await chrome.permissions.request({origins:Origins}))
				{
					Announce(Translate('view_permission_denied')); return;
				}
				await AwaitScan();
				if (!IsCurrent()) return;
				let Selection={};
				if(WithOptions){Options ||= MakeOptions(); Selection=await Options.open(Candidate,Input);}
				else if(Candidate.format==='YOUTUBE'){
					const Qualities=await SendRequest('youtubeQualities',Input);
					if(!Qualities?.length) throw new LocalizedError('youtube_format_unavailable');
					Selection={quality:Qualities[0]};
				}
				if (!Selection || !IsCurrent()) return;
				Button.disabled=true; SetControlLabel(Button, Translate('view_download_queueing')); Announce(Translate('view_download_queueing'));
				const Chosen=Selection.quality;
				const Quality=Candidate.format==='YOUTUBE' ? Chosen?.quality : Candidate.format==='WEBRTC' && Chosen ? {name:Chosen.name,session:Chosen.session} : undefined;
				const Job=await SendRequest('enqueue',{...Input,requestId:crypto.randomUUID(),...(Candidate.format==='M3U8' && Chosen?.url?{variantUrl:Chosen.url}:{}),...(Quality?{quality:Quality}:{}),...(Selection.subtitleOptions?{subtitleOptions:Selection.subtitleOptions}:{})});
				if (!IsCurrent()) return;
				if (Job.state==='started') Announce(IsStreamFormat(Candidate.format)?'':Translate('view_download_started'));
				else Announce(Translate('view_download_check_manager'));
			}
			catch(ErrorValue) {if(IsCurrent()) Announce(ErrorText(ErrorValue));}
			finally {Button.disabled=false; SetControlLabel(Button,Label); ActiveActions--; OnActionFinished();}
		},true);
		return SetButtonIcon(Button,Label,'download');
	}
	return {CreateDownloadButton,IsBusy:()=>ActiveActions>0,CloseQuality:()=>Options?.close()};
}
