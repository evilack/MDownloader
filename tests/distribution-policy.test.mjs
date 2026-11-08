import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CanUseYoutube, BrowserFamily} from '../extension/lib/distribution-policy.js';
import {IdentifyYoutubeUrl, IsYoutubeSource} from '../extension/lib/youtube-source-policy.js';

test('development/manual allow Chrome and Edge; store is unconditional', () => {
 for (const flavor of ['development', 'manual', 'chrome-store']) {
  for (const family of ['chrome', 'edge', 'unknown']) {
   assert.equal(CanUseYoutube({flavor, youtubeEnabled: true, blockedBrowserFamilies: []}, family), flavor !== 'chrome-store');
  }
 }
 assert.equal(CanUseYoutube({flavor: 'manual', youtubeEnabled: true, blockedBrowserFamilies: ['chrome']}, 'chrome'), false);
 assert.equal(CanUseYoutube({flavor: 'manual', youtubeEnabled: true, blockedBrowserFamilies: ['chrome']}, 'edge'), true);
 assert.equal(CanUseYoutube({flavor: 'manual', youtubeEnabled: true, blockedBrowserFamilies: ['chrome']}, 'unknown'), false);
 assert.equal(CanUseYoutube({flavor: 'unrecognized', youtubeEnabled: true}, 'chrome'), false);
});
test('browser detection prefers Edge UA-CH and falls back without conflating Edge with Chrome', () => {
 assert.equal(BrowserFamily({userAgentData: {brands: [{brand: 'Google Chrome'}, {brand: 'Microsoft Edge'}]}}), 'edge');
 assert.equal(BrowserFamily({userAgentData: {brands: [{brand: 'Google Chrome'}]}}), 'chrome');
 assert.equal(BrowserFamily({userAgent: 'Chrome/144 Edg/144'}), 'edge');
 assert.equal(BrowserFamily({userAgent: 'Chrome/144'}), 'chrome');
 assert.equal(BrowserFamily({}), 'unknown');
});
test('YouTube identity accepts watch, shorts, short and privacy embeds with strict IDs and host boundaries', () => {
 const videoId = 'aqz-KE-bpKQ';
 for (const url of [`https://www.youtube.com/watch?v=${videoId}`, `https://youtu.be/${videoId}?t=1`, `https://m.youtube.com/shorts/${videoId}`, `https://www.youtube-nocookie.com/embed/${videoId}`]) {
  assert.deepEqual(IdentifyYoutubeUrl(url), {videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`});
 }
 for (const url of ['https://youtube.com.example.org/watch?v=aqz-KE-bpKQ', 'https://notyoutube.com/watch?v=aqz-KE-bpKQ', 'javascript:alert(1)', 'https://youtube.com/watch?v=short', 'https://example.org/?url=https://youtu.be/aqz-KE-bpKQ']) assert.equal(IdentifyYoutubeUrl(url), null);
});
test('source policy uses actual page/frame/media rather than spoofable provider labels', () => {
 for (const source of [{pageUrl: 'https://youtube.com/watch?v=aqz-KE-bpKQ', mediaUrl: 'https://cdn.test/file.mp4'}, {frameUrl: 'https://youtube-nocookie.com/embed/aqz-KE-bpKQ'}, {mediaUrl: 'https://rr1.googlevideo.com/videoplayback'}, {mediaUrl: 'https://googlevideo.com/file.mpd', provider: 'other'}]) assert.equal(IsYoutubeSource(source), true);
 for (const url of ['https://notyoutube.com/file.mp4', 'https://googlevideo.com.example.org/file.m3u8', 'https://storage.googleapis.com/file.mp4']) assert.equal(IsYoutubeSource({mediaUrl: url, provider: 'youtube'}), false);
});
