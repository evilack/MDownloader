# Local automatic captions

The user requested preview first, followed by implementation without an approval pause. The interactive preview at `tools/dev/local-captions-preview.html` was rendered and presented before production changes. Preserve the existing dirty working tree and do not push or publish.

## Behavior

New downloads snapshot global defaults, with inherit/on/off per download. Default is off and no model is initially selected or installed. The settings page explicitly downloads a model, then selects an installed model; the installer never downloads models. Windows offers faster-whisper and whisper.cpp; macOS offers whisper.cpp. Model, source language and SRT/VTT apply to generated sidecars named `<video stem>.generated.srt/vtt`. Site subtitles, MP4 subtitle muxing and translation retain their own settings. Generated captions are not sent to translation providers.

## Architecture and approaches

Use a separate `com.mdownloader.captions` native messaging host, not the Explorer or Kakao host. Browser-only recognition cannot provide the requested engine choice. A loopback HTTP service adds authorization and installation complexity, so native messaging is preferred. Python host with an isolated install environment and explicit whisper.cpp/FFmpeg paths provides both OS flows. Engine/model discovery must report actual installed state. Model preparation is an explicit operation with visible progress and errors.

The native host queues jobs, stages input on disk in bounded messages, converts to short 16k mono WAV chunks, and recognizes sequentially. Cancellation and disconnect are explicit states. Native progress is independent of the video download state. No recognition starts until video save completes. For finite separated HLS/DASH audio, prepare audio as soon as that track and a first video prefix are committed, while later video may still be downloading. The small video prefix preserves the common HLS clock and is discarded by the helper while preparing WAV. Unsupported, live, discontinuous or unavailable preparation falls back to completed media. Preserve the remux timing origin when using prepared audio.

Direct browser downloads use their verified completed local path; runner/picked-folder saves use bounded Blob slices before scratch release. Save results beside the video, through the existing picked-folder writer where appropriate. Never overwrite original subtitles. Retain bounded retry input temporarily; remove after expiry, explicit forget or success where the source can be read again. Installation scripts register only the explicitly supplied extension ID for the current user.

## Review and validation

Test settings validation and OS restrictions, timestamp and output formatting, native framing and input bounds, cancellation/queue/retry, source ownership, unavailable helper/model, saved-video independence, preparation fallback and actual rendering at narrow sizes. Run the existing regression suite and project checks. Perform real Windows engine recognition when runtime and model are available; disclose macOS and GPU validation limits. No speed or accuracy promises.
