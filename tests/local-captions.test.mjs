import test from 'node:test';
import assert from 'node:assert/strict';
import {NormalizeCaptionSettings,ResolveCaptionOptions,CaptionOutputName} from '../extension/lib/local-captions-settings.js';

test('automatic recognition is opt in and snapshots per-download overrides',()=>{
 const Saved=NormalizeCaptionSettings({enabled:true,engine:'faster-whisper',model:'small',language:'ko',formats:['srt','vtt']},'win');
 assert.equal(NormalizeCaptionSettings({},'win').enabled,false);
 assert.equal(NormalizeCaptionSettings({},'win').model,'');
 assert.equal(ResolveCaptionOptions(Saved,'off','win').enabled,false);
 assert.equal(ResolveCaptionOptions({...Saved,enabled:false},'on','win').enabled,true);
 const Copy=ResolveCaptionOptions(Saved,'inherit','win');Saved.formats.push('bad');assert.deepEqual(Copy.formats,['srt','vtt']);
});
test('mac uses whisper.cpp and malformed options never reach the host',()=>{
 assert.equal(NormalizeCaptionSettings({engine:'faster-whisper'},'mac').engine,'whisper.cpp');
 for(const Value of [{model:'../../x'},{language:'-evil'},{formats:['invalid']},{engine:'other'}]) assert.throws(()=>NormalizeCaptionSettings(Value,'win',{strict:true}));
 assert.throws(()=>ResolveCaptionOptions({},'bogus','win'));
});
test('generated sidecars retain the video stem and never target the original subtitle name',()=>{
 assert.equal(CaptionOutputName('여름.mp4','srt'),'여름.generated.srt');
 assert.equal(CaptionOutputName('video (1).webm','vtt'),'video (1).generated.vtt');
 assert.throws(()=>CaptionOutputName('../x.mp4','srt'));
});
