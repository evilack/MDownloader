/** Only the extension's offscreen runner may receive the active translation credential. */
export function HandleTranslationConfiguration(Message, Sender, Respond, Api = chrome)
{
	if (Message?.type !== 'subtitleTranslationConfiguration' || Sender.id !== Api.runtime.id ||
		Sender.url !== Api.runtime.getURL('hls-runner.html') || Sender.tab) return false;
	void Api.storage.local.get('subtitleTranslation').then(({subtitleTranslation: Settings}) =>
	{
		const Override = Message.options;
		const Provider = Override?.provider || Settings?.provider;
		const Enabled = Override ? Override.enabled === true : Settings?.enabled === true;
		if (!Enabled) return Respond({ok: true, data: {enabled: false}});
		if (!['deepl','google','azure','gemini','deepseek','openai','kakao'].includes(Provider)) return Respond({ok:false, error:{key:'subtitle_translation_failed', args:[]}});
		const Saved = Settings?.providers?.[Provider] || {};
		Respond({ok: true, data: {enabled: true, targetLanguage: Override?.targetLanguage || Settings?.targetLanguage,
			sourceLanguage: Override?.sourceLanguage || Settings?.sourceLanguage, provider: Provider,
			providers: {[Provider]: {...Saved, ...(Override?.model !== undefined ? {model:Override.model} : {}), ...(Override?.effort !== undefined ? {effort:Override.effort} : {})}}}});
	}, () => Respond({ok: false, error: {key: 'subtitle_translation_failed', args: []}}));
	return true;
}
