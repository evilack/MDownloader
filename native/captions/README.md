# Local execution adapter for automatic captions

`com.mdownloader.captions` is execution protocol 2 / source package 5. The extension owns the workflow. The native adapter does not own caption jobs, phases, retry/fallback policy, model catalogs, supported-language lists, output names, cue merging, timeline mapping or subtitle serialization.

`extension/lib/caption-execution.js` implements the application-facing caption API. It issues individual `execute` requests for scoped file I/O, usage, HTTPS transfers, audio decoding, model-session open/infer/close and exclusive copying. `cancelExecution` cancels and reaps processes/transfers for a caller-selected scope. Native code owns authentication, framing/path/resource validation, package locks and process lifetime. Arbitrary command or JavaScript text is not accepted.

The extension selects model repositories/revisions/files/checksums, recognition settings and backend, sequences preparation and one-window inference, handles failures, transforms raw cue timing and serializes SRT/VTT. It specifies output names; native copy reports collisions and the extension selects another name. Worker output is bounded raw recognition data, not a final caption file.

Windows supports faster-whisper and whisper.cpp; macOS supports whisper.cpp. Probe reports actual binding/CLI/GPU-toggle capabilities. The extension explicitly selects a supported backend. The decoder streams bounded PCM blocks, returns exact frame-count WAV chunks and obeys explicit alignment/trim/resource parameters.

Package 5 adds one generic asynchronous audio computation through `avDecodeOpen`, `avDecodePoll`, `avDecodeSupply`, `avDecodeAck` and `avDecodeClose`. Open returns `opening` before media probing finishes. The caller services bounded read-at requests while polling; it supplies actual bytes and actual EOF. Poll returns inline PCM with actual PTS/time base, sample count, SHA-256 and byte count. Mono packed s16 output contains exactly `samples * 2` valid bytes, excluding plane padding. Demux termination and observed source EOF are separate facts. The caller chooses source, clocks, windows, epochs, recognition and final mapping.

The worker lazily imports pinned PyAV, rejects secondary resource opens, uses the existing exact-parent monitor and owns no subprocess below it. Output/control queues are bounded independently. ACK permits owned output cleanup; Close reports success only after actual child exit and owned cleanup. Missing or unconfirmed close evidence does not release its registry/package ownership. The existing finite `decode` command still returns observed WAV frame counts and supports application-owned finite audio preparation without adding a caption workflow to Python.

## Installation and updates

Settings → Helper delivers the extension's package through the generic common helper 9 contract (Windows minimum revision 9.1). Its safe manifest accepts nested modules without changing the body. Version 8 had an exact filename contract and needs one migration; subsequent feature additions do not require a body reinstall. Package 5 adds two physical Python modules and extends the PyAV dependency to macOS; it does not change common protocol 1 or execution protocol 2. Existing package 4 postprocessing remains compatible where the optional new decoder is not requested. Both distribution builds regenerate package payloads.

No models are installed automatically. Download models through the explicit settings action. Existing models remain under `Captions/models`, shared by registered instances. Work files are isolated per authenticated extension origin. The extension manages retention and job quotas; native usage and resource limits are execution primitives.

The pinned bootstrap prepares private Python/dependencies, preserves models/configuration and shares the OS package lock with active inference. The source installer copies nested modules dynamically. It verifies authenticated execute/probe replies before reporting success and does not modify system Python/PATH or unrelated hosts.

## Verification

The earlier [command-only responsibility and verification record](../../docs/command-only-helper-verification-2026-11-10.md) concerns its recorded package 4 baseline and retains that work's test evidence. It is not evidence that the new package 5 streaming commands have run. Package 5 currently has independent source review and source/payload SHA-256 comparison only; this implementation task deliberately did not run tests, syntax/compile/lint checks, browser/native probes, installations, media/model downloads or ASR. Real callback/PTS/flush/backpressure, process/handle cleanup, platform installation and browser/media behavior require the separately assigned execution validation. No current installed files were replaced by this source change.

Historical checks remain in [earlier verification](../../docs/common-helper-verification-2026-11-09.md). Maintainer-only registration remains `python native/captions/install.py --extension-id <actual-id>`; do not run it against an active user connection as a test.
