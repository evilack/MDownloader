# Product website

This folder is an English/Korean static website. `index.html` is the English entry and `index-ko.html` is Korean. `site-language.js` resolves explicit language choices, saved preference, browser preference, then English. `site-catalog.js` owns dynamic store notices and store-link roles.

Run from the project root:

```powershell
node website/serve.mjs
```

The server prints its loopback URL. `sample/` plays the local MP4 used for detection, preview, capture, and media regression checks. The website and sample are not part of the installable `extension/` folder.

## Product content

Both landing pages describe the current 0.2.43 source implementation (content reviewed 2026-11-10): direct files and supported HLS/DASH/WebRTC, live starting points and partial saves, subtitle embedding/translation, optional local speech captions, and download management. They include manual installation while store links are pending. The development ZIP section describes development/testing, manual installation and manual updates without advertising individual service download capabilities. This wording does not establish store-policy compliance for the package or website.

## Development ZIP

`downloads/MDownloader-development.zip` is the downloadable manual-install source snapshot. Rebuild it after extension changes with `python tools/build/package-website-development.py`; the script does not modify the extension, generate helper bundles, install anything or reload the user's browser. It includes the current extension files, the same Kakao native source directory included by development packaging, third-party notices and bilingual installation instructions. Local state, generated host registrations, caches and logs are excluded. `downloads/development.json` records the version, file count, size and SHA256. Include the ZIP when deploying the static website; its local ignore override permits committing this download asset.

Archive CRC and every included file are verified during generation. This verifies a source snapshot, not a fresh extension build or installation/runtime acceptance. Use the dedicated extension distribution checks before calling any package a verified release. Store packaging remains a separate workflow.

Speech captions use the selected automatic final outputs. Separate live-file selection/export and the provisional transcript pane have been removed from the normal flow. Earlier Windows integration checks exercised automatic embedded output, SRT/VTT sidecars, stop-and-save and cancellation with the then-installed engine/model. See [current verification status](../docs/verification.md) for evidence and limits; these checks do not establish long-running accuracy, every input or macOS acceptance. Screenshot capture versions below remain independent of the current implementation version.

## Interactive extension preview

The landing-page showcase uses `preview/index.html` in two isolated frames for the media list and download manager. The original sample playback image/GIF and screenshot showcase have been removed from both homepages. The preview renders the current extension's actual `CreateCandidateRow`, `CreateJobRow` and `CreateDownloadOptionsDialog` components, styles, icons and English/Korean catalogs. It uses in-memory example data, simulated request responses and no download, native-helper or translation backend. Settings links are intercepted; real files and extension settings are not modified. No media playback is included.

Rebuild after changing the extension UI:

```powershell
node tools/build/build-website-preview.mjs
```

The authoring entry is `tools/dev/homepage-preview.js`. The builder bundles it into `preview/lib/app.js`, copies the required presentation assets and records the extension version and source SHA256s in `preview/source-manifest.json`. Only the preview frame's sizing, example thumbnails and explanatory notes are overridden in `preview/preview.css`; production components retain their own layout, actions, labels and responsive rules. The static output works on ordinary static hosting without serving the extension source tree.

## Retained manual images

`assets/screenshots/en/` and `ko/` retain the earlier sample GIF/still, media list, and download manager assets for manuals and historical capture provenance. `assets/screenshots/catalog.json` records capture date, extension version, and file hash. English screenshots were captured with 0.2.24; Korean screenshots with 0.2.18. They are real captures, not newly verified screenshots of every current feature, and are no longer the homepage preview.

The retained GIF/still files preserve their actual capture ratio. New tool captures stay in `artifacts/` until reviewed and promoted.

## External links

The store URL entries are currently empty, so installation buttons show the existing preparation notice. Set actual store URLs in `site-catalog.js` when issued. Shared support links lead to [Ev-Cabinet](https://evilack.github.io/donate.html).

For tool configuration and verification commands, see [Development](../docs/development.md).
