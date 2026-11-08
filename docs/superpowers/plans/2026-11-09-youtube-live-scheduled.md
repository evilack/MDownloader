# YouTube live and scheduled download implementation plan

> For agentic workers: use superpowers:executing-plans inline. One fresh final review.

**Goal:** download live broadcasts and wait for upcoming broadcasts to become playable.
**Architecture:** existing offscreen YouTube owner, SABR live edge, fresh metadata and Mediabunny remux. Shared job waiting status and cancel/save controls.
**Tech Stack:** pinned official youtubei.js18.3.0, googlevideo5.0.1, Mediabunny1.65.2; Chrome MV3.
**Spec:** ../specs/2026-11-09-youtube-live-scheduled.md

- [ ] RED/GREEN upcoming/live classification, unknown duration, protected refusal; abortable identity-pinned scheduled polling with fresh qualities and no early file allocation.
- [ ] RED/GREEN SABR live endpoint rules, EOS/stop/cancel, same packet remux; reconnect callbacks and per-request header contexts. Keep VOD assertions.
- [ ] Integrate waiting/live metadata in shared jobs/UI, labels and gesture-bound scheduled CDN permission. Captions remain explicit.
- [ ] Actual development Chrome JXR579POAu4 bytes -> save -> decode; controlled scheduled transition and cancel; distinguish fixture transition from real upcoming observation. Verify native registration (no new OS UI). Full scoped/root checks, Store graph inspection, upstream notes and evidence; scoped local commit, no unrelated root changes.

Execution ledger: implementation and390 scoped tests passed; actual ongoing live capture/save/decode passed. Native registration/Chrome framing passed after the production-default-path fix. Reviewer heartbeat/reload findings reproduced RED and fixed GREEN. At user request Studio preparation was delegated and webcam setup completed, then actual scheduled broadcasting was deferred and prepared windows closed. No webcam broadcast was started. External scheduled transition remains deferred.
