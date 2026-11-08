# Windows Explorer bridge

This optional bridge is solely for revealing files written directly through a picked folder handle. It does not extract, transfer, transcode, or download media. It uses Windows PowerShell already supplied with Windows; no Python/FFmpeg/runtime installation. Ordinary browser downloads continue to use Chrome's native `downloads.show` without this bridge.

Registration changes the current user's Chrome NativeMessagingHosts registry and copies the bridge to LocalAppData\MDownloader\ExplorerBridge. Run only after the user explicitly approves:

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\native\explorer\install.ps1 -ExtensionId <actual-unpacked-extension-id>`

On the first reveal for a previously selected folder, choose that saved folder once in the Windows dialog. The bridge checks its leaf name, saved filename, file size, and bounded first/last128KiB fingerprint against the browser-granted file before remembering the binding. Later clicks directly launch SystemRoot\explorer.exe with `/select` on that file. It accepts no client-supplied absolute path, executable, or command. The native messaging manifest restricts callers to explicit extension IDs. Bindings are scoped by extension origin and directory key; they contain local folder paths and remain on this computer.

`uninstall.ps1` removes only this bridge's own registry entry; it preserves files/bindings for review. The unrelated Kakao helper is not modified.

Automated tests use `-TestMode` with a temporary directory and do not show an OS picker or launch Explorer. This proves framing/validation/binding/fingerprint behavior, not an installed Chrome-to-host or observed Explorer window. Native registration and actual Explorer acceptance stay pending until approved and tested. First-time folder linking requires a user gesture and manual folder selection; it is not silently inferred from a handle.

2026-11-09 local validation: user explicitly approved registration for the actual manual extension ID. The installer ran under HKCU and real Chrome157 returned the host protocol rejection for a deliberately invalid action, proving launcher/framing without opening any folder chooser or Explorer. The production default-path regression in Windows PowerShell5.1 was covered and fixed by resolving defaults after parameter binding. This registration result is local to the approved computer.

2026-11-09 repair: the approved registration was refreshed for the actual development extension. Real Chrome's completed-row normal click exercised the registered host and a real Explorer window was observed at an owned, prelinked test folder through Shell.Application. Shift-click still decoded the saved media in Chrome. No desktop automation, confirmation popup, substitute folder page or OS picker selection was used. This is a fixture-folder acceptance, not observation of the user's current saved file.

The extension now uses a native port so a first folder chooser can keep its service worker alive. File fingerprint reads happen outside the connection-error handler; a file read failure no longer falsely reports that the helper is unregistered. `ping` validates the connection without opening OS UI. The first association chooser uses Chrome's parent HWND with a topmost owner so it cannot disappear behind Chrome. Once associated, normal clicks directly reveal the file. Installing/updating preserves existing folder bindings. User explicitly rejected an additional connection-confirmation popup, so none was added.
