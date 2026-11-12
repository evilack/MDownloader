# MDownloader

English · [한국어](docs/README.ko.md)

<img src="extension/icons/app-media-128.png" alt="MDownloader" width="80" height="80">

Find video and audio on a web page, save supported streams, and manage your downloads in a side panel.

Chrome / Microsoft Edge · Manifest V3 · 10 interface languages

MDownloader handles direct media files, supported HLS and unencrypted DASH, and WebRTC streams from supported signaling services. Ordinary downloading runs inside the browser. An optional local helper adds speech recognition and Windows file-manager integration.

## Download and installation

The current installation method is **Load unpacked**. Official Chrome Web Store and Edge Add-ons links have not been configured. Use the supplied project source folder or the [development ZIP](website/downloads/MDownloader-development.zip) generated from this project; keep the extracted files in a permanent location.

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the **extension** folder containing `manifest.json`.
4. Pin MDownloader from the browser's extensions menu.

No Node.js installation or build is needed to use the supplied extension. Finish all downloads, conversions and speech jobs before replacing files and reloading an update. Removing and reinstalling the extension can discard its settings and history.

The source/development and Edge store builds include the YouTube provider. The Chrome store build excludes it while preserving the site policy notice and download restrictions. [Distribution details](docs/development.md#build-and-distribution) document the three individual build commands and `build:all`.

## Screenshots

Review detected media in the popup, then follow active and completed downloads in the manager.

![Detected media](website/assets/screenshots/en/media-list.png)
![Download manager](website/assets/screenshots/en/downloads.png)

These are real earlier captures, recorded in the [screenshot catalog](website/assets/screenshots/catalog.json). They do not show every control in the current version.

## Features and requirements

- Detect direct video/audio and supported HLS/DASH sources after playback starts.
- Preview supported media and select an available quality.
- Manage independent downloads, supported pause/resume, cancellation, history and saved files.
- Save a partial file while reception continues, or stop reception and save the playable portion.
- Include original subtitles, optionally translate selected subtitles, or generate captions locally from audio.
- Set the download location, filename options, display language and diagnostic logging.

Use **Chrome 116+** or a compatible Chromium-based Edge with the required extension APIs, with enough free disk space and permission to access both the page and its media servers. Local speech recognition supports Windows and macOS; available engines differ by platform. It can use substantial memory. Actual macOS helper/recognition operation still requires platform validation.

Interface languages: English, 한국어, 日本語, 简体中文, Español, Português (Brasil), Français, हिन्दी, العربية, Русский. The browser language is selected by default, with English as fallback.

## Quick start

1. Open a page and **start playing** its video or audio.
2. Click the MDownloader icon and find the item in the media list.
3. Click **Download** for the best supported quality. **Shift-click Download** to choose quality, subtitles, translation or per-download speech settings.
4. Grant the requested page/media-server permissions. You can also manage them under **Settings → Site permissions**.
5. Open **Download manager** and wait for completion.
6. Click the completed item's **folder** icon to reveal the file. **Shift-click** that icon to play it in a browser tab.

If the list is empty, check site permissions, play or seek the media, then refresh the page. Detection alone does not guarantee that a protected or unsupported source can be saved.

## Optional helper and speech captions

Ordinary browser downloads do not need the helper. To generate captions, or use Windows Explorer with files saved directly to a picked folder:

1. Open **Settings → Helper** and select **Install helper** or the displayed update action.
2. Complete any browser/OS installer confirmation. The extension checks the actual connection before reporting readiness.
3. For speech captions, open **Settings → Speech recognition**, download a model explicitly, and select an engine, model, language and output options. Windows offers faster-whisper and whisper.cpp; macOS offers whisper.cpp.
4. Choose embedded MP4 captions, SRT/VTT sidecars, or their supported combination. Enable the default or override it for one download through Shift-click Download.

Speech captions are generated from audio locally. Models are not downloaded automatically. The download row shows waiting, model loading, recognition and output status. Selected outputs are saved automatically when reception and caption processing finish; no separate live-caption file picker is required. Timestamp adjustments appear as warnings; they do not by themselves fail the download.

A completed video can remain usable even if subtitle generation or translation fails. Read the row's separate caption status and error code. [Detailed caption behavior](docs/media-guide.md#subtitles-and-speech-captions) and [helper maintenance](native/captions/README.md) describe limits and recovery boundaries.

## Live downloads and partial files

Keep the browser running and the computer awake. Supported live HLS offers **Beginning** or **Current** starting points in Download options. Supported WebRTC reception becomes independent after actual remote media arrives; closing the source page then does not stop the receiver.

| Action | Result |
|---|---|
| Cancel | Stops this job and discards its unfinished temporary output. |
| Save received portion | Creates a separate partial file and record; the original reception continues. |
| Stop and save | Ends reception and saves the playable received portion in the original job. |

Availability depends on the source and on enough complete media being received. Direct-file partial saves can make additional network requests. Browser shutdown, extension reload and computer sleep interrupt active work; automatic restart recovery is not supported.

## Settings, files and removal

**Settings → Download and filename** controls the save location and optional page-title/date-time naming. Pick a folder where supported, or use a subfolder below the browser's normal download directory. New filenames start with the source page's domain. For example: `example_com_Page_title_original_2026-11-11_15-04-06.mp4`.

Settings and download records live in the extension's browser profile; selected-folder handles use IndexedDB. Translation credentials are also held in extension-local storage. Downloaded files remain in the chosen destination. [Storage and helper locations](docs/media-guide.md#storage-and-removal) list the separate native directories.

Deleting a download **record** leaves its file on disk. Shift-click Delete can also remove a completed browser-managed file when supported. Completion and scheduled-start notifications are separate settings and are off by default; banners and sound follow Chrome/OS preferences.

To remove MDownloader, use the browser's extensions page. Saved media stays on disk. Remove an optional helper from **Settings → Helper** before removing the extension, or use its OS uninstall entry where available. Removing the common helper retains separately installed speech engines/models; see [storage and removal](docs/media-guide.md#storage-and-removal) before deleting those separately.

## Troubleshooting

| Symptom | What to check |
|---|---|
| No media found | Start playback; allow the page and media hosts; refresh or seek. |
| HTTP or permission error | Check login, site access and expiring links; rescan the original page. |
| Preview unavailable | Cross-origin/protected players can prevent previews while downloads still work. |
| Partial save unavailable | Wait for complete media packets; some formats need tail metadata or cannot be remuxed safely. |
| WebRTC does not start | Reload and play the page so initial signaling is observed; only configured services are supported. |
| Caption/helper error | Run Settings → Helper → Diagnostics, check the selected model and read the caption error code. |

DRM-protected sources, sample-encrypted HLS, encrypted/live DASH, unknown signaling protocols and unsupported codecs/layouts are outside the supported path. [Media support and limits](docs/media-guide.md) gives the precise supported cases, including development-build YouTube.

For diagnostics, enable event or detailed logging under **Settings → Diagnostics and logs**, reproduce once, then disable it. Issue reports send the shown page URL, selected issue types and entered description through FormSubmit only when you confirm submission. Review the contents before sending.

## Development

Maintainers use Node.js 24. Run `node --test tests/*.test.mjs` and `node --expose-internals tools/checks/verify-project.mjs` from the project root. [Development](docs/development.md) covers architecture, builds and packaging; [verification status](docs/verification.md) distinguishes automated checks, existing failures and actual browser validation.

## License and support

A separate license for MDownloader's original source has not been specified. Bundled libraries and their notices retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).

[Support development through Ev-Cabinet](https://evilack.github.io/donate.html).
