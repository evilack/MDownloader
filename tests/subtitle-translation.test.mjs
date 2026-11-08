import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';

const Module = await import('../extension/lib/subtitle-translation.js').catch(() => ({}));
const Original = {language:'en', label:'English', content:'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst line.\n\n00:00:02.100 --> 00:00:03.000\nSecond line.\n'};

Test('retains existing target-language captions without making a translation request', async () =>
{
	Assert.equal(typeof Module.TranslateMissingSubtitle, 'function');
	let Calls = 0;
	const Target = {language:'ko-KR', label:'Korean', content:Original.content};
	const Result = await Module.TranslateMissingSubtitle([Original, Target], {enabled:true, targetLanguage:'ko'}, async () => { Calls++; });
	Assert.deepEqual(Result, [Original, Target]);
	Assert.equal(Calls, 0);
});

Test('adds a translated timed track while preserving the original and cue order', async () =>
{
	Assert.equal(typeof Module.TranslateMissingSubtitle, 'function');
	const Result = await Module.TranslateMissingSubtitle([Original], {enabled:true, targetLanguage:'ko'}, async Cues =>
	{
		Assert.deepEqual(Cues, ['First line.', 'Second line.']);
		return ['첫째.', '둘째.'];
	});
	Assert.equal(Result[0], Original);
	Assert.equal(Result[1].language, 'ko');
	Assert.match(Result[1].content, /00:00:01\.000 --> 00:00:02\.000\n첫째\./);
	Assert.match(Result[1].content, /00:00:02\.100 --> 00:00:03\.000\n둘째\./);
});

Test('rejects a partial response instead of misaligning translated cues', async () =>
{
	Assert.equal(typeof Module.TranslateMissingSubtitle, 'function');
	await Assert.rejects(Module.TranslateMissingSubtitle([Original], {enabled:true, targetLanguage:'ko'}, async () => ['하나']), /translation/i);
});
