# Media support and file management

[English quick start](../README.md) · [한국어 빠른 시작](README.ko.md)

This guide keeps the detailed behavior shared by both manuals. Support depends on the actual media, browser codecs, server access and available storage; a recognized URL is not a promise of a successful download.

## Formats and limits

| Input | Supported path |
|---|---|
| Direct HTTP(S) media | MP4, WebM, MOV, MKV, MP3, M4A, WAV, FLAC and OGG families, preserving the original bytes unless subtitles require remuxing. |
| HLS | Compatible MPEG-TS/fMP4 video/audio, including H.264/AAC and supported fMP4 AV1; packet-copy remux without re-encoding. |
| Encrypted HLS | Whole-segment AES-128, AES-256 CBC, AES-256-CTR or AES-256-GCM with accessible identity keys, rotation and explicit/sequence-number IVs. Use the normal Download action. |
| DASH | Unencrypted, static, single-period fMP4 representations. |
| Live HLS | Complete segments; Beginning uses available history, Current starts near the live edge and continues new segments. It cannot recover expired history. |
| WebRTC | Only configured signaling services, through an independent background receiver; MP4 where supported, WebM fallback. Recording can re-encode. |

Encrypted low-latency HLS uses complete parent segments. BIGO's supported segment protection is validated per segment; it is not a general encrypted-player bypass. Observations preserve the exact source document, resource identity and authorized request context. TVMON/NicoNico-style request context is not interchangeable across pages or credentials. Site-specific detectors such as Naver Clip, Bilibili, CHZZK and Meta reels improve discovery within their validated layouts; they do not grant access to inaccessible content.

| Resource | HLS/DASH | WebRTC |
|---|---|---|
| Temporary media per job | 16 GiB | 2 GiB |
| One media resource | 32 MiB | Bounded recording chunks |
| Segments per job | 5,000 across tracks | Chunk/buffer bounds apply |

Browser storage quota can be lower. DRM license systems, SAMPLE-AES/SAMPLE-AES-CTR, encrypted or live DASH, unknown signaling, unsupported codecs/layouts, redirect-dependent delivery and incomplete low-latency groups are outside this path. Invalid/denied keys are rejected. Initialization-only MP4s are not independently downloadable videos.

## Source access and partial saves

Allow both the original page and relevant media hosts under Settings → Site permissions. Some requests require the current login or exact page context. Refresh/rescan an expired source; a copied address may not work outside its session. No fabricated quality or alternate signed URL is used to replace an unavailable one.

Pause/resume applies to browser-managed direct downloads when the browser supports it. HLS/DASH and established WebRTC jobs can continue independently of the source tab. Closing the browser, reloading/removing the extension or suspending the computer ends active work. Active speech jobs from a previous browser session are canceled on restart; there is no automatic restart-recovery feature.

Save received portion creates an independent file/job without replacing or canceling its parent. HLS/DASH uses completed contiguous segments with the required audio coverage. WebRTC freezes committed local data. Direct-file snapshots make additional bounded range reads from the source, which needs suitable access/range support and usable container metadata. A partial failure does not cancel the original transfer.

Stop and save stops assigning new segments, allows a bounded drain of in-flight input, and exports only the continuous playable prefix before a missing segment. Incomplete finite streams receive a partial suffix. Cancel discards unfinished temporary output. A source disconnect/stall is an interruption; intentional Stop and save is a normal finish.

## Subtitles and speech captions

Quick downloads include detected subtitle languages by default. Shift-click Download to choose tracks, clear selections or search a large track list. Standard media track elements, readable text tracks, supported source-owned player/JSON declarations and HLS/DASH renditions feed the shared discovery pipeline. Page-owned captions are fetched before an independent transfer outlives its source tab.

Supported external subtitles: WebVTT, SRT, TTML, finite segmented HLS WebVTT, and static standalone/segmented DASH text. Selected languages become selectable MP4 tx3g/mov_text tracks; advanced layout/styling becomes plain text. AV packets are copied when compatible. Partial exports retain available caption tracks; a selected language starting after the cut can have an empty selectable track.

Unsupported cases include encrypted/fragmented-MP4 subtitle renditions, live/discontinuous HLS captions, arbitrary private/obfuscated configuration and remux paths whose existing non-AV tracks cannot safely be retained. Embedded captions remain intact on the ordinary unchanged-byte direct-download path. WebRTC captions need a usable normal-speed source clock aligned to the independent recorder.

Configure a real translation provider and credentials in Settings → Subtitles and translation before selecting translation. Available providers are DeepL, Google, Azure, Gemini, DeepSeek, OpenAI and Kakao; accounts/quotas and provider access are separate from the extension. A selected original already matching the target language avoids a redundant translation. Original tracks remain when translation fails. The optional [PotPlayer credential importer](../native/kakao/README.md) is separate from the common helper.

