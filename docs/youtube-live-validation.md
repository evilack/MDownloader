# YouTube live and scheduled validation, 2026-11-09

Implementation retains official youtubei.js18.3.0/googlevideo5.0.1 and Mediabunny1.65.2. No external extractor or encoder product dependency was added. References: [official live downloader example](https://github.com/LuanRT/googlevideo/blob/main/examples/downloader/livestream-example.ts) and [SABR session factory](https://github.com/LuanRT/googlevideo/blob/main/examples/downloader/utils/sabr-stream-factory.ts). Local wrapper changes are tracked in [the upstream-change record](youtube-upstream-changes.md).

## Observed public live

HvZt-nh9sGg, FRANCE24 English, had player status OK/isLive=true/isLiveNow=true/duration0/source yt_live_broadcast. Actual isolated development Chrome157.0.8103.39 used normal scan/quality/enqueue/manager UI to receive video/audio, save a snapshot while parent bytes continued, then stop and save. Both MP4s decoded video at the beginning/tail and the complete saved audio had nonzero RMS. Source epoch timestamps were normalized to zero. No caption tracks were advertised on this live; this does not claim continuous live-caption reception.

The initial two-instant audio assertion encountered a silent news interval. The corrected check decodes the complete saved audio track rather than requiring speech at two arbitrary instants.

User-supplied JXR579POAu4 is currently an ended SBS live archive: isLiveNow=false, an endTimestamp and2992s length. Its AV/caption snapshot and finish samples passed, but this is excluded from ongoing-live acceptance. An initial exact-CDN permission attempt failed after routing changed; initial user confirmation now requests the bounded googlevideo-domain wildcard used by SABR redirects.

## Scheduled waiting and user hold

An actual Studio webcam test broadcast FwuPrgVPmis was created as unlisted for05:20KST, with Iriun Webcam and its microphone selected. At that preparation stage, Start had not been clicked. An isolated development Chrome registered that watch page through the normal quality/confirm/enqueue UI and showed waiting, zero bytes and no downloadId.

The user then explicitly deferred actual scheduled broadcasting until later work and requested all prepared windows closed. Studio/test watch tabs, camera preview and the owned failed-login window were closed. The headless scheduled observation was stopped on that request. No webcam broadcast was started during that preparation. Cloud schedules were neither deleted nor rescheduled.

That hold was subsequently lifted for actual-start validation. The controlled upcoming-to-live transition is now verified below. Natural-end automatic download completion remains unverified: this test explicitly used the download manager's Save and finish action. The implementation requires Chrome to remain running; it does not wake a closed browser or sleeping computer.

## Actual scheduled start, resumed 2026-11-09

The user explicitly approved sending Iriun Webcam video and microphone audio to the existing unlisted FwuPrgVPmis broadcast for approximately one minute. Studio was controlled through browser DOM APIs in the existing logged-in Chrome; Computer Use was not used. An isolated normal (headless=false) development Chrome157.0.8103.39 registered that exact watch page through Shift-click Download options and confirmed the scheduled choice. The manager first showed active/waiting, zero bytes and no downloadId.

Only after that waiting state was saved did Studio Start get clicked (2026-11-09 08:46:16.196 KST). Studio reported that live streaming had started. The same queued request automatically switched to live=true/waiting=false and received 114874 bytes before its first ready snapshot, without re-enqueue or a direct receiver call. The manager's Save and finish action then produced a 384967-byte MP4. Native Chrome download bytes matched the copied file and SHA-256 was 6efaf1a3f8a915c4b396e1d0bb7d7c77450be138d0cbfcdd377015fce960643d.

Mediabunny inside the actual development Chrome measured an MP4 duration of 13.981179 seconds and decoded beginning/tail video and audio samples at 1920×1080. At 1s and 13.681s, audio RMS was 0.0025304 and 0.0030852 respectively (1024 decoded audio frames at each point), establishing non-silent microphone signal rather than only an empty audio track. This is a short Save and finish capture, not a full-broadcast or natural-end download assertion. The scheduled entry advertised no captions; live-caption ingestion is not claimed.

Studio End was confirmed at 08:47:31.452 KST. The live/end controls were subsequently replaced by New stream, and the owned Studio tab was closed to stop preview camera/microphone use. The unlisted ended broadcast remains in the user's account; it was not deleted. Raw MP4/screenshots remain in ignored local artifacts, not the commit. [Distilled evidence](evidence/2026-11-09-youtube-scheduled-start-development.json).

The maintained scheduled probe was updated from the retired quality-dialog selectors to the current Download options dialog and runs normal Chrome. No extension runtime, official YouTube.js/googlevideo/Mediabunny source or vendor bundle changed. Store YouTube exclusion remains physical; Store Chrome is not run.

## Native Explorer registration

After explicit user approval, the installer registered only the current-user Chrome host for the actual manual extension. Actual Chrome returned a correctly framed invalid_message response to a deliberately invalid action. A Windows PowerShell5.1 default-path error was reproduced RED and fixed GREEN by resolving PSScriptRoot defaults after parameter binding. This check opened neither an OS folder chooser nor Explorer. First folder association and an observed Explorer window remain separate.

## Review and limits

Two important callback omissions were reproduced and fixed: initial/updated heartbeat server state and server-requested ReloadPlaybackContext forwarding through the same official player endpoint/client. Identity, permission, host and playability checks remain in place. Signed URLs, tokens, SABR config and caption bodies stay out of persistent storage. Short request-header leases are released rather than held over a multi-hour wait. Existing VOD finite-end checks remain strict.

Modern web guidance search/list covered cancelable polling/background-resource patterns. None directly describes an offscreen transfer owner, so no unrelated guide-specific UI behavior was added.
