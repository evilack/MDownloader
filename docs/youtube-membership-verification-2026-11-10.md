# YouTube membership VOD verification

Date: 2026-11-10 (Asia/Seoul). Extension: 0.2.43 development/manual build.

## Reproduction and cause

User-supplied video: `https://www.youtube.com/watch?v=Wv8sBV0MEfQ` (도윤이네).

The signed-in watch page returned playability OK and could decode the video. The extension's anonymous WEB and VISIONOS player responses both returned UNPLAYABLE with a membership requirement. The installed `youtubeQualities` route returned `youtube_restricted`; the options editor discarded this detail and displayed only its generic lookup failure.

## Change

- Capture only the exact resolved source document's visible, matching, playable finite watch response. The capture selects player/media fields and the WEB client version; it never reads account cookies.
- When anonymous discovery is restricted, accept the matching authorized source response. Parse it with the existing YouTube library, keep its WEB profile, and retain video-ID, playability, DRM/format, URL host and expiry checks. Without this source response, restricted anonymous requests remain refused.
- Reuse the source document's successful media request when available. Its origin, path and every source parameter must match, except the player's transformed `n`; only normal added request counters are allowed. Do not decipher an already transformed address again. The first real-media probe exposed a 403 caused by this second transformation; the validated played address received media successfully.
- Preserve a localized backend cause in the options lookup error. Retry clears the old detail. Raw arbitrary exception messages are not copied into the lookup panel.

No new cookies permission, account-cookie extraction/storage, native-helper change or external extractor was added. Authorized source responses and signed transport addresses remain in the existing offscreen session memory. Chrome Store packages continue excluding the YouTube provider.

## Real result

- Installed extension route after reload: 720p, 480p, 360p, 240p and 144p; two subtitle tracks.
- Actual production options component: lookup error hidden, five quality options, two subtitle checkboxes, confirmation enabled.
- Production receiver: 9,175,057 video bytes and 4,884,112 audio bytes.
- Production MP4 remux: 14,045,767 bytes, 301.720091 seconds, 1280×720; browser decoded the output and sought to 290 seconds with readyState 4.
- Production caption acquisition: English 134 cues; Korean 339 cues. Production subtitle mux output: 14,214,184 bytes.
- Browser download of that captioned verification file completed under `MDownloader-verification/Wv8sBV0MEfQ-720p-captioned.mp4` in the user's download folder. A complete local artifact is retained under `artifacts/youtube-member-20261110/`.
- Confirmed no active/paused/starting download before reloading the unpacked extension from this workspace. The installed worker/offscreen option route was verified again after reload.

## Checks and limits

Client, watch-source validation, job-boundary and caption tests: 25 passed. Focused options lookup/retry/pending/stale-result tests: 4 passed. Existing test doubles needed DOM `removeAttribute` and `insertBefore` support to reach the current production UI.

Broader UI/runner tests are not reported as green: UI tests retain outdated footer/target-language-control expectations, and two runner tests still expect caption muxing inside the runner despite its existing staged-save delegation. In a bare Node process the runner import also requires a Chrome runtime listener test shim. These independent expectations were not rewritten to conceal failures.

An isolated baseline with only this task's options-error and runner-discovery changes removed reproduces the same failures: options baseline 22/32 pass, 10 fail; current 23/33 pass, the same 10 fail. Runner baseline and current both pass 4/6 with the same two failures. Logs and the comparison JSON are retained in `artifacts/youtube-member-20261110/`.

This verifies one currently authorized finite membership VOD. It does not establish authenticated live/upcoming downloads, inaccessible memberships, DRM, all codecs, every quality download, or future signed-address/session recovery. A source without an observed successful request may still require playback before downloading.
