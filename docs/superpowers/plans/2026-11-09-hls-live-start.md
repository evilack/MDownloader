# HLS Live Start Selection Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this small, explicitly requested change inline.

**Goal:** Add a per-download option to start DVR-capable HLS near the current live position instead of retrieving all available history.

**Architecture:** Reuse the existing download options editor and enqueue/runner message chain. Add an optional `liveStart` value (`beginning` or `current`). Default remains `beginning`. The HLS transfer initializes each open track's sequence cursor near the live edge exactly once; ordinary continuation and stop/save remain unchanged.

**Tech Stack:** Existing MV3 extension, native labeled select, Node test runner. No dependencies.

**Design:** This is a small extension of the requested existing options flow. The existing editor is compact, so its labeled native-select pattern is reused. Show the option for HLS unless the candidate is explicitly finite; include helper text that current starts at recent complete segments and beginning means the earliest server-provided media. Preserve per-candidate selection on reopen, and omit the field for other formats. Retain a short startup buffer of three target durations, rather than requesting unpublished segments at the exact wall clock. Keep finite tracks complete and do not move already-running jobs. No automatic retry mode switch or site-name heuristics.

**Review focus:** Optional field validation and propagation; selected rendition fast path; unequal audio/video segment lengths and sequence bases; end-list handling; refreshing must never reapply the initial cut or re-request skipped history; init/key/discontinuity metadata must remain attached to the chosen segment; option must survive cancel/reopen and remain disabled during submission.

- [x] Add failing transfer tests for current-start initial history skip plus refresh, default full history, finite-media preservation, and paired tracks/init metadata.
- [x] Add failing editor and message-chain tests for visible options, defaults, persistence, validation, and propagation.
- [x] Implement cursor initialization, UI/localized copy, and message propagation with minimal changes to existing files.
- [x] Run focused and complete tests, static/localization checks, independently review this change, and inspect the actual compact editor.
- [x] Verify a short real Rumble current-start download in an isolated copied extension: first requested segment near the edge, audio/video present, stop/save succeeds. Record evidence and limits.

This checkout contains active, uncommitted integration work required by the running extension. Apply only scoped edits in place and preserve all unrelated changes. No commit, push, or publication is part of this request.
