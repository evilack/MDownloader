import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';

const Module = await import('../extension/lib/translation-providers.js').catch(() => ({}));
const Response = Data => new globalThis.Response(JSON.stringify(Data), {status:200, headers:{'content-type':'application/json'}});

Test('Google translation sends the key in a header and preserves cue ordering', async () =>
{
	Assert.equal(typeof Module.TranslateWithProvider, 'function');
	let Request;
	const Result = await Module.TranslateWithProvider('google', {key:'private-key', model:'nmt'}, ['Hello', 'Goodbye'], {source:'en', target:'ko'}, async (Url, Init) =>
	{
		Request = {Url:String(Url), Init};
		return Response({data:{translations:[{translatedText:'안녕'}, {translatedText:'잘 가'}]}});
	});
	Assert.deepEqual(Result, ['안녕', '잘 가']);
	Assert.equal(Request.Init.headers['X-Goog-Api-Key'], 'private-key');
	Assert.equal(Request.Url.includes('private-key'), false);
	Assert.deepEqual(JSON.parse(Request.Init.body).q, ['Hello', 'Goodbye']);
});

Test('DeepSeek discovery returns provider model metadata and supported effort levels', async () =>
{
	Assert.equal(typeof Module.DiscoverModels, 'function');
	const Models = await Module.DiscoverModels('deepseek', {key:'private'}, async () => Response({data:[{id:'deepseek-flash', name:'Flash', effort:{supported_levels:['low','high','max']}, input_modalities:['text'], output_modalities:['text']}]}));
	Assert.equal(Models[0].id, 'deepseek-flash');
	Assert.deepEqual(Models[0].efforts, ['none','low','high','max']);
});

Test('Azure refuses arbitrary hosts before sending credentials', async () =>
{
	Assert.equal(typeof Module.TranslateWithProvider, 'function');
	let Called = false;
	await Assert.rejects(Module.TranslateWithProvider('azure', {key:'private', endpoint:'https://untrusted.example'}, ['Hello'], {source:'en',target:'ko'}, async () => {Called = true;}));
	Assert.equal(Called, false);
});

Test('OpenAI incomplete responses are errors rather than partial subtitles', async () =>
{
	Assert.equal(typeof Module.TranslateWithProvider, 'function');
	await Assert.rejects(Module.TranslateWithProvider('openai', {key:'private',model:'gpt-6.1-sol',effort:'low'}, ['Hello'], {source:'en',target:'ko'}, async () => Response({status:'incomplete', output:[]})), /translation/i);
});
