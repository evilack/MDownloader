# macOS common helper

Updated 2026-11-10: body version 9 accepts generic bounded package manifests. Shared validation and stale cleanup are tested in Node; actual macOS JXA/Foundation, Installer and inference remain unverified on this Windows host. See the [current verification record](../../docs/command-only-helper-verification-2026-11-10.md). The 2026-11-09 implementation was originally source-only.

## User flow

The initial MDownloader-Common-Setup.pkg installs a lightweight shell/JXA helper and registers it for the current user in Chrome and Edge. It does not embed speech workflow sources or download Python, speech engines or models at this step. JXA/Foundation and shell execution use macOS-supplied tools.

After setup, Install captions sends the extension's current package through installCaptions. The body validates declared relative files and hashes and executes the stable bootstrap.sh entrypoint. Internal modules may be added or split without changing the body. The extension owns workflow and package update policy, polls installation status, and requires an actual executor connection before completion. No additional caption PKG/CMD is opened.

New installations have no models and no selected model. Models are downloaded only from the explicit Options model-download action. Existing caption models and configuration are preserved by helper updates.

## Files and protocol

- host.sh launches the macOS JXA runtime, retaining native stdin/stdout.
- host.js implements one bounded, length-prefixed JSON request/reply per process, validates registered origins, and handles ping, installCaptions, captionSetupStatus and a fixed uninstall request. Local installer/worker utility modes are not exposed to browser requests.
- install.sh runs for the signed-in user and invokes the packaged host's atomic installation transaction. Root PKG postinstall delegates to that user. Existing registered origins are retained; foreign registrations are rejected.
- worker.sh invokes the validated transferred bootstrap through a launchd job. The job plist lives in the helper's private folder, not LaunchAgents; no login-time caption installation is configured. launchd owns its process group (AbandonProcessGroup=false).
- The shared native name com.mdownloader.explorer is retained. It advertises captionSetup, captionPackageUpdate and genericPackageManifest. Existing Finder/download-folder behavior does not depend on it.

The helper lives under ~/Library/Application Support/MDownloader/CommonHelper. Caption runtime/model storage remains separate under ~/Library/Application Support/MDownloader/Captions. Symlink paths are rejected. A persistent private lock file uses kernel flock; helper updates, setup start and state changes share that lock. State is atomic and bound to origin/job/PID/start-time. A previous worker cannot overwrite a newer job. Cleanup only removes named installation sources and empty staging folders.

Options → Helper owns install/repair, removal and connection diagnostics. Removal refuses to run during caption setup, checks Chrome/Edge registrations still belong to this helper, and removes only named helper files and its own registrations. Caption engines, models and downloaded files are retained. The private lock inode and its parent directory remain to avoid a concurrent-install lock race. Older helpers without canUninstall must be updated before in-app removal. Diagnosis checks the actual common-helper ping separately from caption engine/converter readiness; a retained caption host does not count as a connected helper.

## Packaging integration

tools/build/build-mac-common-installer.mjs prepares data/mac-common-installer.json from the four OS bridge files. Speech sources travel separately from the extension. Both distribution flavors regenerate the payload during package build. Payload generation is not a macOS installation test.

The browser PKG factory embeds the current extension ID and calls install.sh; it no longer runs the caption engine bootstrap as part of the initial PKG. The old caption-only package factory remains for maintainer compatibility, but Options never uses that download path.
