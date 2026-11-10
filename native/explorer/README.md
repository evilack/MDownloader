# Windows common helper

The common helper provides Windows picked-folder reveal and bounded execution of an extension-delivered feature setup package. Its historical native name `com.mdownloader.explorer`, installation identity, registered origins and folder links are retained. Ordinary browser downloads use Chrome's downloads API directly.

## Installation and use

Use **Settings → Helper → Install helper** for the registered helper and required speech feature setup. Windows folder selection can also offer this setup when the helper is absent. The extension downloads `MDownloader-Windows-Setup.cmd` and requests execution from the install click. Browser/Windows security confirmation may still be required. A download/open reply alone does not mean installation succeeded: an actual native ping is required before the dialog closes and the waiting folder selection continues.

Cancel keeps the existing folder and prevents a late installer download from executing. Open downloads/Show installer are recovery controls after an error. Download protection remains enabled. Current-user installation uses Windows PowerShell and does not need a system Python installation. Speech runtime, engines and explicitly selected models are separate.

For picked-folder reveal, choose the saved folder once in the native dialog. The helper validates the folder leaf, saved filename, size and bounded first/last 128 KiB fingerprints before recording a per-origin binding. Later reveals launch the fixed system Explorer executable with the validated file. No caller-supplied absolute path, executable or arbitrary shell command is accepted.

## Contract and ownership

Current body 9/revision 9.1 uses the genericPackageManifest capability. The extension owns feature selection/version/update policy and caption workflow. `installCaptions` validates declared safe paths, hashes and resource limits, then runs the fixed bootstrap entry. `captionSetupStatus` reports the owned process. Internal feature modules can be added without updating this body; body 8 needs a one-time migration because it used a fixed filename list.

The manifest accepts up to 128 safe nested relative files and one MiB decoded source (two MiB JSON frame). Traversal, junctions, device paths, path collisions and tampering are rejected. A live setup does not expire due to age. Origin/job/PID/start identity, the shared mutex, atomic state and Windows process-job ownership prevent stale observers and leaked bootstrap descendants. Cancellation/removal must confirm actual process exit. Cleanup removes declared owned sources, preserving unknown files, models, media and other extensions' work.

Installation is under `%LOCALAPPDATA%/MDownloader/ExplorerBridge`. Chrome and Edge registrations authorize explicit extension IDs. A Windows Installed apps entry named **MDownloader Helper** launches the same uninstaller.

## Removal

Use Settings → Helper or Windows Installed apps. Removal refuses active setup, checks exact owned paths/registrations, removes helper files and folder bindings, and leaves unknown files and downloaded media. Separately installed caption engines/models and their native host remain. A random installation-identity receipt plus confirmed host absence is required before the extension resets the affected folder preferences; missing connectivity alone is insufficient. Saved history/file handles remain available for supported playback. [Data locations](../../docs/media-guide.md#storage-and-removal) distinguish retained data.

The native launcher acknowledges scheduling, then a detached worker waits for that host to exit before cleanup. Startup/settings focus can reconcile an interrupted receipt consumption. Browser profile databases are never edited. Kakao registration is independent.

## Maintenance

Generate source-install caches with `node tools/build/build-explorer-installer.mjs`; distribution packaging creates its own payloads. Registration copies verified files and changes current-user Chrome/Edge registry keys:

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./native/explorer/install.ps1 -ExtensionId <actual-extension-id>`

The installed uninstaller is `%LOCALAPPDATA%/MDownloader/ExplorerBridge/uninstall.ps1`; use its normal confirmation. Scripted no-confirmation switches are for separately authorized verification only.

Tests exercise framing, validation, dynamic package modules, locking, process lifetime, binding, lifecycle and fingerprint contracts using isolated directories/TestMode. Real initial installer execution, native dialogs, Explorer behavior and installed-engine calls require separate checks. Do not run installation/removal probes as ordinary cleanup tests. [Current verification status](../../docs/verification.md) distinguishes those stages.
