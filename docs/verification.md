# Verification

Run checks from the project root with Node.js 24. No historical evidence folder or package installation is required for the core suite.

```powershell
node --test tests/*.test.mjs
node tools/checks/audit-localization.mjs
node tools/build/build-page-policy.mjs --check
node --expose-internals tools/checks/verify-project.mjs
node tools/checks/measure-debug-cost.mjs
```

Generated results belong in Git-ignored `artifacts/<run>/`. Set `MDOWNLOADER_ARTIFACTS` to a run name to group reports. `MDOWNLOADER_WRITE_EVIDENCE=1` retains integration-test media there; normal test runs do not retain media. Generated downloads, old checkout copies, and previous reports can be removed without changing runtime resources or test fixtures.

The documentation was reconciled on 2026-11-08 against local extension version **0.2.37**. The full suite passed **257 tests**, localization rendered **378 messages in each of 10 languages** with no missing references, project verification reported no failures and preserved all **73 cataloged files**, and the generated page policy matched. Detailed logging OFF checks reported zero lazy-detail evaluations, timers, messages, and storage writes. These are local verification results, not a claim of new installed-browser acceptance.

## Automated coverage

| Area | What the suite checks |
|---|---|
| Detection | URL/media classification, document and player ownership, source refresh, live candidates, valid HLS alternatives, preview/ad exclusion, and supported provider schemas |
| HLS/DASH | Playlist/index parsing, bounded resource access, scoped observed headers, parallel transfer/retry, codecs, initialization/ranges, live refresh, and independent jobs |
| HLS encryption | Four whole-segment methods; IV derivation; key rotation, including repeated key URIs; initialization key scope; clear/encrypted transitions; invalid keys/padding/GCM tags; host denial; observed-only response capture |
| Stop/save | Finite-stream routing, request cutoff, gaps, failed in-flight requests, short audio coverage, timeline overlap, parent cancellation separation, and partial filenames |
| Partial output | Frozen committed prefixes, concurrent reception, source/read lifetime, independent cancellation, and direct-file range/tail metadata |
| WebRTC | Descriptor/WSS-host validation, ownership, server profiles, worker-safe static imports, independent receiver lifecycle, source-tab loss, remote-track readiness, audio/video start ordering, ping/start timeout/cancel, ordered writes, snapshots, interruption, and byte limits |
| UI/state | Candidate actions, received bytes immediately above speed, native determinate/indeterminate values, manager-row button order/readiness, preview state, title/date-only naming for streams without original filenames, deletion, and settings defaults with explicit opt-out |
| Diagnostics | OFF-path lazy evaluation and side effects, bounded/throttled ON logging, settings propagation, and result-write races |

The retained local sample MP4 is used by real parser/remux integration tests. Clear and AES-128-encrypted fMP4 fixtures are exercised through full transfer, early stop/save, partial export, preview, and MP4 track/packet parsing. A packet/parser check does not establish audible playback or visual acceptance. Historical generated reports and downloads are not required fixtures.

`verify-project` checks JavaScript syntax, relative imports, local manual/website links, manifest entries, and the hashes of 73 retained asset/vendor/sample/screenshot files. Localization checks render every message across all ten catalogs. The policy check detects drift between the shared policy and its generated classic-script form.

Detailed-log cost checks use Node counters and a synthetic sink; they are not Chrome console benchmarks. The HTTP preview-server test uses persistent native HTTP connections, HEAD, Range, invalid ranges, method handling, and full-byte comparisons without retries. Closing-connection `ECONNRESET` was also reproduced against an independent memory response server in this Windows environment and is not claimed fixed.

## Existing real-source results

These results are retained from earlier verification during development. They establish the scopes below; repository cleanup does not repeat them or promote them to acceptance of every current browser path.

