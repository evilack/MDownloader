# WebRTC integration correction

User correction: WebRTC must be a normal detected-media item, started with the existing download button and visible immediately as a running job in the existing download manager. No separate recording page or special launch button.

Probe active visible MediaStream tracks into track-bound WEBRTC candidates. For a single confirmed WebRTC main player, do not present unrelated historical/unbound HLS as its main video. Preserve other documents and genuine independent players. Thumbnails bind exact track IDs; do not expose a fabricated transferable URL.

Register the job before recording starts. Reuse the existing offscreen transfer document for private sequential OPFS storage, progress reports, file saving and download lifetime. The original page still owns MediaRecorder cloned tracks. The service worker relays authenticated chunks and controls, with ephemeral tab/document/page/token metadata. Existing manager shows bytes/speed/live state and cancel/stop-and-save controls, and continues if popup or manager closes. Closing/changing the source stops reception and saves committed data as partial. Do not disguise WebRTC as HLS internally.

Preserve the previous capture core, remove obsolete standalone recording UI, and test detection, immediate registration, live state, source loss, cancellation, source ownership and final save. Verify installed popup → download manager → stop/save → actual 720×960 file. No new extension permissions or dependencies.
