# Naver Clip Detection Implementation Plan

**Goal:** Detect the current public Naver Clip even when its player only requests TS segments from an embedded JSON playback description.

**Design:** Read the public card API for the media ID in the current Naver Clip URL, in the permitted document's isolated world. Validate the response's card identity and extract complete progressive MP4 representations. Reuse the existing direct-file candidate, copy-link and download flow, with one clearly named candidate per resolution, highest first. HLS synthesis and changing the site's player are unnecessary because this API already supplies complete MP4 files.

**Scope:** `m.naver.com/shorts/` and `clip.naver.com/contents`, `serviceType=CLIP` (or omitted), valid `seedMediaId`/`mediaId`. No new permissions, dependencies, UI controls, store publication or push.

**Files:** Add `extension/lib/naver-clip.js`, `tests/naver-clip.test.mjs`, and a reproducible isolated Chrome probe. Integrate the provider through a small additive change in `extension/detection.js`.

**Constraints:** Preserve the existing dirty checkout. Never relax generic TS/Blob detection or inspect arbitrary JSON responses. Fetch public metadata without cookies, with a timeout and byte limit. Keep signed URLs only in the existing session/candidate lifecycle and bounded worker memory; omit query strings from evidence. Require an unambiguous visible player and recheck page, player and source after asynchronous reads. Validate document identity and current page again when using cached results.

## Task 1: provider and integration (TDD)

- [x] Add failing tests for current-card MP4 detection and resolution order; exclusion of recommendations, HLS/CMAF and unrelated sites; malformed/forbidden metadata; unsafe URLs; page/player changes; response limits; caching and permission/document boundaries.
- [x] Run the new tests and observe the missing provider/integration failures.
- [x] Implement `IdentifyNaverClipPage`, `ParseNaverClip`, `ReadNaverClipPage`, and `DiscoverNaverClip` in the new module, using existing runtime limits. Call the provider from `FindMedia` without changing generic detection.
- [x] Run the new tests and the existing detection/network tests.

## Task 2: browser and regression verification

- [x] Load an isolated extension copy in Chrome; promote only the two Naver page hosts in the test manifest to avoid an interactive optional-permission prompt. Leave the production manifest unchanged and scan the supplied real URL through the extension's own `Scan` function.
- [x] Confirm the current clip's three resolutions, repeated-scan stability, navigation to another clip, old-candidate rejection, and no foreign/recommended clip leakage. Verify an actual direct MP4 download through the existing job flow and inspect the saved media.
- [x] Run the full unit suite and project checks, review the final scoped diff, and record results/limitations in a verification document. Do not claim failures caused by concurrent/unrelated work as fixed.

## Execution notes

- Baseline: 36 network/selected-HLS/native-HLS/CHZZK tests pass before edits.
- The user explicitly requested implementation after the preceding diagnosis; proceed with the established public-API extraction scope.
- Native inline execution; no new worktree because the current uncommitted implementation is the integration baseline. No commits mixing pre-existing changes.
- Modern Web Guidance: reviewed `security` and `deprioritize-background-fetches`; apply bounded validation, credential omission and low-priority metadata reads.
- Final evidence: `docs/naver-clip-detection-verification-2026-11-09.md`; isolated Chrome probe passed. Optional desktop-route playback was unavailable due to the site's own error page and is explicitly unverified.
