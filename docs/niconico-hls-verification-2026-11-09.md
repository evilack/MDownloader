# NicoNico HLS download verification — 2026-11-09

Source: https://www.nicovideo.jp/watch/sm45342269

The original report described three detected URLs, with two download failures. A disposable Chrome profile reproduced the master playlist and separate AVC video/AAC audio playlists. Before grouping was recovered, these appeared as three rows. With the master recovered, the companion audio still appeared as an independent row. Transfers failed at `segments-transfer` with `stream_http_forbidden` (HTTP 403).

## Cause and common fix

The HLS key endpoint requires the playback session cookie. In the diagnostic run, the exact same key URL returned HTTP 403 with `credentials: 'omit'` and HTTP 200 / 16 bytes with `credentials: 'include'`, both in the original document and the extension. Existing observed-header replay unconditionally omitted credentials.

The common HLS request path now records only `includeCredentials: true` when a successful observed playlist request actually carried a Cookie header. Cookie values are not copied to the candidate cache, job history or diagnostic report. The runner preserves that context through playlist and segment/key reads. Credentials are included only for the originally observed server origin; a different server declared in the playlist keeps the previous omission behavior. Native manifest recovery preserves the observed credential mode as well.

The common candidate grouping code also recognizes a master's explicitly declared companion `audioUrl`. Same-document video/audio renditions become one master download; unrelated audio remains independently discoverable. No NicoNico hostname, URL pattern, special header, key URL or session value was added to production logic. Site URLs and extra host permissions occur only in the disposable reproduction harness.

The request fingerprint now also distinguishes an observed cookie-authenticated request from a cookieless request. A cached master-request 403 from the old mode cannot prevent the newly authenticated transfer; unchanged requests retain their existing denial diagnostics.

## Verification

- Added regression tests first and observed the expected failures for credential capture, origin scoping, companion-audio grouping and native recovery credential mode.
- Focused HLS/network/runner tests: 43 passed.
- Full suite after final denial-cache regression fix: `node --test tests/*.test.mjs` — 729 tests, 728 passed, 1 skipped, 0 failed.
- Project checks: `node --expose-internals tools/checks/verify-project.mjs` — 359 JavaScript files, 18 JSON files, 830 imports, 137 local references and 84 preserved files checked, no failures.
- Development build: `node tools/build/package-extension.mjs --flavor development` succeeded.
- Final real-network probe: `node tools/checks/probe-niconico-chrome.mjs`. It uses a new Chrome profile and an extension copy, without attaching to another browser or using Computer Use. The final run did not make the optional diagnostic key probes before download.
- Repeated scans retained one download candidate. The master exposes eight video/audio combinations across 144p, 360p, 480p and 720p, retaining separate audio for every choice. The complete default 720p download was tested; other choices were enumerated, not each fully downloaded.
- All 80 video/audio media segments completed. Chrome reported the resulting download complete.
- Saved MP4: **65,954,019 bytes**, **237.4 seconds**, **1280×720 AVC**, **AAC audio**. Packet inspection found **7,121 video packets** and **11,127 audio packets**.
- Chrome decoded the saved file at the beginning, midpoint and end, with video ready state 4 and nonzero/increasing decoded audio bytes. This verifies browser decode, not a human listening assessment.

Final evidence: `artifacts/niconico/chrome-1794201288225/report.json`.

Saved file: `artifacts/niconico/chrome-1794201288225/downloads/cf511782-925e-42ad-86f1-aa5f5d607e50.mp4`.

SHA-256: `09c6bb932422bec40e2dba1d6b76d6413f04edb58df4c1b49dfa63f2844ea8fe`.

The installed extension in the user's regular Chrome profile was not reloaded or inspected. Reload the unpacked extension and refresh the source page so its playback requests and fresh session are observed. Existing access-permission prompts remain required.