| Check | Observed result | Scope and limitation |
|---|---|---|
| Two user-provided AES-128 HLS VODs | 1,028/1,028 and 1,304/1,304 segments; MP4 durations 2,055.623s and 3,910.255s; all H.264/AAC packets parsed | Real source requests through the transfer/remux modules in Node, not a click through the installed extension. Temporary media was 724,703,152 and 2,826,558,568 bytes. |
| HLS stop/save row | Correct ready/disabled controls and click routing at 434px width | Actual row/styles with Chrome API substitutes, not the installed extension. |
| WebRTC quality, 0.2.29 | The user confirmed that Shift+Download opens the quality chooser after reloading | This confirmation did not cover every selected quality's final saved file. |
| Independent WebRTC receiver, 0.2.30 | An installed-extension job received data; the user confirmed that WebRTC and HLS downloads continued after closing the source tab | Source-tab continuity is user-observed; an automated before/after byte timeline was not collected. Artificial connection-loss acceptance was covered by regressions rather than disrupting that live download. |
| WebRTC audio start fix, 0.2.31 | A real-source module run saved 6,186,412 bytes with AVC video 8.237s and AAC audio 8.149s; decoded stereo audio RMS 0.08521, peak 0.27271 | The corrected receiver module ran with native page APIs. The stored file's tracks/durations were re-read; the current installed offscreen-to-manager flow was not revalidated by that run. |

Revision history and superseded implementation steps remain in local Git history. The manuals and [Development](development.md) describe the current behavior. Regenerate test reports instead of requiring past temporary folders in a fresh checkout.

The current independent receiver initializes remote audio through an owned hidden, muted media element. Initialization, suppression of speaker playback, and cleanup are regression-tested. A newly saved file from the current installed offscreen-to-manager path remains a separate browser acceptance check; the earlier 0.2.31 page-module result above does not establish it.

## Current UI verification

The actual manager component and styles were rendered in a local Chromium fixture with Chrome API substitutes. This did not reload or operate the installed extension.

| Display | Observed result |
|---|---|
| Received bytes and speed | Two lines in one rounded box, matching the popup reference at both 434px and 320px viewport widths |
| Text and dimensions | Both surfaces: 11px text, 13.2px line height, 12ch preferred width, 2px/6px padding, 1px border, and 6px corners. Measured boxes: 72.703125 × 32.375 CSS pixels, with no clipped metric text |
| Colors | Received bytes `#b1d9ff`; speed `#b9c2cf`; canceled text `#76f5b6` in a rounded status badge |
| Progress | Native 8px bar below the row, without an overlaid byte label; finite, live, and waiting states retained |
| Actions | Cancel → Save received portion → Stop and save; ready/disabled controls and click routing checked in the fixture |

The row fixture includes a popup-style reference measure to make later dimension comparisons reproducible.

## Optional local checks

```powershell
node tools/dev/preview-options.mjs
node tools/dev/preview-job-actions.mjs
node website/serve.mjs
```

The preview tools bind to loopback and print their URLs. They use the real UI modules with Chrome API substitutes and do not control an installed extension. Website/capture commands require a separately configured browser/automation module; see [Development](development.md).

For an accessible finite HLS **media** playlist:

```powershell
node tools/checks/verify-encrypted-hls.mjs <https-media-playlist-url>
```

The command downloads the first three segments and verifies an MP4. Add `--full` for the complete VOD. It writes output and a report under `artifacts/<run>/` without raw keys or source URLs in the report. It does not establish browser host permissions, storage quota, or installed-extension behavior.

## Installed-browser acceptance

Check the changed extension in its intended Chrome/Edge profile when browser testing is authorized:

1. Popup, manager, site permissions, previews, and HLS/WebRTC quality selection.
2. Concurrent transfers, source-tab closure, received bytes/speed, cancellation, current-save, and stop/save.
3. Encrypted HLS, separate audio, WebRTC audio/video tracks, and abnormal connection-loss reporting.
4. Browser and picked-folder output, completed-file actions, and WebM fallback where applicable.
5. Diagnostic ON/OFF propagation across UI, worker, and offscreen contexts.

Large WebRTC recordings, picked-folder end-to-end saving, WebM live-source acceptance, crash recovery, and universal site/codec support have not been established. Automatic interrupted-recording recovery is not implemented. Finish active downloads before intentionally reloading the extension. Respect browser access restrictions; fixture and Node checks do not replace native acceptance.

## Retained asset provenance

Manual/website screenshots are existing real captures, not newly captured screens of every current control. Their language, version, date, and hashes are in `website/assets/screenshots/catalog.json`. Icon originals, baselines, prompts, processing metadata, and retained visual reviews are in `assets/catalog.json`. Repository cleanup preserves those bytes and does not claim new art or retouch acceptance.
