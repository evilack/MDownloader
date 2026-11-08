import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import Path from 'node:path';

test('first Explorer folder link uses a visible topmost owner attached to Chrome and disposes it', {skip:process.platform!=='win32'},()=>{
 const script=`$ErrorActionPreference='Stop'
. '${Path.resolve('native/explorer/dialog.ps1').replaceAll("'","''")}'
if((Get-ChromeParentWindow @('--parent-window=4294967297')).ToInt64() -ne 4294967297){throw 'truncated parent'}
if((Get-ChromeParentWindow @('--parent-window=bad')) -ne [IntPtr]::Zero){throw 'invalid parent'}
Add-Type -AssemblyName System.Windows.Forms
$Browser=New-Object Windows.Forms.Form
$Picker=New-Object PSObject
$Picker | Add-Member ScriptMethod ShowDialog {param($Owner)
 $script:SeenOwner=$Owner
 if(-not $Owner.Visible -or -not $Owner.TopMost -or $Owner.ShowInTaskbar){throw 'invisible owner'}
 if($Owner.Handle -eq [IntPtr]::Zero){throw 'missing owner handle'}
 return [Windows.Forms.DialogResult]::OK
}
try {
 $Result=Invoke-SavedFolderPicker $Picker $Browser.Handle
 if($Result -ne [Windows.Forms.DialogResult]::OK -or -not $SeenOwner.IsDisposed){throw 'lifetime'}
 Write-Output 'owner-ok'
} finally {$Browser.Dispose()}`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-STA','-Command',script],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/owner-ok/);
});
