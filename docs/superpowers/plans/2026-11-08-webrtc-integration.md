# WebRTC Integration Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans and test-driven development. No Git repository exists; originals are backed up under artifacts/webrtc-integration-2026-11-08/originals.

**Goal:** Make WebRTC a normal candidate and an immediately visible managed background download.

**Architecture:** Track-bound detection → existing enqueue/job store → existing offscreen document with WebRTC receiver → existing job updates/save path. Service worker owns page control and authenticated relaying.

**Tech Stack:** Existing MV3 modules, MediaRecorder, OPFS and downloads API.

**Spec:** ../specs/2026-11-08-webrtc-integration-design.md

## Global Constraints

No separate page/button, no false HLS flag, original tracks preserved, exact source ownership, bounded durable chunks, existing manager progress/control/naming/folders.

## Tasks

- [x] Add failing tests for offscreen transfer lifetime, progress, source loss, cancellation and state summaries.
- [x] Implement transfer/service-worker bridge and reuse existing saving/status paths.
- [x] Add actual WEBRTC candidates and thumbnails, remove standalone entry/UI, integrate manager controls and progress.
- [x] Full tests, localization/module checks and independent review; fix important findings.
- [ ] Installed-browser verification through existing row/button/manager and inspect downloaded file.

## Evidence and limits

197/197 Node tests passed. Localization: 371 messages × 10 locales, no missing references. Independent review found SPA URL loss and startup cancellation races; failing regression tests reproduced both and now pass. Cancellation intent persists before source metadata/receiver creation; an already-ended producer forces receiver finalization. Source-change and progress reports are serialized per job.

User reloaded 0.2.26. Browser-only CDP inspection confirmed that version in the live source document, an active observer and a playing 720×960 MediaStream video. The browser tab API does not list extension popups/side panels. Windows Computer Use stopped on URL-confidence enforcement, then the user explicitly prohibited Computer Use. No native app action was performed after that instruction. The installed UI flow and a new file through that flow remain unverified; do not treat the prior 0.2.25 capture as verification of this revision. Documentation and static checks are completed separately.
