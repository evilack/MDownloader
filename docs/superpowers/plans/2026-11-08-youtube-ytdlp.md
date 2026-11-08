# yt-dlp feasibility and integration decision — 2026-11-08

The user requested investigating yt-dlp in addition to the browser-only SABR work. This permits a temporary local extractor/download experiment; it does not turn the existing product into an installed native-helper application. Computer Use is prohibited, actual browser runs target only the development/manual build, and Chrome Store exclusion remains permanent.

## What YTVD demonstrates

Read-only inspection of the user-specified installed YTVD 1.4 extension found `/formats`, `/download`, `/progress` and browser saving of a server-produced file. Its default service is `video-gateway.vercel.app`. No browser-side SABR/UMP extractor was found. Its server implementation is unavailable: `format_id` and `has_ffmpeg` do not establish that the server uses yt-dlp. Embedded service credentials were neither reused nor copied. The original browser-only plan was not an implementation of that server pipeline.

## Tested candidates

1. **yt-dlp extracts, Chrome receives.** Official yt-dlp 2026.10.26 runs temporarily under ignored artifacts, using the existing Node runtime for bundled EJS, without plugins, remote components, browser cookies or system installation. Only the selected HTTPS googlevideo URL lives in memory. The development offscreen receiver requests bounded ranges, checks exact Content-Range/total/validator, writes OPFS, decodes both tracks and saves through Chrome. Two native runs, including the final staged candidate after review fixes, received the entire 30,185,697-byte format 18 file in eight HTTP 206 responses. Several other newly extracted sessions returned 403. This establishes complete reception feasibility, not reliable extraction across sessions.
2. **yt-dlp receives, Chrome imports/saves.** The same metadata can be sent to yt-dlp on stdin without saving its signed URL. The helper receives the file; the diagnostic transfers it to Chrome OPFS in 512 KiB CDP chunks, verifies both tracks and saves a byte-identical file. This is an explicit test-harness fallback, not Native Messaging or Chrome-to-CDN reception. It is enabled only with `MDOWNLOADER_YTDLP_TRANSPORT=helper`.
3. **Existing browser-only SABR.** The observed HTTP 200 response was itself UMP protection status 3 with no media headers. An observed token's presence/length therefore does not prove accepted playback. Independent reception again stopped after 60.533 seconds. No token minting, CAPTCHA automation or attestation bypass was added.

The 623-second display is an integer-rounded duration. Format 18 declares 622.689 seconds; the complete MP4 parses as 622.689524 seconds, with video ending at 622.566667 and audio at 622.689524. Verification checks every advertised byte, every encoded packet, both rounded track durations and decoding at 1 and 620 seconds. It does not append silence/frames to manufacture 623.000 seconds.

## Concrete follow-up if native integration is chosen

- Add an optional **development-only** Native Messaging host with fixed message types: inspect, start, progress, cancel and completed. Accept a validated YouTube video ID and an allowlisted format selection, never an arbitrary command, executable, URL or output path from a page. Validate extension identity and input bounds at both ends.
- Let the host own yt-dlp process lifetime and network reception; retain stable job identity, cancellation, disk quota limits, partial-output policy and sanitized errors. Stream progress and completion metadata, not an entire file in one message. Chrome limits host-to-extension messages to 1 MiB.
- For the tested muxed H.264/AAC format 18, FFmpeg was not required. Higher-quality separate audio/video formats need a separately provisioned FFmpeg/ffprobe path and merge/cancel verification. Do not silently downgrade a chosen quality.
- Provide explicit host installation/removal for each OS, pinned binary/hash/license inventory and an extension allowlist. Windows requires a host manifest plus a registry registration. No registry entry, `nativeMessaging` permission, server deployment or permanent helper installation was made by this investigation.
- Integrate discovery/quality/manager/resume only after the production bridge, error/cancel handling and repeated full-file acceptance pass. The existing product entry remains `youtube_not_verified`; a successful harness run does not unlock it. Store packages must exclude host integration and YouTube provider/vendor trees.

Official references: [yt-dlp README](https://github.com/yt-dlp/yt-dlp), [versioned HTTP downloader](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/downloader/http.py), [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). Retained test facts are in [verification](../../verification.md#yt-dlp-comparison--2026-11-08).
