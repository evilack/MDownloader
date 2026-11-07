# WebRTC Recording Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Follow test-driven development and record verification here. This checkout has no Git repository; preserve the original files in a task backup before editing.

**Goal:** Download the currently received WebRTC video and audio through a recording tab.

**Architecture:** Isolated-world recorder → validated extension messages → bounded sequential OPFS sink in recording tab → browser save and existing job record.

**Tech Stack:** Existing Manifest V3 modules, MediaRecorder, OPFS, Chrome runtime/scripting/downloads; no dependency or new permission.

**Spec:** ../specs/2026-11-08-webrtc-recording-design.md

## Global Constraints

Preserve original tracks; bind source identity; incremental bounded writes; keep source and controller tabs open; distinguish interruptions; respect filename/folder settings; localize UI; no new extension permissions.

## Review Focus

Out-of-order/oversized chunks; stream replacement; duplicate recorders; failed storage or download and retry; controller/source loss.

## Tasks

- [x] Write and run failing tests for ordered recording sink, storage errors, limits and injected page selection/track preservation.
- [x] Implement `lib/webrtc-recording.js` sink and `lib/webrtc-page.js` isolated recorder task; run tests.
- [x] Add `webrtc.html`/`webrtc.js` recording controller, shared entry button, localized strings, saved-job registration; preserve changed originals.
- [x] Run full Node suite, localization and project checks; review integration and error/cleanup paths.
- [x] Load the updated installed extension, record the actual 720×960 source, stop/save and inspect/replay the saved file. Document exactly what succeeded.

## Progress

Initial source analysis complete. Node is available; npx is absent, so modern-web-guidance CLI could not execute. Official W3C MediaStream Recording and Chromium implementation references were checked in the preceding turn. No Git branch/worktree exists in this checkout.

Independent review found two important errors: queued writes versus source-loss counts, and unrecoverable UI after OPFS failure. Fixed with an optional count only for forced source loss, per-chunk committed OPFS storage and partial-save/error UI paths. Regression tests cover both sink/store and controller behavior. Final suite 187/187, WebRTC tests 12/12. Installed extension saved a 22.41954-second 720×960 H.264/AAC MP4; local replay decoded 346 frames with no dropped frames/media error. See ../../webrtc-recording-2026-11-08.md for evidence and unverified limits. No Git commit or publication occurred.
