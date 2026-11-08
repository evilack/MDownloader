# Verification

## YouTube distribution gate — 2026-11-08

Current distribution correction: development is the manual/unpacked build; chrome-store is the only other build. The old manual/development report labels below record an earlier mistaken duplicate. They are retained as historical evidence, not current distribution choices.

Task 1 introduced build-time development/manual/store policies and layered source/transfer guards. Baseline was commit `2c96967`, version `0.2.37`, 257 passing tests. The initial policy/package/enforcement additions raised the suite to 265 passing tests. All ten catalogs have 380 messages and no missing references. This does not establish YouTube extraction or saving.

Actual installed Chrome **157.0.8103.39**, headless unpacked in an isolated profile, loaded the generated store package. Six explicit YouTube direct/request/source/playback cases refused with `youtube_distribution_disabled` after stored settings attempted to enable YouTube. An ordinary loopback MP4 saved completely (**232,992 bytes**, one content response). A loopback redirect to googlevideo stopped with **FILE_BLOCKED**, **0 bytes**; DNR matched extension-origin requests and did not match normal YouTube page playback. Report: ignored `artifacts/youtube-implementation/native-1794130425865/result.json`. These are native automated browser checks, not visual acceptance, real YouTube download success or Chrome Store approval.

### Task 2 native result — 2026-11-08

