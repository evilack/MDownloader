import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import Path from'node:path';
import{AssertExtensionFilenames}from'../tools/lib/extension-files.mjs';
test('extension loading guard allows locale resources and rejects reserved probe filenames',async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-extension-files-'));t.after(async()=>{assert.ok(Path.resolve(root).startsWith(Path.resolve(tmpdir())+Path.sep));await rm(root,{recursive:true,force:true});});
 await mkdir(Path.join(root,'_locales/en'),{recursive:true});await writeFile(Path.join(root,'_locales/en/messages.json'),'{}');await writeFile(Path.join(root,'background.js'),'');await AssertExtensionFilenames(root);
 await writeFile(Path.join(root,'_explorer_actual_reveal.html'),'');await assert.rejects(AssertExtensionFilenames(root),/reserved.*_explorer_actual_reveal\.html/i);
});
