import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const Module=await import('../extension/lib/caption-execution.js').catch(()=>({}));
test('caption workflow is implemented by the extension execution manager',()=>{
 assert.equal(typeof Module.CreateCaptionExecution,'function','extension must own the workflow');
});
test('native host rejects application workflow verbs instead of owning caption jobs',async()=>{
 const Source=await readFile(new URL('../native/captions/host.py',import.meta.url),'utf8');
 assert.doesNotMatch(Source,/def (start|schedule_window|concurrent_action|output_operation)\(/);
});
test('common helpers accept package modules without a hardcoded feature file count',async()=>{
 const Windows=await readFile(new URL('../native/explorer/common-setup.ps1',import.meta.url),'utf8');
 const Mac=await readFile(new URL('../native/common-macos/host.js',import.meta.url),'utf8');
 assert.doesNotMatch(Windows,/\$CaptionSetupNames=@\(/);
 assert.doesNotMatch(Mac,/var SourceNames=\[/);
});