**Native YouTube receive/save gate failed; YouTube download support is not accepted.** Testing used the user-specified [public VOD](https://www.youtube.com/watch?v=-XHx839rSc8), actual Chrome 157.0.8103.39, fresh profiles and the unmodified generated `manual` and `development` packages. Computer Use was not used. Reports are retained as [manual evidence](evidence/2026-11-08-youtube-manual.json) and [development evidence](evidence/2026-11-08-youtube-development.json).

| Step | Observed result in both packages |
|---|---|
| Optional host activation | `youtube.com`, `www.youtube.com` and `youtubei.googleapis.com` approved in the test profile, then activated by real `chrome.permissions.request()`; no broad host grant |
| Normal public watch page | HTTP 200, `playabilityStatus=OK`; 34 adaptive format metadata records, 0 direct URLs, 0 cipher URLs, SABR URL present |
| Offscreen session/player script GET | HTTP 200 |
| Offscreen WEB config/player POST | HTTP 403, response matched the fixed `automated`/`bot` markers; raw response was not logged |
| Client error | `youtube_automated_request_rejected`; no alternate-client cycling, PO-token generation or login/DRM bypass |
| Interpreter | Simple script passed; infinite loop terminated after the 2-second limit; fetch, Chrome API and native Function-constructor probes refused |
| Video/audio receive and saved output | **Not attempted: no supported resolved media source; 0 media bytes and no YouTube output file** |

The two failures are separate observations: the automated API rejected this extension-origin request, and the ordinary page response did not contain direct file sources supported by the initial adapter. Neither establishes that the video itself is restricted or that all future Chrome approaches are impossible. SABR/UMP remains outside the initial implementation scope. UI, selection, transfer, merge, source-tab-close reception and stop/partial-save integration were not enabled.

The local suite passed 274 tests after adding the fixture/error cases (including unrelated HLS changes already present in this shared checkout). YouTube-specific fixtures cover URL-free metadata, exact selection, permission denial/revocation, expiry, restricted/DRM/SABR responses including URL-less format records, interpreter limits and redacted automated-request failure. Fixture success does not establish media reception. All ten language catalogs now contain 394 messages with no missing references. A separate read-only code review found no blocking scoped issue and confirmed the probe is a diagnostic, not a positive receive/save gate.

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

## SABR/UMP expansion — 2026-11-08

The user expanded scope to SABR/UMP and requested development-only browser verification. No Computer Use, store browser run, external downloader, proxy or generated/forged token was used. [Retained native evidence](evidence/2026-11-08-youtube-sabr-development.json) comes from actual Chrome 157.0.8103.39 and the same VOD -XHx839rSc8 (623 seconds).

| Check | Native observation |
|---|---|
| Same player API body from normal page | HTTP 200 |
| Same body from plain offscreen | HTTP 403, automated-request response |
| Offscreen plus the page Origin/Referer pair | HTTP 200; this pair/context is sufficient in the test, individual header causality not isolated |
| SABR/UMP with naturally observed playback token/config | Four HTTP 200 responses with protection pending (2), then rejection (3); no token mint/retry loop |
| Source test tab | Closed before independent offscreen reception |
| Received media | Video 305,162 bytes; audio 1,132,817 bytes |
| Partial MP4 | 1,278,495 bytes; 60.533 seconds; 1,816 video packets and 2,606 AAC packets |
| Native playback | 256×144 video frames decoded; stereo AAC decoded at 44,100 Hz, 1,024 sample frames, RMS 0.068686 |
| Complete 623-second download | **Not achieved: protection rejection; gatePassed=false** |

The browser reports its UUID-named download as complete; that only describes the partial output file. It ignored the requested title/date name in the automation environment. The original download is preserved and copied byte-for-byte into a named artifact; the report contains both names and the output SHA-256. No production browser filename acceptance is asserted. Product discovery/quality/manager integration remains disabled until complete reception and the production source-session relay are verified.

The new protocol/remux regression tests also cover bounded independent track writes, pending/rejected attestation, incomplete-output commit policy, and differing video/audio start timestamps. The two last cases reproduced review findings RED before their fixes. Source exclusion remains checked statically by the package tests; only development was run in Chrome in this expansion.

Final staged-candidate verification: 277 Node tests passed, 398 messages in each of 10 catalogs with no missing references, generated page policy matched, project verification had zero failures and preserved all 73 retained files. Package tests checked development/store composition and rejected the removed manual flavor. Only development was loaded in Chrome. The exact staged source reproduced the 60.533-second partial save/decode and the full-reception attestation rejection; it excludes concurrent naming/subtitle/HLS changes.

## yt-dlp comparison — 2026-11-08

The user subsequently requested yt-dlp investigation. This supersedes the earlier no-external-extractor boundary **for the experiment**, while preserving development-only browser tests, no Computer Use, no proxy/token generation and permanent store exclusion. YTVD 1.4 was inspected read-only at the user-provided installation path: its extension calls a server for formats/download/progress; the server implementation and use of yt-dlp remain unverified.

| Check | Observation |
|---|---|
| Official temporary executable | yt-dlp 2026.10.26, 23,575,744 bytes, SHA-256 `f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d`; official asset digest/SHA256SUMS matched |
| Selected source | Same video `-XHx839rSc8`, format 18, H.264/AAC muxed MP4, 640×360, no FFmpeg needed for this format |
| Native Chrome direct successful run | Chrome 157.0.8103.39, full 30,185,697 bytes, eight HTTP 206 ranges, OPFS and browser save |
| Parsed full source | 622.689524 seconds; YouTube's integer-rounded display is 623 seconds; declared source duration 622.689 |
| Every encoded packet inspected | Video 18,677 packets, end 622.566667; audio 26,817 packets, end 622.689524 |
| Decode at 1 and 620 seconds | Video 640×360; AAC stereo 44,100 Hz, 1,024 frames/sample; RMS 0.013904 and 0.051983 |
| Complete-file SHA-256 | `6718534d9e36a3128210b07fd6522d44328a63366342d369b33b514a26f60fd3`; matches the independently yt-dlp-received full file |
| Other freshly extracted sessions | Direct Node and Chrome requests returned HTTP 403, including matched extractor headers; successful extraction alone is insufficient |
| SABR diagnosis refinement | A normal page HTTP 200 response itself contained UMP protection status 3 and no media header; the 90-byte token was not evidence of accepted full playback |
| Integration boundary | No Native Messaging registration/permission, permanent helper, YTVD service credential reuse or product UI enablement |

Both successful whole-file native runs (including the exact final staged candidate) are preserved alongside failures in [retained evidence](evidence/2026-11-08-youtube-ytdlp-development.json). Browser automation still saves a UUID filename; the original and byte-identical title/date export are both retained. This verifies complete source bytes and actual Chrome decode/save, not 623 seconds of real-time viewing or production filename behavior. It establishes a working yt-dlp-assisted route for this video, while repeated 403 sessions leave reliability and the exact server-side eligibility cause unresolved. The browser-only SABR route still fails its full-reception gate. See the [native helper implementation decision](superpowers/plans/2026-11-08-youtube-ytdlp.md).

## Subtitle inclusion verification — 2026-11-08

The subtitle implementation was already present in the shared working tree when the supplied XVideos subtitle omission was investigated again. It was verified in place without replacing concurrent changes. The supplied page declares captions separately from its video sources; saving only a media URL does not include those external captions.

`node tools/checks/probe-subtitles.mjs` fetched the supplied page and all 23 declared caption resources successfully. The production discovery/conversion/mux modules embedded every language into the synthetic ten-second sample AV file. An independent MP4 box reader found 23 `wvtt` subtitle tracks plus the original video and audio tracks, with retained language and label metadata. Discovery used a DOM fixture populated from live HTML; this is not an installed-browser test or a download of the complete original video.

The Node suite reported 344 tests: 343 passed, zero failed, and one opt-in live test skipped; the separate live caption probe above passed. The offscreen-runner regression verifies direct transfer and concurrent partial saving with every prepared language. Project syntax/import/reference checks passed with zero failures, all 73 retained files preserved, and localization checks found no missing references across ten catalogs.

To use the current source, finish active downloads, reload the extension loaded from this repository's `extension/` folder, refresh the source page, and create a new download. Previously saved files are not modified. Native installed-extension full-video save and subtitle rendering in a user's playback application remain unverified; selectable MP4 WebVTT support depends on that application.

Final yt-dlp candidate checks: **280 tests passed, zero failed**; all 398 messages in each of 10 catalogs matched; generated page policy matched; project verification reported zero failures and preserved 73 retained files; development/store package composition passed. Independent review found three defects (multipart source identity, response cleanup, whole-file hashing memory); RED→GREEN tests and streamed hashing resolved them, and re-review found no remaining important findings. The final staged candidate repeated the full direct Chrome receive/decode/save with the same SHA-256. Concurrent naming/subtitle/HLS changes are excluded.

## Browser-only SABR completion — 2026-11-08

The latest user-selected direction uses only official youtubei.js 18.3.0, googlevideo 5.0.1 SABR/UMP and existing Mediabunny 1.65.2 inside the development extension. No yt-dlp/FFmpeg process, installed helper, external download server, Computer Use or store browser run was used. Distube ytdl-core was read as a reference only.

The official browser example is marked outdated and points to the newer SABR example. Comparing that example identified two separate defects: the local Jinter adapter treated a function body with a final return as a normal script and did not match the current player execution semantics; and the receiver compared an integer-rounded 623-second page duration against exact track ends. The default evaluator is now an opaque sandbox plus a bounded one-shot worker, and completion uses each selected format duration. The explicit production SABR client verifies WEB public playability and uses the upstream VISIONOS constants, then deciphers the streaming URL.

The normal public WEB player itself stalled at about 60 seconds and returned protocol protection 3, even in headed Chrome. Homepage warm-up produced integrity HTTP 200 but did not prevent rejection. These observations locate the WEB failure before independent reception; they do not reveal every server-side rejection criterion. In the working VISIONOS SABR session every protection update was approved (1), without forwarding the rejected WEB token or adding a token-mint callback.

| Native check | Result |
|---|---|
| Video | Same `-XHx839rSc8`, 640×360 H.264, 8,432,390 received bytes |
| Audio | Exact selected AAC format 139, 3,798,832 received bytes |
| Received track ends | Video 622.567s; audio 622.853s |
| Complete-tail MP4 | 12,184,692 bytes; 622.852063s (rounds to displayed 623s) |
| All saved packets | 18,677 video; 13,412 audio, including audio beyond the last video frame |
| Decode | Video 640×360 and 2,048-frame audio samples at 1s and 620s; nonzero audio RMS |
| Actual browser save | Chrome downloads reports complete; disk byte count matches remux output; SHA-256 recorded |
| Sandbox boundary | Privileged-page eval denied, blocked globals absent, infinite-loop timeout, subsequent evaluation recovers, no retained evaluation frames |

[Retained browser-only evidence](evidence/2026-11-08-youtube-browser-only.json) separates native success, negative WEB diagnostics and automated checks. Browser automation still uses a UUID download name; the original and byte-identical title/date export are retained. The test verifies complete bytes/packet timelines and first/tail decoding, not real-time viewing of every frame, all clients/resolutions or product filename acceptance.

Product discovery/manager UI remains gated pending its production permission/header/job integration; this full-reception proof does not claim that UI integration or store publication. The [separate YouTube.js change log](youtube-upstream-changes.md) identifies official pins, MDownloader-owned changes, unchanged upstream source, examples and required upgrade checks.

Final browser-only scoped candidate: **292 tests passed, zero failed**; all ten catalogs contain 398 messages with zero missing references; generated policy matched; project checks had zero failures and preserved 73 files; development/store physical composition and import graphs passed. The exact staged candidate repeated native full reception, complete-tail save and both-track decoding. Independent review's duplicate-itag identity finding and additional prototype/disposal regressions were fixed RED→GREEN. An inspector-listed worker descriptor was checked and its runtime session was already closed; the report does not claim zero inspector descriptors.

## YouTube UI integration — 2026-11-09

The development build is the manual/unpacked build. In actual Chrome **157.0.8103.39**, isolated profiles opened the native side panel and used the normal candidate/download controls. The first implementation failed because its SW provider dynamically imported a module; Chrome explicitly rejected that operation. The worker entry now uses static imports with a regression check. A subsequent harness-only normal-click attempt clicked while the canceled dialog's button was still disabled; waiting for its enabled state corrected the test. All negative runs are retained in [redacted UI evidence](evidence/2026-11-09-youtube-ui-development.json).

| Native UI acceptance | Shift-selected 360p | Normal-click automatic best 1080p |
|---|---:|---:|
| Manager | active → complete | active → complete |
| Video received | 8,432,390 bytes | 82,318,558 bytes |
| AAC received | 10,078,363 bytes | 10,078,363 bytes |
| Received track ends | video 622.567s / audio 622.690s | video 622.567s / audio 622.690s |
| Saved MP4 | 18,464,219 bytes | 92,344,267 bytes |
| Actual saved duration | 622.689524s, rounds to displayed 623s | 622.689524s, rounds to displayed 623s |
| All disk-file packets | 18,677 video / 26,817 AAC | 18,677 video / 26,817 AAC |
| Decoded saved-file samples | 1s / 620s, 640×360, nonzero AAC RMS | 1s / 620s, 1920×1080, nonzero AAC RMS |
| SHA-256 | d6d49b4df3870186cfe0d793a674f3ccbbdc5ce634a7dcc329d6073929704752 | de469d848a19f967d19a71322d0d1a45ecc2430453b745fbd9b3590cd97f1a13 |

The job uses youtube:true and hls:false. Local/session storage contain no signed googlevideo source or Ustreamer config, and the scoped API header rule is removed. The exact underlying audio variant differs from the earlier lower-bitrate browser-library proof; format identity remains selected by exact index. The complete longer audio tail is retained.

Computer Use, the user's Chrome profile, yt-dlp, an FFmpeg executable, an external download server and Store browser execution were excluded. The probe approves only exact API/CDN origins in its own test profile, so it does not establish manual OS permission-dialog acceptance. Chrome automation saves a UUID filename; the original native download and byte-identical requested-title export are both retained. This proves whole-source bytes, native save and decoded samples, not production filename acceptance or real-time viewing of every frame. No claim is made for all videos/languages/resolutions, live/DRM/restricted sources, Store review or public release. The earlier public-WEB protection rejection remains independently documented.

Independent review found and fixed two important issues RED→GREEN: a first normal click now hands a new CDN permission to the existing dialog's direct confirm gesture, keeping automatic best quality selected; pending progress writes finish before a cancel/failure report so they cannot restore an active state afterward. The reviewed implementation repeated the full native 1080p receive/save, including the first-use permission handoff. Optional-host OS prompts are still preapproved by the harness, not manually accepted.

Automated scoped checks: 302 tests passed, zero failed; ten catalogs contain 399 messages each, no missing references. Development/Store package composition and import graphs are checked separately from browser acceptance. Official upstream packages/bundles remain unchanged; MDownloader-only integration and upgrade checks are recorded in [YouTube.js changes](youtube-upstream-changes.md). Shared picked-folder save is connected but was not separately native-tested here; this acceptance is for Chrome native downloads.

The exact staged extension tree `03b1a1f7d3ed3c45d4bed4813e8f030819402db1` repeated native automatic-best-quality full reception/save and disk-file decoding after review fixes. Final scoped candidate: 302/302 tests; 399 messages × 10 locales; zero project failures, 73 preserved files; development 159 files/366 imports and Store 135 files/338 imports verified. The separately merged working folder, including pre-existing subtitle/translation changes outside this commit, passed 382 tests, skipped one supplied-HTML fixture, and had zero failures.

## YouTube captions — 2026-11-09

Actual development/manual Chrome 157.0.8103.39, a fresh isolated profile and the normal side-panel download UI saved the same -XHx839rSc8 VOD with all available original captions. English and Korean automatic-caption responses were HTTP 200, nonempty WebVTT. An initial isolated extraction inspection measured 110,632 and 89,654 UTF-8 bytes respectively. No synthetic captions or injected cue text were used for native acceptance.

| Native same-video acceptance | Result |
|---|---|
| Original caption cues | English 645 / Korean 545 |
| Saved subtitle tracks | 2, sbtl handler and tx3g/mov_text sample entry |
| MP4 language codes | eng / kor |
| Saved timed-text samples | English 646 (644 nonempty) / Korean 546 (545 nonempty) |
| Saved caption intervals | English 1.888–622.300s / Korean 2.080–622.320s |
| Caption equality | Both full text hashes and every nonempty cue's text/start/end timeline hash match independent MP4 extraction |
| Complete AV | 1920×1080 H.264 and AAC, 622.689524s (displayed 623s), 18,677 video / 26,817 AAC packets |
| Decode actual saved file | Video/audio at 1s and 620s, nonzero audio RMS |
| Native MP4 save | 92,736,458 bytes, Chrome complete, same disk byte count |
| Privacy | No caption URL/body, signed media URL or SABR config in local/session job storage; scoped API rule released |

The differing cue/sample counts include the initial empty interval and clearing text. Independent ISO BMFF sample-table inspection reads the actual saved file, not the muxer's internal result. Same-video ASR cues are nonoverlapping; arbitrary overlapping source cues become composited samples and are covered by separate shared mux tests, not this direct timeline-hash comparison.

Two native failures exposed the common WebVTT splitter treating space-only payload lines as separators and rejecting empty cues. Regression tests failed before the shared reader/mux corrections and passed afterward. A fresh reviewer found that a partial VISIONOS catalog replaced the WEB languages; union-by-identity now preserves the catalog and prefers only matching VISIONOS addresses, with RED→GREEN coverage. Source/session expiry and mux-failure/no-save ownership also have explicit tests.

A genuinely absent catalog is explicitly unavailable and may preserve normal AV downloading; this is not successful caption acceptance. Any declared track that fails receiving or muxing fails the job. This scoped interpretation preserves downloading of videos that never offered captions. No missing-caption execution substitutes for the two-track native proof above.

349 scoped tests passed; 404 messages × 10 locales, no missing references. Required shared subtitle modules and tests are included as integration dependencies; unrelated translation/UI changes remain outside the commit. Official upstream packages/bundles are unchanged. Small deferred review improvement: explicitly rejecting non-default HTTPS ports in caption URL normalization. The tested official sources use default HTTPS. Computer Use, user's Chrome profile, Store browser execution, external extractor/program installation and publication were excluded. Exact host permissions were preapproved in the test profile; this is not manual OS-prompt acceptance or external-player visual subtitle selection acceptance. Chrome automation saves a UUID filename; the original and byte-identical title export are retained. See [retained evidence](evidence/2026-11-09-youtube-captions-development.json) and [upstream changes](youtube-upstream-changes.md).

The exact staged extension tree `d6b6ba3ee8b778d003e9743608f87fb5c658ccb5` repeated full native UI caption receipt/mux/save and independent disk-file comparison after review. Final MP4 SHA-256: `c30e52f43c0e21f200b217051b5da4712050555d2ecd29d9320425fed3ae3d63`. Final scoped checks: 349/349 tests, 404 messages × 10 locales, zero project failures and 73 preserved files; development 163 files/375 imports, Store 138 files/343 imports. The separately merged working folder passed 395 tests, skipped one retained supplied-HTML fixture, and failed zero tests.

## Automatic caption option — 2026-11-09

The original same-video English/Korean captions are marked `kind: asr`, so automatic caption downloads are supported and can be filtered independently. Settings → Download settings now includes **Include automatically generated captions** (Korean: 자동 생성 자막 포함), default enabled. Disabling it preserves creator-provided/manual captions and affects newly registered YouTube jobs. Store builds hide/disable this control and retain fixed YouTube exclusion.

| Actual development Chrome same-video check | Include (default) | Exclude |
|---|---:|---:|
| Options UI after reload | Checked | Unchecked |
| Captured job setting | true | false |
| Caption HTTP responses | 2 | 0 |
| Saved MP4 subtitle tracks | 2, eng/kor tx3g | 0 |
| Saved file bytes | 92,736,458 | 92,344,267 |
| Full AV duration | 622.689524s | 622.689524s |
| Video/audio decode | 1s and 620s passed | 1s and 620s passed |

Native runs used separate actual Chrome 157.0.8103.39 development profiles, the real options checkbox and reload persistence, then the normal side-panel download UI and independent saved-MP4 inspection. Both saved complete 1080p/AAC media. Include matched every original nonempty subtitle cue's text/time hash. Exclude made no caption HTTP request and wrote no subtitle track. No Computer Use, user's profile or Store browser run was used. The first harness attempt raced its own reload against the locale-change reload; waiting for the localized ready page corrected that harness issue. [Retained option evidence](evidence/2026-11-09-youtube-auto-caption-option.json) includes that failure and successful runs.

The target has only automatic captions. Mixed manual+ASR preservation, exclusion before expired unselected ASR validation, default/persistence and boolean validation are unit-tested; manual preservation is not presented as a native mixed-catalog test. No separate automatic-translation feature is implied. Settings are captured when a job is queued, so running downloads retain their selection. Scoped suite: 351 passing tests; 406 messages × 10 locales with no missing references.

The exact staged extension tree `f282a5e66b5ef4ce136e432299232e6ad250680c` repeated both native ON/OFF saves successfully. Final scoped checks: 351/351 tests; 406 messages × 10 locales; zero project failures and 73 preserved files; development 163 files/376 imports and Store 138 files/344 imports verified. The separately merged working folder passed 397 tests, skipped one supplied-HTML fixture, and failed zero. Fresh review had no Critical/Important findings. Deferred Minor: when automatic captions are excluded, receipts do not distinguish an originally empty catalog from one emptied by filtering; actual selection/download behavior is correct.

## YouTube hover preview — 2026-11-09

The supplied video FACJInvEmY8 reproduced the reported failure in actual development Chrome 157.0.8103.39: the source video was playing and advancing, while the hover showed a still image, no video element, and the failed marker. Both UI and service-worker capture gates excluded YOUTUBE. The canonical watch URL correctly was not a direct playable media URL; the missing connection was the existing page-frame clip path.

The fix connects YouTube candidates to the bounded shared canvas-copy preview. The worker revalidates the current scan, exact document, canonical video identity and unique provider candidate. A page-player hint may select only one visible decoded player in that top-level document. Recording continually checks document URL, source URL, srcObject, ownership and eligible-player uniqueness; even a transient invalidation remains rejected. Only the newly created canvas tracks are stopped. The original player is not captured, paused, sought or reloaded by production preview code. Existing HLS/DASH association remains unchanged. Preview success requires actual playback, not a decoded still image.

A native fixed run decoded a 480×270 preview with frames 7→25 and time 0.086→0.6925s while source frames 5→115 and time 0.01768→3.688124s advanced. The source remained playing and no ad was present in the measured run. Normal close, fast pointer leave during capture, and navigation during capture left no open popover, preview player or loading indicator; late results did not reopen the hover. Exact final-candidate evidence is retained in [preview evidence](evidence/2026-11-09-youtube-preview-development.json).

Focused regressions cover YouTube capture dispatch, actual-playing state, ambiguous and child players, mismatched page/video identity, and recording-time transient page/source/object/owner/ambiguity changes with canvas-track cleanup. The transient test failed without sticky invalidation and passed with it. An independent review's test-gate omissions were strengthened: later playback failure, source ad state and remaining loading indicators cannot pass native acceptance. Scoped suite: 356 tests passed. The moving-frame capture contract requires a currently playing, readable, unprotected source; paused/DRM/unreadable sources are not claimed to produce a moving clip. This is a preview of the current page player, not an independently resolved download stream or proof for every video/ad transition.

Computer Use and the user's profile were excluded; a separate development profile used the actual side panel through CDP. Store behavior is checked through fixed source guards and physical package exclusion, not a Store browser run. Existing unrelated subtitle/translation/policy-notice work is preserved outside this commit.

Exact staged extension tree `7f658852beab56dca56176952e9959ede9b8413f` repeated the supplied-video proof: preview frames 7→25, source frames 5→121, failed=false, owned WebM clip 53,154 bytes, normal/fast-close/navigation each zero players/loading and closed popover. Final scoped checks: 356/356 tests; 406 messages × 10 locales, zero project failures and 73 preserved files; development 163 files/376 imports, Store 138 files/344 imports verified. The separately merged working folder passed 405 tests, skipped one supplied-HTML fixture, and failed zero.
# YouTube partial save and finish — 2026-11-09

Scope: development/manual Chrome only. Latest reported video https://www.youtube.com/watch?v=FACJInvEmY8. Existing manager buttons perform the real snapshot and finish requests; no direct receiver invocation starts either operation. Network throttling is confined to the isolated profile's offscreen receiver and makes both UI actions observable before natural completion.

First native run: Chrome 157.0.8103.39, 640×360 AVC/AAC. Snapshot saved 59.907483s (2,849,281 bytes); parent remained active and advanced from 3,081,888 to 5,178,610 received bytes. Finish saved 106.400000s (5,319,920 bytes). Both disk outputs decoded video and nonzero audio at 1s and near their last common packet. Independently parsed MP4 contains English/Korean sbtl/tx3g tracks; last nonempty subtitle ends were 59,907ms and 106,400ms, within each output duration. Parent/child active IDs and OPFS directories released after saves; persisted jobs/session contain no signed media URL, SABR config or caption source/body.

The actions export a playable received prefix; no pause/resume or arbitrary timeline seek is added. Available controls depend on committed AV data; finish is disabled before that point and actions disappear during muxing. Snapshot failure or cancellation is independent of the parent. Source website/server rejection behavior remains as previously documented. Store package is built/inspected for exclusion only, never run for this validation.

Final acceptance is recorded below.

Final exact-candidate run: extension tree `47b08ae5d204b6d514826d45f21a794651f09cea`, Chrome 157.0.8103.39. Snapshot: 59.907483s / 2,849,281 bytes. Finish: 99.845805s / 5,041,673 bytes. Both include English/Korean tx3g tracks ending at or before 59,907ms / 99,846ms (millisecond subtitle quantization). Parent reception continued from 3,081,888 to 5,178,610 bytes after snapshot; both native saves completed and all YouTube IDs/scratch released. Beginning/tail video decode and nonzero audio passed for both saved disk files. [Retained evidence](evidence/2026-11-09-youtube-partial-development.json); local outputs and screenshots under artifacts/youtube-partial/verified.

Regression: existing -XHx839rSc8 full 1080p download completed again from the exact same extension tree, 92,736,458 bytes / 622.689524s; complete AV packet coverage, head/tail decode and both caption tracks passed. Scoped suite 363/363; merged root 412 passed / 1 skipped / 0 failed. Project check 0 failures, 73 preserved files; 10 locales × 406 messages, 0 missing references; development 164 files/378 imports, Store 138/344 (inspection only). Fresh review's init-only readiness and picked-folder naming findings were reproduced RED and fixed GREEN. No remaining review finding.

# YouTube job preview repair — 2026-11-09

Actual development Chrome baseline on FACJInvEmY8: candidate hover decoded/advanced but download row had no image and failed hover. Registration skipped preview preparation, manager had no capture callback, and thumbnail cache was read once without source refresh.

After connection, same Chrome 157.0.8103.39/source/normal download flow: popup candidate frames 5→20, job frames 6→21; both 112×63 thumbnails decoded and used the same frame. Job thumbnail changed after the 15s refresh while source remained playing and download continued (3,243,603 bytes received). A new scan during the download did not break the pinned job capture. Navigation returned no clip; close left no popover/video/loading. Source acquisition is not a seekable independent downloaded-media preview: it uses the same currently playing, readable page-player contract as the popup. Cached last thumbnail can remain when source is gone; it must never switch to another video's player.

Final exact-candidate acceptance follows below.

Final exact-candidate run (extension tree `b4deda7a825bdd24ff4f6b22a16d99336917af72`): candidate decoded frames 7→22; active job frames 7→22. Both 112×63 stills decoded and were identical; job thumbnail changed after15s. Rescan did not break job capture, source time reached 28.453s while download remained active at 3,243,603 bytes. Navigation rejected new capture and close left popover=false, video=0, loading=0. [Evidence](evidence/2026-11-09-youtube-job-preview-development.json); screenshots retained under artifacts/youtube-job-preview/verified.

Checks: scoped suite366 passed; merged root415 passed/1 skipped/0 failed; project0 failures/73 preserved files; 10 locales×406 messages/0 missing references. Development165 files/379 imports and Store139/345 verified; Store browser not executed. Independent read-only review found no actionable defects and reran35 targeted tests. Original downloaded-media output validation is unchanged by this source-player UI repair; no new full-media claim is made here.

# Selected download location persistence — 2026-11-09

User clarified that selecting a folder works but Save location resets it to default. Reproduction confirms picker stores a directory key while clearing the relative input; submit used the empty input and erased the key. Fix preserves the selected key on confirmation. Explicit Use default location resets both fields atomically; a nonempty relative path switches to browser-subfolder mode. Access loss or settings-write failure does not clear the prior selection. The selected directory name is also shown in the input placeholder.

Native Chrome 157.0.8103.39 before fix: selection stored, confirm cleared it. After: select/confirm/reload/confirm preserved the same real IndexedDB directory handle. Explicit default reset and relative path save/reload passed. A real offscreen File System Access write saved a 232,992-byte MP4, then decoded 320×184 video and nonzero audio (10.031066s). Automation supplied an actual OPFS directory to the picker callback; it did not operate the native OS chooser or prove arbitrary external-folder grants. The changed behavior is the options selection state, not the file writer or YouTube receiver. No Computer Use; no Store browser execution.

Final scoped-candidate acceptance is recorded below.

Final exact-candidate acceptance: extension tree `1089d986ffe880a9123d26e977902bddb8e84976`, Chrome157.0.8103.39. Selected handle key survived select→save→reload→save; explicit default reset and relative path persistence passed. Native offscreen write/decode retained a232,992-byte MP4 (10.031066s,320×184,nonzero audio). [Evidence](evidence/2026-11-09-download-location-development.json), screenshots/artifact under artifacts/download-location/verified. Native OS chooser was not automated; only its return value was supplied with a real OPFS directory.

Checks:371 scoped tests passed; merged root420 passed/1 skipped/0 failed. Project0 failures/73 preserved files;10 locales×407 messages/0 missing references. Development165 files/379 imports; Store139/345, inspection only. Independent review reported no actionable findings and ran4 targeted tests; executor additionally covered a missing restored handle (5 targeted tests total). No downloader transport, upstream/vendor or Store exclusion change.

# Completed folder shortcut — 2026-11-09

**Superseded and rejected by the user:** this historical folder-list test did not satisfy Windows Explorer reveal. The custom listing and its route are removed by the correction below; its former acceptance does not apply to native Explorer.

Restored the existing completed/interrupted row folder icon for direct picked-folder writes, previously excluded by `!Job.pickedDownloadFolder`. Browser-managed jobs still call `chrome.downloads.show(downloadId)`. Direct File System Access writes have no Chrome download ID: their same icon opens a small read-only extension view of the pinned saved folder, highlights the saved media and offers a safe media-only browser link. It does not open Windows Explorer or pretend to call downloads.show for a nonexistent ID. The unwanted browser-default-settings button and handler were removed.

Native Chrome 157.0.8103.39 baseline lacked the icon. After: icon shown beside delete, its real click opened the registered folder view, saved.mp4 was highlighted, browser link decoded/played the real 320×184,10.031066s saved file. Test fixture is an actual OPFS directory/file plus a registered completed item; no OS picker/Explorer automation and no new full VOD download claim. Directory reads are limited to1000 entries, metadata comes from a valid registered completed job, read permission can be restored by gesture, only saved media is linked and arbitrary local HTML/scripts cannot execute through listing links. Blob URL is revoked on refresh/pagehide. Store guarded metadata route and original Chrome show behavior have unit coverage.

Final exact-candidate acceptance follows below.

Final exact-candidate acceptance: extension tree `7db3fc0ddf361d82401b14cf98b83ad8fb98b9a0`, Chrome157.0.8103.39. Original folder icon visible in completed row and browser-settings button absent. Clicking the icon opened the registered saved-media folder; saved.mp4 was highlighted and the safe Blob media link played at320×184/10.031066s. Pagehide released the link; persisted pageshow revalidated and restored it. This tests a real OPFS file and registered completed fixture, not native Explorer or a new full VOD download. [Evidence](evidence/2026-11-09-completed-shortcut-development.json); screenshots under artifacts/completed-shortcut/verified.

Checks:376 scoped passed;425 merged root passed/1 skipped/0 failed; project0 failures/73 preserved files;10 locales×409 messages/0 missing references. Development169 files/384 imports and Store143/350 verified (no Store browser execution). Review's strict-MIME and selected-entry truncation findings were reproduced RED then fixed GREEN; saved media stays first even in large directories, and inherited keys cannot create links. Browser-managed native show remains covered by its regression test; public Chrome downloads.show requires a download ID ([official API](https://developer.chrome.com/docs/extensions/reference/api/downloads#method-show)). Direct FSA jobs deliberately use the extension folder view, not a false native-Explorer claim.

# Completed shortcut correction and Shift playback — 2026-11-09

Later registration and live-download work is recorded under [YouTube live and scheduled broadcasts](#youtube-live-and-scheduled-broadcasts--2026-11-09).

Normal browser-managed reveal retains downloads.show. Shift-click the existing folder icon opens a new browser tab for the complete saved file, with native media controls; picked-folder playback reads only its registered file handle. The rejected folder listing and route have been removed. The browser-default-settings shortcut remains removed. Saved-file safety validation covers the existing audio/video file families, including FLAC/Opus/WebA/MKV; codec support remains Chrome-dependent.

A real development Chrome157.0.8103.39 isolated-profile probe clicked the original icon with Shift and decoded progressing320×184 video from both a real OPFS-backed saved file and an actual Chrome-managed local download (10.031066s fixture). This proves saved-file browser playback, not a new full YouTube download, OS folder picker, or Explorer window. No Computer Use or Store browser execution.

Direct picked-folder Explorer reveal uses an optional Windows PowerShell native-messaging bridge. Code, installer/uninstaller and protocol tests are prepared; registration, the first manual folder link and observed Explorer launch are pending explicit user approval. Missing host reports the requirement and opens no replacement listing. Tests use temporary directories and test mode with no registry change, OS picker or Explorer launch. The direct FSA debugger experiment returned an empty native path; debugger permission is not included. [Chrome native messaging setup](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) explains the Windows host registration.

Final exact-candidate extension tree: `4a77cc8773d57c6055dadb0a1b09950d67f3a9b1`. Both saved-file playback routes passed in installed Chrome157.0.8103.39 with advancing decoded video. [Evidence](evidence/2026-11-09-shift-playback-development.json), screenshots under artifacts/native-explorer/verified. Scoped380 tests passed; merged root429 passed/1 skipped/0 failed. Both project scans had0 failures/73 preserved assets. Scoped locales10×410/0 missing references; development170 files/390 imports and Store144/356 verified, Store inspection only. Fresh review found one format-allowlist regression, reproduced RED then fixed GREEN. Root locale audit still fails on five pre-existing missing keys in unrelated uncommitted subtitle-translation work (six references); archived pre-merge locale contents confirm those keys were already absent. That unrelated work is preserved and excluded from this commit. Native host registration and observed Explorer remain unverified and pending approval.

# YouTube live and scheduled broadcasts — 2026-11-09

See [live and scheduled validation](youtube-live-validation.md) for actual ongoing-live capture, scheduled waiting, user-deferred broadcasting and approved native host registration. Scoped390 tests passed before final integration; exact-candidate evidence follows.

Final exact-candidate extension tree: `3faecd2eb537ecedae783b5feb0ea1bb7d6a89a2`. [Evidence](evidence/2026-11-09-youtube-live-development.json); files/screenshots under artifacts/youtube-live/verified. Native Chrome157.0.8103.39 captured a15s snapshot (633636 bytes) and19.994376s finish output (827475 bytes), both640x360/AV decoded, full-audio RMS0.03005/0.03023. Parent reception continued after snapshot. Scoped390 tests and10x412 locales passed, project0 failures/73 preserved assets. Development171 files/394 imports; Store144/356, no Store browser run. Merged root436 passed/1 failed/1 skipped: unrelated concurrently edited download-options catalogs differ across languages; its separate translation module also references five absent keys. Those uncommitted files remain outside this commit. Real scheduled start/stop remains user-deferred; waiting alone is verified.

# Download options — 2026-11-09

Shift-click on a candidate download button now opens Download options with quality, subtitle selection and per-download translation controls. Ordinary click retains quick download. Subtitle none/all/search and target/source language, provider, model and reasoning level are supported. Existing target-language captions are reused. Missing credentials and stale caption selections block submission; no credentials are copied into queued jobs. Native dialog close/focus behavior is retained; duplicate submits and late permission/model results cannot affect a canceled or reopened dialog.

Actual isolated development Chrome reproduced enabled-submit and stale-permission races before the fix, then passed ordinary/Shift routing, selected quality/captions/translation, cancel/reopen, existing-target reuse, no-captions state, focus restoration and 360px overflow checks. This uses actual candidate/dialog modules with deterministic metadata and permission responses. It does not prove a paid provider request. The receiver integration separately writes real MP4 outputs from deterministic AV/caption responses and mock translation; an independent MP4 parser verifies selected languages, translated text and full/partial cue bounds. No new full YouTube video acquisition is claimed for this UI change.

Review findings were reproduced and fixed: stream subtitle IDs are filtered after manifest discovery, WebRTC preserves ephemeral caption sources, and delayed model refresh remains bound to its original provider. Official YouTube.js and other vendor code is unchanged. Store exclusion is checked by packaging/import graph only; no Store browser test. Studio/webcam broadcast testing remains deferred, with no session reopened. [Retained evidence](evidence/2026-11-09-download-options-development.json).

Final scoped candidate: extension tree `1f0d6fbde1e51adf1808f32046911030d76b54cf`; Chrome157.0.8103.39. Tests438 passed/1 skipped/0 failed; project0 failures/73 preserved files;10 locales×477 messages/0 missing references. Development182 files/441 imports; Store155/398 verified (inspection only). Actual Chrome assertions passed; screenshots and logs retained under artifacts/download-options/verified.

Merged working-folder suite:447 passed/1 skipped/0 failed; unrelated uncommitted work remains separate.

# Registered Explorer repair — 2026-11-09

Refreshed the already-approved HKCU host for the actual development extension. File fingerprint errors no longer become false missing-helper advice; a native port keeps the worker alive while the first folder chooser is open. The chooser uses Chrome's parent HWND and a topmost owner. A native ping verifies connection without a picker. User explicitly rejected an additional connection-confirmation popup; none is included. Original normal-click reveal and Shift-click browser playback remain.

Actual Chrome157 completed-row click reached the installed host, validated an owned prelinked file and opened an Explorer window observed through Shell.Application. Shift replay decoded320px video. No Computer Use, alternate folder page or native picker selection. This tests an owned fixture folder; the user's current file/folder association is not observed. First association still needs a saved-folder choice when no binding exists. Installed host/dialog hashes match source. [Evidence](evidence/2026-11-09-explorer-repair-development.json); screenshots/logs under artifacts/explorer-repair/chrome-1794172795677.

Scoped441 passed/1 skipped/0 failed; merged450 passed/1 skipped/0 failed. Project0 failures/73 preserved files;10 locales×477 messages/0 missing references. Development182 files/441 imports; Store155/398 verified, no Store browser run. Upstream/vendor code is unchanged.