Local speech recognition is optional. Install/diagnose under Settings → Helper; select/download the desired model under Speech recognition. Recognition models and language/backend choices belong to the extension. Windows supports faster-whisper/whisper.cpp; macOS supports whisper.cpp. Selecting None disables recognition. Per-download custom settings are snapshotted and do not rewrite defaults or other jobs.

Speech outputs can be embedded in the final MP4 and/or saved as SRT/VTT. Outputs are automatic after reception and processing; there is no standalone live-file picker or interim transcript pane. The row distinguishes waiting, loading-model, recognizing, translating/muxing and saving. There can be a wait before the engine starts. Long input or larger models can use substantial RAM and disk.

Actual PCM clock gaps/corruption, decoder failures and invalid inference results remain errors. Subtitle display-time overlap/reversal is corrected in extension code with a warning count, preserving selected text and original timing provenance. A timing warning alone does not cause failure or re-recognition. If the separate confirmed audio/window-boundary path cannot be decoded reliably, existing extension policy can process the same owned final AV file before output; it does not fetch unrelated media or reinstall the common helper.

Subtitle status is separate from video transfer status. Acquisition errors can retain successful originals. Ordinary original-subtitle mux failures can save the raw AV with a subtitle error. Explicitly requested translation, generated-caption preparation or their mux failure can block final output and enter the output-retry/error path; the current implementation does not always publish an AV-only file after those failures. Actual AV/save errors fail the download. Check the caption status and safe error code. A canceled job must not become complete from a late response. A retry can need the still-existing owned source/model; it does not restore a historical canceled download automatically.

## Development-build YouTube

The source/development build uses supported public VOD, ongoing live and upcoming broadcasts through the normal list/options/manager. Store packages physically omit the provider/vendor and enforce source restrictions; changing stored settings cannot enable it.

Normal click selects the best supported quality, Shift-click opens choices. Available original captions can be embedded; Include automatically generated captions defaults to on for new jobs. Membership VOD uses only the exact playable authorized response from the signed-in source document: play the video first. It does not read/store account cookies or enable inaccessible content, authenticated live or upcoming recovery.

Upcoming broadcasts check the same video every 30 seconds while the browser runs. Live reception begins at the live edge; snapshots and Stop and save export the received interval. Full-broadcast natural-end completion and continuous YouTube live captions are not established by short reception checks. Upstream changes can affect availability.

## Storage and removal

| Data | Location / ownership |
|---|---|
| Settings, translation credentials, job records | Extension-local browser-profile storage. |
| Picked-folder handles | Extension IndexedDB, database mdownloader-download-folders. Each job retains its original folder key. |
| Temporary stream data | Extension-owned browser storage/OPFS workspaces. |
| Saved media and sidecars | Browser download location, configured subfolder or explicitly selected folder. |
| Windows common helper | %LOCALAPPDATA%/MDownloader/ExplorerBridge. |
| Windows speech runtime/models | %LOCALAPPDATA%/MDownloader/Captions; models subdirectory and per-origin work areas. |
| macOS common helper | ~/Library/Application Support/MDownloader/CommonHelper. |
| macOS speech runtime/models | ~/Library/Application Support/MDownloader/Captions. |

File naming starts with the source page's hostname, strips a leading www., replaces dots/spaces in the body with underscores, sanitizes forbidden characters and retains the actual extension. Page-title and local start-time options default to on; name/time are fixed at job registration. Partial files get a separate suffix.

A completed browser-managed file can be revealed through the browser. Windows picked-folder reveal needs the common helper and a one-time association with the exact selected folder. Shift-click the folder icon to play a saved file in a browser tab. macOS uses browser Downloads instead of Windows Explorer integration.

Record deletion and section clearing leave saved media on disk. Shift-delete can remove a supported completed browser-managed file. Removing the extension removes its browser state according to browser policy, but leaves saved media and separately installed native components.

Remove the common helper through Settings → Helper, Windows Installed apps or the documented platform uninstaller. Verified removal resets the affected folder/recognition choices, while saved media and separately installed speech engines/models remain. Before separately removing retained speech files, finish all jobs and account for other extension instances sharing the models. See [Windows helper](../native/explorer/README.md), [macOS helper](../native/common-macos/README.md) and [caption executor](../native/captions/README.md). The PotPlayer importer has separate registration/removal instructions.

Diagnostics default to off. Detailed extension logs contain bounded stage codes, timings and counts rather than raw URLs, credentials, paths, PCM, stacks or full exceptions; browser/third-party messages can still carry their own text. Confirmed issue reports explicitly send the selected page URL and user-entered details through FormSubmit; submissions are not automatically retried after an uncertain network result.
