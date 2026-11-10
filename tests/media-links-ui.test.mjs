import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Media from '../extension/lib/media.js';
test('WebRTC copy shares its real page while URL based media keep the actual media link',()=>{
 assert.equal(typeof Media.CandidateCopyUrl,'function');
 assert.equal(Media.CandidateCopyUrl({format:'WEBRTC',url:'webrtc:private-track',page:'https://example.test/live'}),'https://example.test/live');
 assert.equal(Media.CandidateCopyUrl({format:'M3U8',url:'https://cdn.test/index.m3u8',page:'https://example.test/live'}),'https://cdn.test/index.m3u8');
});
