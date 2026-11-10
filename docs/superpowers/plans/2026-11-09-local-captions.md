# Local automatic captions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. User authorized preview followed by implementation without another approval wait.

**Goal:** Generate local SRT/VTT after video save with optional audio preparation during download.
**Architecture:** Separate native host; durable per-job settings/state; bounded disk staging and sequential recognition. Reuse existing file save and job UI.
**Tech Stack:** Manifest V3 ES modules, Python 3.11+, FFmpeg, faster-whisper or whisper.cpp.
**Spec:** `docs/superpowers/specs/2026-11-09-local-captions-design.md`

## Global Constraints

Preserve concurrent edits; no reset/clean/stash/checkout, push or publication. Preview before product code. Windows two engines; macOS whisper.cpp. Default off. No whole-video PCM allocation. Existing caption/translation options remain independent.

## Review Focus

Wrong source ownership, cancellation during preparation, timestamp offsets, concurrent downloads and stale messages, browser restart/helper/model failure. Each is exercised by native or extension integration tests.

### Task 1: Native engine and lifecycle

- [x] Write failing `native/captions/test_host.py` tests for option validation, timestamp serialization, upload offsets, interrupted conversion and missing dependencies.
- [x] Implement `native/captions/host.py`, `engine.py`, installer and requirements. Probe reports real state; bounded WAV files and progress; no shell interpolation.
- [x] Run Python unittest and actual short recognition fixture.

### Task 2: Extension orchestration

- [x] Write failing `tests/local-captions*.test.mjs` for defaults/overrides, native message ownership, cancellation races and failures independent of download.
- [x] Implement `extension/lib/local-captions*.js`, job registration and completion, runner and separated-audio preparation hooks. Persist options at registration; serialize native RPC; preserve timing and fallback.
- [x] Verify relevant download/stream/subtitle suites.

### Task 3: Actual settings and per-download UI

- [x] Add native connection/model state and settings using existing tokens and shared bilingual text. Add inherit/on/off options and caption progress/retry/cancel to jobs.
- [x] Verify actual settings and dialog with Playwright fixtures, keyboard and 390px layout; compare with preview.
- [x] Run all project tests/checks, review final scoped changes, document installation and verified limits.

## Progress ledger

Preview created, rendered in headless Chrome, and shown before implementation. Working tree baseline is already extensively modified by other work; implementation remains in current feature branch per user handoff. No commit will include unrelated work.

User corrections: preview reuses actual pages/components; vertical navigation stays vertical at narrow widths; no models initially; explicit model download and installed-model selection are separate. Two native review passes found lifecycle races/fallback gaps, which received targeted regression fixes. Real framed-protocol verification passed both Windows engines and a picked-folder adapter; HLS prepared/final clock comparison difference is zero. Windows installer no-register validation created no models. Final focused suite 76 passed, Python8 passed, browser9 checks passed, project checker zero failures. Latest shared full suite 661 total,656 passed,4 unrelated HLS-preview-resolution failures,1 skipped; those concurrent changes were preserved. No host was registered in the user's browser; no push or publication was performed.
