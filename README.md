# MDownloader

English · [한국어](docs/README.ko.md)

<img src="extension/icons/app-media-128.png" alt="MDownloader" width="80" height="80">

Find video and audio on the current page, save supported streams, and manage downloads in a side panel.

Chrome · Microsoft Edge · Manifest V3 · System language by default · English fallback · 10 interface languages

MDownloader runs in your browser. It can save direct media files, supported clear or AES-encrypted HLS, unencrypted DASH, and supported WebRTC streams without a separate desktop downloader.

[Installation](#installation) · [Downloading media](#downloading-media) · [Live and partial saves](#live-and-partial-saves) · [Settings](#settings) · [Troubleshooting](#troubleshooting)

## Installation

1. Obtain this project folder and keep it in a permanent location.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the project's **`extension` folder**, which contains `manifest.json`.
5. Pin MDownloader from the browser's extension menu if you want quick access.

No build, npm installation, or paid service is required to load the extension. Store installation links have not been configured in the product website.

Distribution packages are generated separately: `node tools/build/package-extension.mjs --flavor development|chrome-store`. Development builds allow Chrome by default; `--block-chrome` is an optional additional build restriction. YouTube extraction is still subject to the browser feasibility gate and is not a completed download feature. The Chrome Store package physically excludes the YouTube provider/vendor and uses a disabled entry. Its fixed source checks also cover generic media, embeds, playback capture, resume, and media requests. This is a permanent package distinction, not a review-time switch. See [development](docs/development.md) and [verification](docs/verification.md).

The development build is the manual/unpacked build; the only other distribution is Chrome Store. Browser-only SABR remains limited by attestation rejection. A subsequent yt-dlp-assisted test received and saved the complete same-video 623-second source in real development Chrome (30,185,697 bytes, H.264/AAC 360p; actual duration 622.689 seconds). Other fresh sessions still returned 403, so product UI remains disabled. See the [yt-dlp comparison](docs/verification.md#yt-dlp-comparison--2026-11-08) for the full-file proof and native-helper boundary.

To update a local copy, finish active downloads first, replace the project files, and reload MDownloader from the browser's extensions page.

## Screenshots

### Detected media

Review detected items, inspect thumbnails, preview supported media, and start a download.

![MDownloader media list](website/assets/screenshots/en/media-list.png)

### Download manager

Track download progress and manage active or completed jobs in the side panel.

![MDownloader download manager](website/assets/screenshots/en/downloads.png)

These are real captured screens. Capture versions are recorded in the [screenshot catalog](website/assets/screenshots/catalog.json); some current controls are described below even when absent from an older capture.

## Features

- Detect video, audio, and supported HLS/DASH sources on the active page.
- Show thumbnails and hover previews where the media and browser permit them.
- Group confirmed HLS variants under one source and offer quality selection.
- Run multiple independent stream downloads and continue them after the source tab closes.
- Receive supported WebRTC streams in the background and save supported live HLS.
- Save a separate partial file while the original download continues.
- Manage progress, speed, pause/resume where supported, cancellation, history, and completed files.
- Customize filenames, download location, interface language, and diagnostics.

Supported interface languages: English, 한국어, 日本語, 简体中文, Español, Português (Brasil), Français, हिन्दी, العربية, Русский.

## Requirements

- Chrome 116 or later, or a compatible current Chromium-based Microsoft Edge with the required extension APIs.
- Access to the page and media server when network detection or stream downloading requires it.
- Enough free storage for temporary segments and the completed output.

## Downloading media

1. Open the page containing the media and start playback.
2. Click the MDownloader icon.
3. Find the item in the media list. Use the thumbnail or hover preview when available.
4. Select **Download**.
5. Open **Download manager** to follow progress and manage the job.

If an item is missing, play the media, seek within it, or refresh the page and try again. Some pages reveal a source only after playback starts.

## Site access

1. Open **Options → Advanced → Network detection permissions**.
2. Choose **Allow all sites**, or enter the page URL under the individual-site form.
3. If the media uses a different server, enter that server URL as well.
4. Allow detection, return to the page, and play the media again.

The browser manages these permissions. You can revoke optional site access from the same options page. Source access can still depend on login state, server rules, or expiring links.

## Choosing stream quality

Normally, **Download** starts the supported HLS rendition with the highest bitrate, or the current available WebRTC server profile.

1. Hold **Shift** while clicking an HLS or WebRTC item's **Download** button.
2. Select a resolution/bitrate from the controls inserted below that item.
3. Confirm the download. Grant access to a separate media server if requested.

HLS controls appear when multiple supported renditions are available. WebRTC lists the profiles actually reported by its supported server, including a single available profile. The extension does not invent resolutions or resize video to imitate server quality.

## Saving WebRTC streams

1. Start playback on a supported page and find the regular media item with the **WebRTC** badge.
2. Click **Download**, or Shift-click to choose an available server quality.
3. Wait until the manager shows received bytes increasing. The independent background receiver can then continue after the source page closes or navigates away.
4. Use **Save received portion**, **Stop and save**, or **Cancel** in the same manager.

Support is limited to the signaling services configured in the project; it does not record every MediaStream on every site. No separate recording tab is required. Valid HLS alternatives can appear alongside WebRTC.

The receiver waits for actual remote video/audio before recording. MP4 is preferred when supported by the browser, with WebM as a fallback. Recording can re-encode media. Connection loss or a stalled stream is shown as interrupted, with a partial file when possible. An intentional **Stop and save** is treated as a normal finish. Closing the browser or reloading/removing the extension ends active receivers; automatic recovery is not implemented.

## Live and partial saves

The active-row buttons are ordered **Cancel → Save received portion → Stop and save** from left to right.

| Action | Result |
|---|---|
| **Cancel** | Stops the selected job and discards its unfinished temporary output. |
| **Save received portion** | Creates a separate partial file and job while the original transfer continues. |
| **Stop and save** | Ends reception and saves the playable portion in the original job. |

**Stop and save** is available for supported HLS, DASH, and WebRTC jobs once a playable portion is ready. HLS/DASH stops assigning new segments, lets requests already in progress finish, and exports only the continuous video/audio portion before the first missing segment. An incomplete finite stream receives a partial-file suffix.

**Save received portion** creates a separate partial file and download record while the original job continues. Partial output has its own cancellation and does not replace the original file.

- **HLS/DASH:** uses completed contiguous segments and the available audio coverage.
- **WebRTC:** freezes data already committed to local storage, without requesting media again or interrupting the receiver.
- **Direct files:** separately reads the reported byte range from the original server, causing additional transfer. The server must support the required access/range behavior, and enough complete packets and metadata must be available.

Partial saving can fail when essential media data is missing or the container/codec cannot be remuxed. Check the partial job's error; the original job remains independent.

## Download manager

Open **Download manager** from the popup to manage active and completed jobs.

| Display | Meaning |
|---|---|
| Received bytes and speed | Two lines inside one rounded box, with the same text size, box size, and colors as the popup. Received bytes are blue; speed is gray. |
| Progress bar | A thin bar below the row. A known total shows progress; an unknown total remains indeterminate. |
| Canceled | Mint text inside a rounded status badge in both the popup and manager. |

- Pause or resume a direct browser download when the browser reports that it supports the action.
- Cancel a selected active job independently of other jobs.
- Use **Show in folder** for a completed browser download.
- Copy a source link or inspect the full filename/address through the row's tooltip where available.
- Delete a record to remove it from the list. The downloaded file stays on disk.
- **Shift-click Delete** to also remove a completed browser-downloaded file when that action is available.
- Section-clear buttons remove the selected section's records, not saved media files.

Hover over an icon button to see its action name. The same controls expose accessible names for keyboard and assistive-technology use.

## Settings

| Setting | Use |
|---|---|
| Display language | Use the system language or select one of ten languages; English is the fallback. |
| Use page title | Combine the current page title with the original filename; ON by default. |
| Include date and time | Append the local download start time to the filename; ON by default. |
| Download location | Set a subfolder under the browser's default download directory, or choose a folder where supported. |
| Show detected media in the side panel | Display the active tab's media above the download list. |
| Debug mode | Open a separate job diagnostics tab. |
| Record download events | Keep a bounded local result log for troubleshooting. |
| Enable detailed debug logging | Show safe stage codes, timings, and counts in the extension console; OFF by default. |

With the default page-title and date/time settings:

| Source | Example output |
|---|---|
| Original filename available | `Page title_original_2026-11-08_15-04-06.mp4` |
| No original filename | `Page title_2026-11-08_15-04-06.mp4` |
| No original filename or page title | `2026-11-08_15-04-06.mp4` |

The name and local start time are fixed when the job is registered. The output uses the actual media extension, including WebM when applicable. The extension does not add `MDownloader-`, `playback`, or generated WebRTC labels to streams without original filenames. Explicit page-title/date-time choices still apply. Partial files receive a separate partial-save suffix.

## Supported media

| Media | Support |
|---|---|
| Direct files | HTTP(S) video/audio files, including MP4, WebM, MOV, MKV, MP3, M4A, WAV, FLAC, and OGG families; saved in their original format. |
| HLS | Supported clear or full-segment AES-encrypted MPEG-TS/fMP4 video and audio, including H.264/AAC and supported fMP4 AV1; remuxed without re-encoding. |
| DASH | Supported static single-period fMP4 representations; remuxed without re-encoding. |
| Live streams | Supported live HLS with complete segment boundaries. |
| WebRTC | Independent background reception for supported signaling streams, recorded to MP4 or WebM; source-page closure does not stop an established receiver. |

HLS encryption supports `AES-128`, `AES-256` (CBC), `AES-256-CTR`, and `AES-256-GCM` when the playlist supplies a normally accessible `identity` key. Key rotation, explicit IVs, and sequence-number IVs are handled automatically. Encrypted HLS needs no additional setting: use the same Download button. Encrypted low-latency playlists use the complete parent segments.

| Limit | HLS/DASH | WebRTC |
|---|---|---|
| Temporary media per job | 16 GiB | 2 GiB |
| Individual media resource | 32 MiB | Bounded recording chunks |
| Segments per job | 5,000 across tracks | Recording chunk and buffer limits apply |

Browser storage quota can impose a lower limit. DRM license systems, sample encryption (`SAMPLE-AES` / `SAMPLE-AES-CTR`), encrypted DASH, live DASH, unknown signaling protocols, unsupported codecs/layouts, delivery that requires redirects, and incomplete low-latency groups are outside the supported path. A denied or invalid encryption key cannot be used. See [Development](docs/development.md) for implementation boundaries.

## Troubleshooting

**Nothing appears in the media list**

Start playback, seek, refresh the page, and check site/media-server permissions. Auxiliary hover previews and advertisements may be excluded from the main list. Detection does not imply that every source can be downloaded.

**A thumbnail or preview fails**

The browser can restrict cross-origin frames, protected sources, or capture APIs. An unavailable preview does not by itself mean the download will fail. Return to the source page and check playback.

**A download fails with a permission or HTTP error**

Check access to both the page and media host, your session, and whether the link has expired. Refresh the source rather than assuming a copied link remains valid elsewhere.

**A partial file cannot be saved**

Wait for more data. Direct-file saving may need additional range reads or tail metadata. Some media cannot be safely packaged from the received portion.

**WebRTC is detected but does not start**

Reload the source page and start playback so the connection observer can see its initial signaling. Check page/media-server access. Unsupported signaling or an unavailable server profile cannot be replaced with a made-up quality.

**You need diagnostic details**

Enable result logging or detailed debug logging in Options, reproduce the issue, then turn it off. Detailed logs exclude source URLs, headers, cookies, tokens, IP addresses, file paths, and raw error messages/stacks. Browser/third-party messages displayed elsewhere can still contain their own text.

## Removing MDownloader

Open the browser's extensions page and remove MDownloader. Downloaded media files are not deleted by removing the extension.

## Development and verification

The browser loads `extension/` directly. Core checks run with Node.js 24:

```powershell
node --test tests/*.test.mjs
node tools/checks/audit-localization.mjs
node tools/build/build-page-policy.mjs --check
node --expose-internals tools/checks/verify-project.mjs
```

See [Development](docs/development.md) for folder responsibilities and tools, and [Verification](docs/verification.md) for what the checks establish and what still requires an installed-browser check.

## Third-party components

Mediabunny is bundled under MPL 2.0. See [Third-party notices](THIRD_PARTY_NOTICES.md) and the included license. A license for MDownloader's original source has not been specified separately.

## Support

[Support development through Ev-Cabinet](https://evilack.github.io/donate.html).
