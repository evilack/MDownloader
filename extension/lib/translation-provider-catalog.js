/** Shared provider identity, configuration capabilities and permission scope for both settings surfaces.
 * Model lists and reasoning levels remain actual service metadata, never catalogue fixtures. */
function Provider(Id, Name, ModelMode, Origins, Extra = {})
{
	return Object.freeze({
		id: Id, name: Name, origins: Object.freeze(Origins),
		capabilities: Object.freeze({
			modelMode: ModelMode,
			requiresModel: ModelMode === 'dynamic',
			discovery: ModelMode === 'dynamic',
			reasoning: ModelMode === 'dynamic',
			azure: false, kakao: false, ...Extra,
		}),
	});
}

export const TranslationProviderCatalog = Object.freeze({
	deepl: Provider('deepl', 'DeepL', 'static', ['https://api-free.deepl.com/*', 'https://api.deepl.com/*']),
	google: Provider('google', 'Google Cloud Translation', 'fixed', ['https://translation.googleapis.com/*']),
	azure: Provider('azure', 'Azure Translator', 'none', [], {azure: true}),
	gemini: Provider('gemini', 'Gemini / Gemma', 'dynamic', ['https://generativelanguage.googleapis.com/*']),
	deepseek: Provider('deepseek', 'DeepSeek', 'dynamic', ['https://api.deepseek.com/*']),
	openai: Provider('openai', 'OpenAI', 'dynamic', ['https://api.openai.com/*']),
	kakao: Provider('kakao', 'Kakao', 'none', ['https://dapi.kakao.com/*'], {kakao: true}),
});
export const TranslationProviderIds = Object.freeze(Object.keys(TranslationProviderCatalog));
export const TranslationProviderNames = Object.freeze(Object.fromEntries(
	TranslationProviderIds.map(Id => [Id, TranslationProviderCatalog[Id].name])
));

export function ProviderPresentation(ProviderId, Efforts = [])
{
	const Capabilities = TranslationProviderCatalog[ProviderId]?.capabilities;
	return {
		azure: Capabilities?.azure === true,
		kakao: Capabilities?.kakao === true,
		models: ['static', 'dynamic'].includes(Capabilities?.modelMode),
		fixed: Capabilities?.modelMode === 'fixed',
		effort: Capabilities?.reasoning === true && Efforts.length > 0,
		refresh: Capabilities?.discovery === true,
	};
}

/** Match the translation adapter's existing Azure endpoint validation before permission requests. */
export function TranslationProviderOrigins(ProviderId, {endpoint} = {})
{
	if (ProviderId !== 'azure') return [...(TranslationProviderCatalog[ProviderId]?.origins ?? [])];
	const Url = new URL(endpoint || 'https://api.cognitive.microsofttranslator.com');
	if (Url.protocol !== 'https:' || Url.username || Url.password || Url.search || Url.hash || Url.pathname !== '/' || !(Url.hostname === 'api.cognitive.microsofttranslator.com' || Url.hostname.endsWith('.cognitiveservices.azure.com'))) throw new Error('endpoint');
	return [`${Url.origin}/*`];
}
