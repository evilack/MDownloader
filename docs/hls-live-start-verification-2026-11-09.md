# HLS live download start selection — 2026-11-09

The download options editor now offers `라이브 시작 위치` / `Live start position` for HLS candidates unless the source is explicitly finite. `처음부터 (제공된 구간)` / `From available beginning` keeps the existing behavior and remains the default. `현재부터` / `From current live position` skips retained history and starts with recent complete segments. The help explains that the beginning is limited to server-retained media and current may lag the live edge by several seconds.

The existing Shift-click download flow opens this same editor in popup and side panel. The choice is retained when reopening options for the same candidate, including choices made while quality/subtitle lookup is pending. Regular clicks retain the original default. No persistent global setting or new permission is required. Other formats do not submit this HLS option.

The validated `liveStart` value passes from the editor through candidate enqueue, registered HLS job, runner message and `DownloadTracks`. For current-start, each open track's initial sequence cursor retains a common recent duration of three times the largest track target duration. Cursors are initialized once, so subsequent manifest refreshes append every new sequence without skipping further media or revisiting history. Selected segment maps, keys, ranges and discontinuities remain attached. Finite playlists are not trimmed, and already running jobs are not moved.

## Verification

- Failing tests were observed before implementation for initial DVR history skipping, separate track tails, invalid mode rejection, editor selection/persistence and enqueue propagation. A review-discovered pending-lookup selection reset was also reproduced with a failing test before correction.
- Final focused observer-independent transfer/UI/enqueue/network tests: **77 passed**.
- Final whole suite: `node --test tests/*.test.mjs`, **728 tests, 727 passed, 1 existing opt-in external subtitle test skipped, 0 failures**. Concurrent work added tests during this session. One intermediate whole-suite run failed `pairs an observed master only with an allowed successful variant from the same document` because a concurrent cookie-context change had not yet updated that test's expected `includeCredentials` field; its owner updated the expectation, and both the final focused and whole-suite runs passed without changing that code in this task.
- Project static verification: **failures: []**, 359 JavaScript, 18 JSON, 827 relative imports, 137 local references, 84 preserved files.
- Locale audit: all **10 locales**, 506 messages each, **0 missing references**. Existing literal UI candidate count is 3.
- Independent scoped review approved the final change after the pending-lookup fix. The reviewer directly reran 32 editor tests.

## Real Rumble media and UI

Command: set `MDOWNLOADER_RUMBLE_STREAM_URL` to the current observed Rumble media playlist, then run `node tools/checks/probe-rumble-live-start.mjs`.

Successful final evidence: `artifacts/rumble-live/current-1794201384290/result.json`.

The test used an isolated copied extension and a local page declaring the actual Rumble CDN playlist as its video source. The source page was a fixture; Rumble playlist/segment HTTP responses were real and unmodified. The copied popup shell mounted the production options editor, preserving normal sender checks, scan/enqueue/job/runner/stop/save behavior. A test-only fetch wrapper in the copied runner recorded request URLs without changing requests or responses. These shell/audit additions are not present in the installed extension.

- Full live DVR playlist: **2,189 segments**, starting at sequence **1**, target duration **2 seconds**.
- First actual media request: sequence **2,187**, followed by **2,188–2,191**. No historical segment before 2,187 was requested by the transfer.
- Selected and submitted editor value: **current**. Registered transfer retained `liveStart: current`.
- Normal `finish` / stop-and-save control completed a **10.011-second MP4**.
- Media inspection: **AVC video, 300 packets; AAC audio, 466 packets**.
- Actual Chrome playback: **1280×720**, time advanced, **23,712 decoded audio bytes**, no media error.
- Production editor inspected at the normal **420px popup width** and a **340px panel-like container**: no horizontal overflow, visible focus, associated label and helper text. Screenshots are `options-420.png` and `options-340.png` in the evidence directory.

The user's installed extension had no active HLS, direct, WebRTC or YouTube transfers. It was reloaded after that check so the new worker/runner option path is available. The existing Rumble source tab was refreshed to replace the old content-script context. No ongoing user download was interrupted. No commit, push or store publication was performed.

This validates a short real muxed Rumble stream. Long-duration recording, every provider's DVR format and independently live separated-audio CDN layouts were not externally exercised; separate-track cursor behavior and finite-media preservation are covered by automated tests.
