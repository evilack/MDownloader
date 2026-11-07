# WebRTC integration into existing downloads — 0.2.26

## Corrected behavior

WebRTC is a normal detected media candidate with its own thumbnail, resolution, **WebRTC** format and live badges, filename and standard download button. There is no separate recording page or special launch button. A non-transferable internal track identifier is not offered as a copyable download URL.

When a single confirmed opaque main player is receiving WebRTC, same-document unbound historical playlist observations do not replace it with a blurred HLS candidate. Other document sources remain separate, and multi-player cases do not use that suppression rule. Candidate resolution rechecks the exact live track in the original document before starting.

The standard enqueue path writes an active recording job immediately, before preparing or starting the source recorder. The existing manager observes bytes, rate, live state, completion and cancellation through the normal job store/feed. It uses the existing cancel and stop/save actions. No HLS flag is fabricated for WebRTC.

The existing offscreen transfer document owns committed OPFS chunks, progress reports, final file assembly and download lifetime. The original source tab owns the cloned MediaRecorder tracks; closing the popup or manager does not end the capture. The original source tab must remain open. Source loss/navigation, including same-document URL changes, finalizes committed bytes as partial output. Cancel discards the recording. Existing filename/date/folder settings are reused. MP4 is preferred with WebM fallback; each recording is limited to 2 GiB.

## Implementation

- `detection.js`, `lib/player-previews.js`, `lib/media.js`: native track-bound candidates and thumbnail/preview matching.
- `candidate-list.js`: normal rows and download controls; no dedicated launch action.
- `webrtc-jobs.js`: service-worker source control, authenticated relaying, cancellation intent from initial registration, source-loss routing.
- `lib/webrtc-transfers.js`: offscreen lifecycle, ordered progress reporting, durable chunk sink and final save/cancel.
- `hls-runner.js`, `jobs.js`, `lib/browser-job-state.js`, `job-row.js`, `lib/metrics.js`: existing transfer/save/feed/manager integration, using an explicit `recording` flag.
- Removed `webrtc.html` and `webrtc.js`; originals and the obsolete standalone controller test are preserved under `artifacts/webrtc-integration-2026-11-08/originals`.

Source messages require the exact extension ID, tab, document, page, recording ID and secret token. Content messages cannot directly control the receiver. Only worker relays are accepted by the offscreen listener. Source control metadata and tokens are stored in browser-session storage, not durable job records.

## Verification

Full Node suite: **197 passed, 0 failed**. Tests cover native candidate replacement of unbound HLS, track replacement rejection, immediate normal-manager registration, no new tab, manager stop/cancel control, offscreen progress/save/partial/cancel, source changes, source/receiver ownership, store and source-start cancellation races, durable byte order/limits and original-track preservation. Localization: **371 messages × 10 locales**, no missing references.

Independent review found two important defects: SPA URL changes could strand a receiver, and cancellation during startup could be lost. Both were reproduced with failing tests and fixed. Progress/terminal reports are serialized to prevent stale job writes.

After the user's extension reload, browser-only inspection of the actual source tab confirmed **version 0.2.26**, active page observation, and a playing **720×960 MediaStream**. The available browser tab API does not expose the extension popup/side panel. Native Windows automation stopped on URL-confidence enforcement; the user then prohibited Computer Use. The new installed popup → manager → file path was therefore **not** directly operated or accepted in this revision. The earlier 22.42-second file belongs to the rejected standalone 0.2.25 flow and is not claimed as proof of the new integration.

Live UI/finished-file acceptance, WebM-only environments, large recordings, picked-folder saving and crash recovery remain outside this revision's native verification. The existing source must remain open, and abandoned recording recovery after a browser/offscreen crash is not implemented.
