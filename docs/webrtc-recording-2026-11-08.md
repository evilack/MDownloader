# WebRTC recording — 2026-11-08

**Historical version 0.2.25.** The separate recording page described below was rejected by the user and removed in 0.2.26. Current behavior is a regular media item with live progress and controls in the existing download manager. See [the integration correction](webrtc-integration-2026-11-08.md). The recorded-file evidence below remains evidence of the old recording core, not native acceptance of the new manager flow.

## Usage

1. Play the source WebRTC video and open MDownloader.
2. Choose **현재 WebRTC 본편 저장 / Save current WebRTC video** in the shared popup/side-panel media section.
3. In the recording tab, check the selected track's actual width and height and click **녹화 시작 / Start recording**.
4. Keep both tabs open. Click **중지 후 저장 / Stop and save** to finalize and download.
5. For another recording, click **다시 검사 / Rescan**. A failed browser save offers **저장 다시 시도 / Retry saving** while retaining the committed recording in that tab.

The capture uses cloned tracks from the selected visible, active video element's MediaStream. It does not request the unrelated blurred HLS, create a second WebRTC receiver, alter original playback, stop original tracks, capture the screen, or retrieve footage from before recording began. MP4 H.264/AAC is preferred when the browser supports it; WebM is the fallback. Re-encoding may occur; this is not a bitstream-copy or lossless claim. Each recording is limited to 2 GiB.

## Implementation

- `extension/lib/webrtc-page.js`: isolated-world probe/start/stop; exact track and page binding; clones; MediaRecorder; bounded queued data and chunk acknowledgements; source/controller loss detection.
- `extension/lib/webrtc-recording.js`: tab/document/page/session/token validation; strict chunk ordering; bounded size; OPFS store that closes each chunk before acknowledgement. Later disk failure does not erase earlier committed chunks.
- `extension/webrtc.js`, `extension/webrtc.html`: recording tab and controls, committed-file assembly, current naming/folder settings, browser download lifetime and retries, saved job registration.
- `extension/detection.js`, `extension/candidate-list.js`: shared popup and side-panel entry for active MediaStream videos, independent of HTTP candidates.
- All 10 existing message catalogs include the new controls and errors. No dependency or permission was added. First WebRTC feature version: 0.2.25.

Source loss drains queued writes before partial finalization. Authenticated normal completion still verifies the recorder's final chunk count. If writing fails, committed data is offered as a partial file; an incomplete tail may not be fully playable. If nothing was committed, the screen permits a new scan. Closing the recording tab stops the recorder through failed heartbeats; this version does not implement recovery of abandoned OPFS folders after a recording-tab/browser crash.

## Verification

An initial direct MediaRecorder feasibility capture of the current 720×960 WebRTC track produced a 15.0003-second MP4 (6,129,735 bytes), with H.264 video and 48 kHz stereo AAC. This initial capture was separate from the extension UI.

After the user reloaded MDownloader, the installed extension was exercised through the actual Chrome toolbar, popup button and recording tab. The source chooser reported **720×960**, recording status reported **video/mp4**, and received bytes increased. **Stop and save** completed and the screen displayed **녹화 파일을 저장했습니다**.

The installed extension's output was independently read from the Downloads folder:

| Property | Result |
|---|---|
| Size | 9,603,352 bytes |
| Duration | 22.4195416667 seconds |
| Video | H.264/AVC `avc1.42001f`, 720×960, 678 packets |
| Audio | AAC `mp4a.40.2`, 48 kHz, 2 channels, 1,051 packets |
| Local Chrome replay | 346 frames decoded at 11.42 seconds; 0 dropped frames; no media error |

Detailed media metadata is in `artifacts/webrtc-recording-2026-11-08/installed-extension-recording.json`. The local replay server was stopped after verification. The source tracks remained live after the initial capture; the implementation and regression tests stop clones only.

Final Node run: **187 passed, 0 failed** across the then-current workspace; WebRTC-specific tests: **12 passed**. An earlier full run saw an in-progress, unrelated `hls-encryption.js` module missing; the final run passed after that concurrent work supplied it. Initial localization verified 369 messages × 10 locales with no missing references. A later global localization run failed on the concurrently added HLS keys `stream_hls_invalid_key` and `stream_hls_decryption_failed`, which were absent from the English catalog; that separate work was not changed here. All 22 new WebRTC keys are present in all 10 catalogs. Static module/manifest verification passed with 153 JavaScript files, 413 relative imports, 99 local references, 73 preserved files and no failures.

Review identified source-loss/write ordering and storage-error recovery defects. Both were corrected and covered by sink, store and controller tests. Large recordings, recording-tab/browser crash recovery, the picked-folder branch and the WebM fallback were not verified against this live site.

The Computer Use browser URL policy rejected direct `chrome://extensions` navigation; the user performed the extension reload. Subsequent native Chrome popup/recording controls were usable and verified. The Modern Web Guidance CLI could not execute because npx was unavailable; implementation uses the W3C MediaStream Recording and Chromium references consulted during analysis.
