/** Only the extension's offscreen runner may receive the active translation credential. */
export async function ReadTranslationConfiguration(Override, Api = chrome)
{
	const {subtitleTranslation: Settings}=await Api.storage.local.get('subtitleTranslation');
	const Provider=Override?.provider || Settings?.provider;
	const Enabled=Override?Override.enabled===true:Settings?.enabled===true;
	if(!Enabled)return {enabled:false};
	if(!['deepl','google','azure','gemini','deepseek','openai','kakao'].includes(Provider))throw new Error('subtitle_translation_failed');
	const Saved=Settings?.providers?.[Provider] || {};
	return {enabled:true,targetLanguage:Override?.targetLanguage || Settings?.targetLanguage,
		sourceLanguage:Override?.sourceLanguage || Settings?.sourceLanguage,provider:Provider,
		providers:{[Provider]:{...Saved,...(Override?.model!==undefined?{model:Override.model}:{}),...(Override?.effort!==undefined?{effort:Override.effort}:{})}}};
}
export function HandleTranslationConfiguration(Message, Sender, Respond, Api = chrome)
{
	if (Message?.type !== 'subtitleTranslationConfiguration' || Sender.id !== Api.runtime.id ||
		Sender.url !== Api.runtime.getURL('hls-runner.html') || Sender.tab) return false;
	void ReadTranslationConfiguration(Message.options,Api).then(Data=>Respond({ok:true,data:Data}),()=>Respond({ok:false,error:{key:'subtitle_translation_failed',args:[]}}));
	return true;
}
