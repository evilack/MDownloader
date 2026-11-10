# Common Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Windows captions from Options through the common native helper, without downloading a caption CMD.

**Architecture:** Extend the existing Explorer host with capabilities and fixed caption setup/status messages. Ship caption sources with the common helper, run a bounded detached worker, and verify the real caption connection. Preserve legacy identity, folders and removal semantics.

**Tech Stack:** MV3 JavaScript, Windows PowerShell5, existing pinned private uv/Python bootstrap.

**Spec:** ../specs/2026-11-09-common-helper-design.md

## Global Constraints

- No caption CMD download in the Windows options installation path.
- Models initially absent; explicit model downloads only.
- Preserve unrelated dirty work, native registrations, folder bindings and downloaded media.
- Existing common-helper bootstrap may be needed; never report request acceptance as installed.
- No CUA, push or publication. macOS PKG behavior retained.

## Review Focus

- Old/missing helper must produce actionable install/update state.
- Concurrent origins/jobs and duplicate clicks must not corrupt setup.
- Long-running worker failure/stale state must not leave fake completion.
- Reject arbitrary paths/code, tampered payload and junction targets.
- Explorer reveal/removal and installed models must survive the upgrade.

### Task 1: Native setup and package

- [x] Add failing protocol/package tests for capability and fixed setup actions.
- [x] Implement common setup worker and durable origin-bound status; ship caption sources via common payload.
- [x] Preserve identity/folder binding and safe removal; run native tests and real isolated worker install.

### Task 2: Options install flow

- [x] Add failing no-download client, old/missing/timeout/failure tests.
- [x] Wire Windows caption install to common helper, add common setup/update state and shared page behavior.
- [x] Verify production UI with fixtures and actual native protocol; retain empty initial models.

### Task 3: Regression and review

- [x] Rebuild payloads and packages, run full tests and checker, report concurrent failures explicitly.
- [x] Request code review, fix issues, record exact verification and remaining platform limits.

## Execution ledger

- Ruling: preserve the legacy native name/directory and add capability negotiation; an existing Explorer installation keeps its identity and folder links.
- Ruling: Windows caption setup has no download fallback; a missing/old common helper gets its explicitly labeled bootstrap/update action. macOS retains PKG.
- RED: new common-helper client initially failed with missing module; native setup tests failed before host dispatch existed. GREEN: client and actual native worker tests pass. Production Windows entry is tested without downloads/permissions APIs.
- Real Chrome157 proof: artifacts/common-helper-chrome-1794203691954/result.json, one click, zero browser downloads, actual engines installed and host connected, models absent. Unique test host aliases removed; production registrations untouched.
- Review found live-worker age expiry/stale state writes and interrupted stage cleanup. Fixed with PID/start-time identity, Windows process job ownership, mutex/job/origin/expected-status writes and explicit source cleanup. A real killed-worker/child regression and cross-origin/old-timestamp tests pass; reviewer accepted fixes.
- Full suite initially746 total/745 passed/1 skipped. Final shared-tree run753 total/751 passed/1 failed/1 skipped: tests/network.test.mjs “keeps unchanged HLS observations stable after Chrome reorders stored object properties”. Isolated network test reproduces1 write versus0; those unrelated network files were already dirty and were not edited for this feature. Recorded explicitly rather than changing concurrent work.
- Production UI fixtures13 checks passed, no page errors. Project checker passed with no failures. Detailed final focused/native results are in the verification record.
- Final focused suite54 tests passed; native Python8 passed. Development/store package verification passed. All task-specific checks are complete; the unrelated shared-tree network failure remains explicitly reported.
