import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DescribeSubtitleTracks, SelectSubtitleTracks} from '../extension/lib/download-options-selection.js';

test('subtitle choices use opaque identities and select only requested sources', async () => {
 const tracks = [{language:'en',label:'English',url:'https://example.test/caption?secret=token'}, {language:'fr',label:'French',url:'https://example.test/fr'}];
 const descriptions = await DescribeSubtitleTracks(tracks);
 assert.equal(JSON.stringify(descriptions).includes('secret'), false);
 assert.deepEqual(await SelectSubtitleTracks(tracks, [descriptions[1].id]), [tracks[1]]);
 assert.deepEqual(await SelectSubtitleTracks(tracks, []), []);
});

test('translation does not reselect a target-language track explicitly unchecked by the user', async () => {
 const tracks = [{language:'en',url:'https://example.test/en'}, {language:'ko',url:'https://example.test/ko'}];
 const choices = await DescribeSubtitleTracks(tracks);
 assert.deepEqual(await SelectSubtitleTracks(tracks, [choices[0].id], {enabled:true,targetLanguage:'ko'}), [tracks[0]]);
});

test('stale selected track identities fail instead of silently omitting subtitles',async()=>{
 const tracks=[{language:'en',url:'https://example.test/current.vtt'}];
 await assert.rejects(SelectSubtitleTracks(tracks,['0'.repeat(64)]),/subtitle_invalid/);
});
