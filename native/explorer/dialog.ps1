function Get-ChromeParentWindow([string[]]$Arguments) {
    foreach($Argument in $Arguments){
        if($Argument -cmatch '^--parent-window=([0-9]+)$'){
            [long]$Handle=0
            if([long]::TryParse($Matches[1],[ref]$Handle) -and $Handle -gt 0){return [IntPtr]::new($Handle)}
        }
    }
    return [IntPtr]::Zero
}

function Invoke-SavedFolderPicker($Picker,[IntPtr]$ParentHandle) {
    Add-Type -AssemblyName System.Windows.Forms
    if(-not ('MDownloader.ExplorerWindowOwner' -as [type])){
        Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Windows.Forms;
namespace MDownloader {
    public sealed class ExplorerWindowOwner : IWin32Window {
        public IntPtr Handle {get; private set;}
        public ExplorerWindowOwner(IntPtr handle) {Handle=handle;}
    }
}
'@
    }
    # Native messaging starts without a visible console. An unowned modal chooser
    # can remain behind Chrome. Use Chrome's HWND and an invisible topmost owner.
    $Owner=New-Object Windows.Forms.Form
    $Owner.ShowInTaskbar=$false
    $Owner.TopMost=$true
    $Owner.Opacity=0
    $Owner.StartPosition=[Windows.Forms.FormStartPosition]::CenterScreen
    $Owner.Size=New-Object Drawing.Size(1,1)
    try {
        if($ParentHandle -ne [IntPtr]::Zero){$Owner.Show([MDownloader.ExplorerWindowOwner]::new($ParentHandle))}
        else {$Owner.Show()}
        [void]$Owner.Activate()
        return $Picker.ShowDialog($Owner)
    } finally {$Owner.Dispose()}
}
