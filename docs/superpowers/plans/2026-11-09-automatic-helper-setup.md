# Automatic helper setup

User-approved behavior: one install-button click requests installer download and execution, then registration/connection checks happen automatically. No additional extension Run/Continue buttons; OS/browser confirmations remain OS/browser UI. Apply to the existing Explorer helper and new caption helper. Models are initially absent and downloaded only from settings.

Implementation: capture the trusted install click, prefetch small packaged installer payloads before the click, immediately create the ID-bound installer and download it, and call downloads.open as soon as complete in the same gesture. Automatically poll actual native connection, never treat an open API response as installation success. On real browser download/execution rejection show the actual failure and preserve recovery access without silently reverting to a staged-click normal flow.

Caption setup uses a checksum-pinned portable uv bootstrap, a private managed runtime/environment under the helper directory, pinned binary dependencies, and automatic native registration. No system Python, PATH changes, manual ID or terminal entry. whisper.cpp uses a packaged Python binding worker when a preconfigured CLI is absent; this removes manual CLI/compiler setup. Windows and macOS bootstrap assets are included. macOS runtime execution is explicitly unverified in this Windows session.

- [x] Tests: same-click ordering/download/open/connection, canceled and failed setup, fresh no-model installation, dependency-free Windows bootstrap, native framing and cpp binding.
- [x] Caption payload build, platform bootstrap scripts, pin manifest, private-runtime install mode.
- [x] Shared one-click controller and caption settings button; update Explorer controller and readable guide.
- [x] Actual Chrome trusted-click request probe, isolated Windows install and engine probes; targeted regression, package/checks, review.
- [ ] Full Chrome-to-OS installer execution/registration confirmation and macOS Installer execution. These are explicitly unverified; do not equate open API success with installed state.

Baseline actual probe: Chrome157 trusted install click retained activation through a small download and downloads.open returned success. The OS did not execute the harmless marker in headless mode, so this is evidence of one-click request sequencing only, not completed installation. Preserve that distinction.
