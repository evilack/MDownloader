# Verification and acceptance

This is the maintained validation reference for the current source. Counts describe the recorded run, not every platform, site or installed copy. Run outputs belong in ignored artifacts; executable regression tests, fixtures, provenance and licenses remain in the repository.

## Repository cleanup baseline

The starting checkpoint is af183384fa1e3bb151ff12348d01c3a616554e43 on codex/youtube-distribution-probe. It preserves the existing project edits before cleanup, including earlier source changes and document removals. Unowned .superpowers scratch review copies, local state, downloaded media and temporary outputs were excluded. No history was amended or rewritten.

Before product edits, the project checker passed: 444 JavaScript files, 26 JSON files, 1,072 relative imports, 163 local references and 97 preserved hashes, with zero failures. The unbounded full test command stalled in local-captions-service and stream-transfer. Running the other files separately recorded 816 tests: 781 passed, 34 failed, one external-network test skipped. A separate bounded attempt reproduced the old service fixture failures; it still retained pending fixture loops. These are pre-cleanup failures, not a successful baseline.

The service fake omitted session storage; transfer fakes omitted FileSystemFileHandle.getFile(); the common-helper fake reported package 4 while requesting the current package. Repairing these fixtures preserves their original cancellation, partial-save, connection and installation assertions. Service handoff waits now fail with a bounded deadline rather than keeping the runner alive. The focused fixture suite passes 44 tests. Product behavior was not changed to satisfy the fakes.

The new caption WAV tests check exact interchange bytes, offset typed-array views, each header field, truncation and sample-rate mismatch. The combined WAV/execution/seam/word-boundary suite passes 35 tests. The flexible RIFF parser retains its broader accepted format. Ten-catalog parity passes after restoring five missing search-pane resize messages in eight locales; placeholders remain identical.

## Commands and current results

Run from the project root with Node.js 24. Use bounded test runs when diagnosing a hanging fixture:

`node --test --test-timeout=90000 tests/*.test.mjs`

The final bounded run completed in about 30 seconds: **855 tests, 823 passed, 31 failed, one skipped**. Every remaining failed test name is present in the pre-cleanup baseline. The reduced failure count reflects repaired fixtures and missing locale resources; no failing tests were deleted or skipped. This is not a green repository.

Final project verification: **445 JavaScript, 28 JSON, 1,067 relative imports, 175 local references, 97 preserved hashes; zero failures**. Coverage now includes native documents/scripts, root AGENTS and manifest sandbox/content-script entries. Both policy generation checking and the YouTube bundle build pass; rebuilding the pinned vendor bundles produces no vendor diff. Both flavor packages pass distribution checks: development **282 files / 727 imports**, chrome-store **257 files / 680 imports**.

Independent **Chrome 157.0.8103.39** loaded the generated Store package, completed a real loopback MP4 download of **232,992 bytes**, rejected six prohibited YouTube operations and blocked a redirected prohibited request with **zero media bytes**. Its extension-scoped rule did not match a normal page's request. The production Download options browser fixture also passed both Document-popup inline and Element/split-panel modal roots, including cancel, no horizontal overflow and zero unwanted downloads. The UI fixture uses synthetic transport; it is separate from the real extension/package check.

The website preview was rebuilt from 63 source files. The generated website development ZIP contains 284 files; generation checks archive CRC and every file against the selected source bytes. It is a product-site distribution resource for the existing download link, not a user media result or published release. No private host registration, local state, logs, caches or models are included.

The logging benchmark reports zero detail evaluation, clock/sink/serialization/storage/message/timer/observer/stack work on its disabled path; 500,000 enabled burst calls evaluated/output/serialized once. These are synthetic counters for existing behavior, not a new measured runtime speedup from cleanup.

| Check | What it establishes |
|---|---|
| Full Node suite | Deterministic application contracts, media fixtures, isolated native/package regressions; an opt-in live subtitle source stays skipped. |
| verify-project | Syntax, imports, local links, manifest paths, icon coverage and unchanged asset/vendor/sample/screenshot hashes. |
| audit-localization | Static message-key coverage, ten-catalog parity and placeholder rendering; raw internal error codes can also appear as candidates. |
| build-page-policy --check | Generated main-world source guards match their source policy. |
| build-youtube | Reproducible pinned vendor bundles and recorded lockfile/output hashes. |
| package-extension + verify-distribution | Both independent flavor outputs, their resources and physical Store exclusion. |
| measure-debug-cost | Synthetic Node counters for logging off-path work, burst throttling and bounded local log writes. It is not a real-browser performance benchmark. |
| Independent Chrome checks | Actual manifest loading, production UI and loopback media operations in separate profiles; no reload of the user's source installation. |

## Known existing failures

The remaining full-suite failures were reproduced before cleanup. They include stale Download options language-picker/summary fixtures, helper setup/removal fixtures, HLS discontinuity metadata expectations, startup/recovery and recording-MIME mocks, settings/filename expectations, translation-model UI doubles and old YouTube caption-mux responsibility expectations. Original-subtitle tests also disagree with current explicit-translation failure policy. Those assertions were retained; product policy was not changed or tests skipped to make cleanup appear green.

The standalone localization audit also detects absent stream-capture/remux error message keys and a dynamic issue_report_ prefix that its literal matcher treats as a full key. Catalog parity and placeholder checks pass independently, but this does not make the audit successful. Missing user-visible localization and audit false positives require separate owning-source work; do not hide them with a broad ignore list.

Exact failing test names and stack traces are in artifacts/repository-cleanup/final-tests.log; baseline-other-tests.log and baseline-stalled-tests.log distinguish their original state. Raw logs are generated locally and not packaged as product documentation.

## Actual-use boundaries

Cleanup uses an independent Chrome profile and synthetic loopback media. It does not restart, update, unregister or reinstall the user's connected helpers, change models/defaults, send issue reports, call paid translation providers, or download live account content. Source refactoring and payload generation do not establish native installation or ASR correctness.

Earlier reports recorded successful Windows common-helper feature setup, bounded VOD/HLS/WebRTC downloads and local generated outputs. The latest prior package-10 WebRTC check recorded an 86.36-second windowed capture with selectable mov_text captions and two display-time warnings, without fallback. These historical observations were consolidated from the removed dated reports; they were not repeated by cleanup and do not establish long-running accuracy or universal site support. Checkpoint Git history preserves their full chronology.

Actual macOS JXA/Foundation/PKG installation and recognition, live PotPlayer credential import, initial browser-to-OS common-helper bootstrap completion, all codecs/sites and multihour broadcasts remain outside this run. Existing helper acceptance requires actual authenticated native calls, failure/cancel/conflict tests, real child termination and a new nested feature module on an unchanged common body. The retained isolated tests cover these execution contracts without modifying a real user registration.

## Documentation and retained resources

The English/Korean manuals own install and quick-start flow; media-guide owns detailed formats, settings/data/removal; development owns architecture and commands; platform README files own specific helper contracts. Superseded dated reports, completed/rolled-back plans and redundant rollback evidence are removed after integrating current boundaries. They remain recoverable from the checkpoint. No archive folder is introduced.

Runtime icons, original artwork, resizing baselines, retouch variants, prompts, hash catalogs, upstream licenses, sample media and real captured screens are retained. Their different sizes/themes/languages and provenance are required inputs rather than accidental duplicates. Standalone source/tests/tools with uncertain future use are retained; for example the YouTube direct-file receiver has its own meaningful regression tests although the active provider currently uses SABR.
