# YouTube live and scheduled validation, 2026-11-09

Implementation retains official youtubei.js18.3.0/googlevideo5.0.1 and Mediabunny1.65.2. No external extractor or encoder product dependency was added. References: [official live downloader example](https://github.com/LuanRT/googlevideo/blob/main/examples/downloader/livestream-example.ts) and [SABR session factory](https://github.com/LuanRT/googlevideo/blob/main/examples/downloader/utils/sabr-stream-factory.ts). Local wrapper changes are tracked in [the upstream-change record](youtube-upstream-changes.md).

## Observed public live

HvZt-nh9sGg, FRANCE24 English, had player status OK/isLive=true/isLiveNow=true/duration0/source yt_live_broadcast. Actual isolated development Chrome157.0.8103.39 used normal scan/quality/enqueue/manager UI to receive video/audio, save a snapshot while parent bytes continued, then stop and save. Both MP4s decoded video at the beginning/tail and the complete saved audio had nonzero RMS. Source epoch timestamps were normalized to zero. No caption tracks were advertised on this live; this does not claim continuous live-caption reception.

The initial two-instant audio assertion encountered a silent news interval. The corrected check decodes the complete saved audio track rather than requiring speech at two arbitrary instants.

User-supplied JXR579POAu4 is currently an ended SBS live archive: isLiveNow=false, an endTimestamp and2992s length. Its AV/caption snapshot and finish samples passed, but this is excluded from ongoing-live acceptance. An initial exact-CDN permission attempt failed after routing changed; initial user confirmation now requests the bounded googlevideo-domain wildcard used by SABR redirects.

## Scheduled waiting and user hold

An actual Studio webcam test broadcast FwuPrgVPmis was created as unlisted for05:20KST, with Iriun Webcam and its microphone selected. Start was never clicked. An isolated development Chrome registered that watch page through the normal quality/confirm/enqueue UI and showed waiting, zero bytes and no downloadId.

The user then explicitly deferred actual scheduled broadcasting until later work and requested all prepared windows closed. Studio/test watch tabs, camera preview and the owned failed-login window were closed. The headless scheduled observation was stopped on that request. No webcam broadcast was started. Cloud schedules were neither deleted nor rescheduled.

Actual upcoming-to-live broadcast transition and natural-end acceptance are deferred by the user. Identity-pinned polling, fresh format choice and cancellation without scratch allocation are unit tested; these do not replace that external acceptance. The implementation requires Chrome to remain running; it does not wake a closed browser or sleeping computer.

## Native Explorer registration

After explicit user approval, the installer registered only the current-user Chrome host for the actual manual extension. Actual Chrome returned a correctly framed invalid_message response to a deliberately invalid action. A Windows PowerShell5.1 default-path error was reproduced RED and fixed GREEN by resolving PSScriptRoot defaults after parameter binding. This check opened neither an OS folder chooser nor Explorer. First folder association and an observed Explorer window remain separate.

## Review and limits

Two important callback omissions were reproduced and fixed: initial/updated heartbeat server state and server-requested ReloadPlaybackContext forwarding through the same official player endpoint/client. Identity, permission, host and playability checks remain in place. Signed URLs, tokens, SABR config and caption bodies stay out of persistent storage. Short request-header leases are released rather than held over a multi-hour wait. Existing VOD finite-end checks remain strict.

Modern web guidance search/list covered cancelable polling/background-resource patterns. None directly describes an offscreen transfer owner, so no unrelated guide-specific UI behavior was added.
