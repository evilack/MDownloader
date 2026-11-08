# Development

## Distribution boundary (2026-11-08)

There are exactly two distributions: **development (the manually installed/unpacked build)** and **chrome-store**. The earlier `manual` flavor was a mistaken duplicate; both CLIs now reject it. Reports with that older label are historical records, not another distribution.

Build with `node tools/build/package-extension.mjs --flavor development|chrome-store`. A flavor is mandatory. Output is `artifacts/distributions/<flavor>/extension/`; source `extension/` is never overwritten. Optional `--block-chrome` blocks Chrome (and unknown families) only for YouTube. The fixed store denial always takes precedence over browser detection and stored settings.

Store packaging omits `features/youtube/` and `vendor/youtube/`, then emits only a disabled provider entry. `node --expose-internals tools/checks/verify-distribution.mjs --flavor chrome-store` checks physical files, manifest references and every static/dynamic literal module import. The source policy checks trusted page/frame/request context as well as media URLs. All HLS/DASH resources, direct browser saves, partial re-fetches, playback capture and resume have independent guards. Store resume/re-fetch refuses legacy records without a trusted `sourcePolicyVersion`; rescan the page to register a classified job.

Store builds (and `--block-chrome` builds) use `declarativeNetRequest` instead of `declarativeNetRequestWithHostAccess`. Chrome requires the former to apply block rules before optional target-host permission has been granted. The fixed session rule matches only this extension's initiator and YouTube media domains, including redirects; site playback and other extensions are outside the rule. Header modifications still require host access. This adds Chrome's block-content installation warning to those packages. [Chrome DNR permissions](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#permissions).

`node tools/checks/probe-distribution-chrome.mjs` uses a new isolated Chrome profile, loads the generated store package with the DevTools Extensions API, checks fixed denial despite forged settings, saves the retained local MP4 and checks a redirect to googlevideo. Set `MDOWNLOADER_BROWSER_PATH` and `MDOWNLOADER_PLAYWRIGHT_MODULE` when bundled defaults do not apply. It never uses or reloads the user's profile. Browser outputs remain under ignored `artifacts/youtube-implementation/`.

MDownloader is an unbundled Manifest V3 extension. The browser loads `extension/` directly; there is no npm installation or build step for normal use.

## Repository layout

### YouTube native diagnostic probe

Install the pinned development dependencies with `npm ci --ignore-scripts`, then run `node tools/build/build-youtube.mjs`. Committed runtime bundles let unpacked users load the extension without npm. The default signature evaluator uses an opaque manifest sandbox and its one-shot native JavaScript worker. The extension pages retain their normal eval restriction; the sandbox has no extension APIs and denies network connections. Scripts are bounded to 4 MiB and results to 8,192 characters per sig/n value, with a 2-second timeout enforced by the parent. The previous Jinter worker bundle is retained but is no longer the default. See [the upstream change/update record](youtube-upstream-changes.md).

Run the following after generating the desired distribution:

```powershell
node tools/build/package-extension.mjs --flavor development
node tools/checks/probe-youtube-chrome.mjs
# Expanded SABR/UMP receiving, partial remux, native save and decode:
node tools/checks/probe-youtube-sabr-chrome.mjs
```

The probe uses actual Chrome, a fresh isolated profile, Playwright and the DevTools protocol. It does not use Computer Use. In that test profile only, Chrome's extension-settings API preapproves three exact optional API hosts, then the extension's real `chrome.permissions.request()` activates them. Neither step grants the broad optional `http://*/*` or `https://*/*` pattern. The package manifest and extension runtime are unmodified. Offscreen documents query permissions through an authenticated service-worker relay because their extension API access is limited to `chrome.runtime`.

The default diagnostic video is the user's requested `-XHx839rSc8`. The probe records statuses and fixed diagnostic categories, never player scripts, cookies, tokens or signed media URLs. `result.json` explicitly distinguishes extraction, receiving and saving. **Exit code 2 means the native gate was not passed.** This is a failure diagnostic: it currently has no positive receive/save implementation, even if a later upstream change makes metadata/selection succeed. A future successful gate requires actual track reception, a saved muxed file and playback checks before changing that behavior. It must not silently be treated as a success harness.

On 2026-11-08 both development probes hit automated-request HTTP 403 on the public WEB player API. The ordinary public page was playable but exposed SABR-only metadata with no direct/cipher URLs. This historical negative probe predates the browser-only success and the development UI integration described below. See the retained [native evidence](verification.md#task-2-native-result--2026-11-08).

| Directory | Responsibility |
|---|---|
| `extension/` | Installable extension pages, worker, and runtime entry points |
| `extension/lib/` | Detection, transfer, media, state, localization, and UI components |
| `extension/data/` | Provider schemas, protocol metadata, generated classic-script policy |
| `extension/_locales/` | Ten language catalogs |
| `extension/icons/` | PNG derivatives actually used by the extension |
| `extension/vendor/` | Unmodified Mediabunny bundle and its license |
| `website/` | English/Korean static product pages and local media sample |
| `assets/` | Current icon sources, baselines, review evidence, and hash catalog |
| `docs/` | Korean user manual, development reference, and verification scope |
| `tests/` | Regression tests and shared test helpers |
| `tools/checks/` | Source, reference, localization, performance, and website checks |
| `tools/build/` | Classic policy generation and captured-frame encoding |
| `tools/capture/` | One CLI for extension or sample-motion captures |
| `tools/dev/` | Options and download-row rendering fixtures with Chrome API substitutes |
| `tools/maintenance/` | JavaScript style maintenance |
| `tools/lib/` | Shared tool configuration and capture engines |
| `artifacts/` | Generated local reports, recordings, and captures; ignored by Git |

## Checks

The command-line checks were verified with Node.js 24. No package installation is required for the core test suite.

```powershell
node --test tests/*.test.mjs
node tools/checks/audit-localization.mjs
node tools/build/build-page-policy.mjs --check
node --expose-internals tools/checks/verify-project.mjs
node tools/checks/measure-debug-cost.mjs
```

`verify-project` checks syntax, relative imports, local document/website references, manifest entry points, and retained asset hashes. Reports are written beneath `artifacts/<run>/`. A missing historical report does not prevent a fresh checkout from running checks.

To retain the media produced by integration tests:

```powershell
$env:MDOWNLOADER_WRITE_EVIDENCE = '1'
$env:MDOWNLOADER_ARTIFACTS = 'media-check'
node --test tests/partial-file.test.mjs tests/partial-save-integration.test.mjs
```

The media goes into `artifacts/media-check/test-media/`. Remove these environment variables when normal tests should leave no media output.

## Runtime boundaries

- `background.js` authenticates messages and owns Chrome permissions, browser downloads, persisted jobs, badges, and per-job request-header rules.
- Detection combines DOM players, successful network observations, declared source schemas, document identity, and current page ownership. MAIN and ISOLATED scripts do not import extension modules.
- `hls-runner.js` performs independent stream/folder transfers in the offscreen document. It uses runtime messages for privileged APIs and owns each transfer's abort signals, scratch files, output streams, and object URLs.
- Partial saves use committed contiguous segments or a separately fetched direct-file prefix. Their cancellation and output ownership are independent. Source scratch files stay alive until dependent readers finish.
- Stop/save uses the original HLS/DASH transfer's separate finish signal. The scheduler stops assigning segments, waits for current requests without retrying failed ones, and returns only a committed continuous prefix. The parent cancellation signal stays usable for remux/save. Separate video/audio queues are interleaved so audio can become ready early; button readiness uses the same common-prefix selection as the export and is cached once ready. Incomplete finite outputs receive their partial filename before browser/folder saving.
- UI lists share candidate, job-row, preview, and feed components. Late results cannot update a different document or hover session.

`lib/runtime-policy.js` owns tunable runtime limits. `data/source-providers.json` and `data/hls-protocols.json` describe supported external schemas. Standard protocol tokens and Chrome API/message/storage field names are contracts, not arbitrary local naming choices.

### HLS encryption

`lib/hls-encryption.js` handles `KEYFORMAT="identity"` whole-segment encryption with Web Crypto: AES-128-CBC, AES-256-CBC, AES-256-CTR (64-bit counter), and AES-256-GCM (16-byte IV prefix and 16-byte authentication tag). AES-256-GCM follows the HLS second-edition draft; AES-256 and AES-256-CTR are compatibility methods also used by HLS.js. AES-128 follows [RFC 8216](https://www.rfc-editor.org/rfc/rfc8216.html).

- Media key declarations are scoped to their following segments. CBC/CTR use the explicit 128-bit IV or the big-endian media sequence number. Encrypted initialization maps require an explicit IV except for self-contained GCM resources.
- Keys go through the same host authorization and restricted observed-header path as media. Redirects, cookies/authorization forwarding, and denied access are not bypassed. Each key response is bounded to the expected 16 or 32 bytes.
- A per-job WeakMap shares imported, non-extractable CryptoKeys across concurrent segments of one declaration. Failed loads are evicted for the existing retry policy. Repeated declarations and live refreshes do not reuse a stale key merely because the URI matches. Downloaded raw key buffers are erased after import; observed playback keys remain in memory until collection completes and are then erased. Keys are never written to scratch files, manifests, diagnostics, or jobs.
- Decryption happens before TS validation and scratch-file commit, so previews and partial exports read clear media. Encrypted LL-HLS uses complete parent resources instead of treating partial CBC ranges as independent segments. Ordinary complete-segment byte ranges are fetched and validated as ciphertext before decryption; I-frame-only ranges remain unsupported.
- Master `SESSION-KEY` tags are metadata; media `KEY` tags remain authoritative. Unsupported alternate key formats can coexist with a usable identity declaration.
- Playback response capture also accepts declared keys already received successfully by the player. It never fetches missing keys or segments; media that arrives before its key waits in a bounded ciphertext queue (four resource limits, currently 128 MiB). This capture path remains finite MPEG-TS only. Repeated encrypted segment URLs and multiple key declarations reusing one key URI are rejected in capture because observed responses alone cannot resolve their association; ordinary downloads use per-declaration requests and support key URI reuse.

Sample encryption (`SAMPLE-AES` / `SAMPLE-AES-CTR`), DRM license acquisition, and encrypted DASH remain unsupported. Resource bodies are bounded at 32 MiB, scratch media at 16 GiB per job, and queues at 5,000 segments; the browser's available storage quota still applies.

### WebRTC reception

WebRTC is a regular detected-media candidate with the existing Download and Shift-quality controls. Valid HLS alternatives are retained alongside it. Detection still excludes evidence-backed advertisements, previews, and blurred profiles; the presence of WebRTC alone does not suppress HLS.

| Component | Responsibility |
|---|---|
| `webrtc-quality-observer.js` | MAIN-world observation, exact track/session association, and observed server profiles |
| `lib/webrtc-quality-task.js` | Limited page task for profile lookup and one-time connection descriptors |
| `webrtc-jobs.js` | Candidate ownership, quality selection, runner startup, cancellation, and session control records |
| `lib/webrtc-descriptor.js` | Validation of the configured `ristretto-v1` signaling descriptor and exact allowed WSS host |
| `lib/webrtc-receiver.js` | Independent WebSocket, PeerConnection, remote tracks, and MediaRecorder in the offscreen document |
| `lib/webrtc-transfers.js` | Per-job receive/save lifecycle, serialized reports, snapshots, interruption, and output ownership |
| `lib/webrtc-recording.js` | Ordered, bounded OPFS chunk storage and frozen committed prefixes |
| `lib/webrtc-page.js` | Active MediaStream probing and compatibility handling for page-owned sessions |

The current start path uses an independent offscreen receiver. After reception starts, source-tab closure/navigation does not own its lifetime. The receiver uses the selected observed server profile without changing the original player's quality or tracks. Unknown signaling services are unsupported; generic page capture is not used as a silent fallback.

Connection authentication is validated and sent once to the runner, never written to job/session storage or diagnostics. Session control records contain ownership information rather than connection credentials. Service-worker dependencies use static imports; the quality regression harness rejects dynamic imports to match the worker restriction.

Recording starts only after the remote description is applied and received tracks are live and unmuted. The independent document also attaches remote audio to an owned hidden, muted audio element to initialize Chrome's remote-audio processing without speaker playback; cleanup detaches and removes that element. Signaling, startup timeout, ping handling, and cancellation remain active during the readiness wait. The receiver prefers MP4 H.264/AAC, with WebM VP8/Opus or browser-supported WebM fallbacks. MediaRecorder may re-encode; this path does not promise lossless remuxing.

Each recording is bounded at 2 GiB; pending receiver data is bounded at 8 MiB. Current-save freezes committed handles and uses the existing partial-remux path while reception continues. Pending snapshot readers keep their source workspace alive. User-requested stop is a normal finish; connection loss, stalled media, and recording/storage failures retain committed data when possible and report interruption/partial output. Successful browser saving does not turn interrupted reception into a normal completion.

Browser/extension crash recovery, arbitrary signaling protocols, DRM license acquisition, and automatic recording resumption are not implemented. Historical page-owned control branches remain for probing/compatibility and are not separate user-facing recording tabs.

## Settings and diagnostics

`debugDownloads` opens the existing job diagnostics tab. `logDownloads` keeps bounded local result events. `debugLogging` enables detailed console diagnostics and a bounded internal memory buffer. All default to OFF.

Page-title naming and local download date/time naming default to ON. Explicit saved choices are preserved. Names and timestamps are fixed when a job is registered; partial outputs use the shared partial naming helper. Playback capture and WebRTC have no original filename and pass an absent name to the common filename helper, which uses the available page title/date-time without an app, playback, or generated WebRTC stem. Recording format reporting determines the actual output extension. Language selection defaults to the system language, with English fallback.

### Shared status presentation

`lib/job-measure.js` renders received bytes above speed or save-stage text. Popup active-status wrappers and manager measures share the same CSS rules: 11px text, 12ch preferred box width, 2px/6px padding, a 1px border, and 6px corners. `--transfer-text` supplies the received-byte color; speed uses `--muted`. Canceled text uses `--mint` and the shared rounded status border in both surfaces.

The manager retains the native 8px progress element below the row, without an overlaid byte label. Unknown totals remain indeterminate. Completion, muxing, and saving keep their distinct text and progress values. These layout rules do not change transfer state or button behavior.

### Logging

Detailed logging uses cached options, caller guards, lazy detail factories, allowlisted codes/numbers, throttling, and bounded retention. It excludes URLs, headers, tokens, IP addresses, paths, and raw error messages/stacks. OFF must not evaluate detail factories, serialize data, create log timers/observers, send log events, or write log storage. Initial settings reads and change subscriptions maintain the cached option. Persisted result logging rechecks an ON write inside the shared lock so another context's OFF wins even when its change event arrives late.

Functional HLS stage data remains available for progress UI and previous-denial handling independently of detailed logging. Offscreen settings use existing launch messages and changes sent only to an already-existing offscreen document.

## Policy and style maintenance

After editing `PagePolicy` in `extension/lib/runtime-policy.js`, regenerate the classic-script form:

```powershell
node tools/build/build-page-policy.mjs
```

Registration and direct injection load this generated policy before the observing script. Worker validation remains authoritative because a page can affect MAIN-world globals.

```powershell
node --expose-internals tools/maintenance/format-unreal.mjs
node --expose-internals tools/maintenance/format-unreal.mjs --write
```

The first command checks without writing. The formatter uses Acorn already bundled with the verified Node runtime, preserves external property/export keys through aliases, and compares syntax trees during formatting. It applies tabs, Allman braces, explicit control blocks, PascalCase locals, and known boolean `b` names. It excludes vendor code and image assets. Re-run the suite after source changes; formatting alone is not behavioral verification.

## Website and captures

```powershell
node website/serve.mjs
```

The server binds to loopback. Its URL is printed at startup. No hosting or deployment is performed.

Browser capture/check commands require an existing compatible Puppeteer module and browser. Configure them rather than editing personal paths into scripts:

| Variable | Purpose |
|---|---|
| `MDOWNLOADER_ROOT` | Project root override; normally derived from the tool location |
| `MDOWNLOADER_PREVIEW_PORT` | Local server port; default 4173 |
| `MDOWNLOADER_PREVIEW_URL` | HTTP(S) preview URL override |
| `MDOWNLOADER_BROWSER_PATH` | Existing browser executable |
| `MDOWNLOADER_PUPPETEER_MODULE` | Existing module name or absolute module path |
| `MDOWNLOADER_ARTIFACTS` | Output run name; defaults to a timestamp |
| `MDOWNLOADER_NODE` | Existing Node executable for `website/start-preview.cmd` |

```powershell
node tools/capture/capture.mjs --preset english
node tools/capture/capture.mjs --motion --locale en
node tools/checks/verify-website.mjs
node tools/checks/verify-site-languages.mjs
node tools/checks/verify-sample-motion.mjs en
node tools/dev/preview-options.mjs
node tools/dev/preview-job-actions.mjs
```

Presets are `aligned`, `english`, `manager`, and `website`. All use shared engines and write generated captures into `artifacts/`. Promoting a capture into the website is a separate reviewed asset update. The capture tools do not install dependencies automatically. Do not use extension capture commands to bypass a session's extension-page access restrictions or reload an extension with active downloads.

The preview tools run actual HTML/components against Chrome API substitutes. They cannot validate installed-extension permissions, offscreen lifetime, or real download buttons. The download-row fixture covers ready/disabled stop-save states, the Cancel → Save received portion → Stop and save order, canceled badges, and a popup-style reference measure for comparing text and box dimensions.

## Asset maintenance

See [the asset guide](../assets/README.md) before changing icons. Original PNGs, resize baselines, correction metadata, generation prompts, and retained visual reviews belong in `assets/`; runtime derivatives belong in `extension/icons/`. Website screenshots and their capture metadata belong in `website/assets/screenshots/`.

## SABR/UMP development diagnostic

The user-authorized SABR/UMP expansion uses locked googlevideo 5.0.1, bundled under vendor/youtube and excluded wholesale from store packages. features/youtube/sabr.js validates the public VOD identity/config and receives separate video/audio streams into OPFS. It enforces a 32 MiB chunk limit and 16 GiB combined limit, with zero HTTP retries and no token-minting callback. Pending attestation (status 2) may continue while data progresses; rejection (status 3) stops reception. Writers commit only after joint completion validation, except explicitly requested partial-prefix retention. features/youtube/remux.js uses existing Mediabunny 1.65.2 to copy H.264/AAC packets from independent files, retaining a decodable keyframe and the audio offset.

The expanded diagnostic observes an HTTP 200 normal playback request in its own tab and keeps the signed source/config/legitimate token in memory. It closes that tab before receiving in the offscreen document. Ephemeral exact-URL POST header rules reproduce only the observed Origin/Referer for that source, allowing only rn to change. These are diagnostic controls, not a production source-session relay or UI integration. The API comparison holds the body constant: page 200, plain offscreen 403, offscreen with the page Origin/Referer pair 200. It does not isolate which header alone is decisive.

The probe actually receives, remuxes, calls chrome.downloads, verifies file bytes, plays video frames and decodes an AAC sample. The server rejected this session after a prefix; only a 60.533-second partial MP4 passed save/decode. Exit 2 and gatePassed=false remain appropriate for incomplete reception. Automation saved a UUID-named file despite the requested title/date name; the original is preserved and an identical named artifact is exported, with both names and its hash recorded. Production filename acceptance and complete 623-second download are unverified. Only the development build is browser-tested in this expansion.

## yt-dlp diagnostic option

The subsequent user-authorized yt-dlp comparison achieved a complete format 18 file through actual development Chrome, while other fresh sessions still returned 403. This is an external extractor experiment; the later browser-only and UI verification sections supersede that historical gate status. See the [integration decision](superpowers/plans/2026-11-08-youtube-ytdlp.md) and [complete-file evidence](verification.md#yt-dlp-comparison--2026-11-08).

`tools/checks/probe-youtube-ytdlp-chrome.mjs` requires an existing official yt-dlp executable (`MDOWNLOADER_YTDLP_PATH`), Node, Playwright and Chrome. It does not install them, register a host or use the user's profile. Build development first. By default, yt-dlp extracts in a hidden subprocess, then the real offscreen `ReceiveYoutubeFile` performs bounded 4 MiB ranges with a 32 MiB maximum chunk and 16 GiB file limit. Strong ETag/valid Last-Modified is required before assembling multiple ranges; changed totals, validators, truncated bodies or errors abort the writer and cancel the response. Only the selected CDN host permission is granted. Diagnostic DNR GET rules copy the extractor's allowlisted User-Agent/Accept/Accept-Language/Sec-Fetch-Mode for the exact source URL and extension initiator. No permanent header rule is added.

Setting `MDOWNLOADER_YTDLP_TRANSPORT=helper` explicitly permits fallback after direct reception fails: yt-dlp downloads, then the harness transfers file chunks to Chrome OPFS. Reports distinguish `directReceive`, the transport string, `chromeDirectNetworkPassed` and `nativeMessagingIntegrated:false`. Hashes use file streams; signed URLs, headers and metadata JSON are not written into diagnostic reports. Each run uses a new isolated profile and keeps negative results. Inspect those fields before claiming Chrome network success. No store browser run is needed or performed.

## Browser-only SABR completion

The explicit `CreateYoutubeClient().DiscoverYoutube({pageUrl,transport:"sabr"})` validates the public WEB response before retrieving VISIONOS data. `ResolveYoutubeSelection` retains exact per-session format indices, deciphers the SABR URL using the sandbox evaluator and checks CDN permission. `ReceiveSabrTracks` passes exact normalized format objects and validates selected-format durations, rather than treating integer-rounded page seconds as an exact track endpoint. On validated complete reception, `RemuxYoutubeTracks(...,{preserveTrackEnds:true})` retains every packet of both tracks. The default remains common-interval trimming for partial inputs.

Build development and run `node tools/checks/probe-youtube-library-chrome.mjs` for the complete same-video native test. This probe uses production client/receiver/remux/save modules and exact API/CDN permissions in an isolated Chrome profile. It requires the existing browser/automation runtime only; no yt-dlp, FFmpeg executable, server or separate bridge extension is used. `probe-youtube-attestation-chrome.mjs` retains the separate public-player lifecycle diagnosis. Full proof and limits are in [verification](verification.md#browser-only-sabr-completion--2026-11-08); update obligations are in [youtube-upstream-changes.md](youtube-upstream-changes.md).

## Development YouTube UI integration

The development/manual build now detects canonical watch/short/embed identities and uses its normal download button. A regular click selects the highest supported AVC resolution and highest-bitrate AAC; Shift-click uses the existing quality dialog. When a new CDN permission is needed, regular click opens that dialog with only the best selection so its confirm event can request permission with a fresh user gesture. The current page/document and extraction session/video ID are checked again before enqueueing. The provider's worker operations use static imports because Chrome service workers reject dynamic import(). The offscreen-only receiver is loaded there, not evaluated in the worker.

Extraction uses an extension-initiated, API-path/POST-scoped Origin/Referer rule while calls are pending. Each exact CDN origin is surfaced for optional permission before downloading. The offscreen context retains the client/session/config, receives both tracks to OPFS, checks their complete endpoints, and remuxes with preserved track tails. A separate youtube transfer identity shares existing job progress/cancel/native-save/folder-save infrastructure; it does not use HLS playlists or mark incomplete reception complete. It uses the common scratch lifecycle to remove abandoned workspaces on a fresh offscreen document and releases current files after Chrome finishes reading them.

Build development, then run node tools/checks/probe-youtube-ui-chrome.mjs for selected 360p and add --auto for the normal-click highest-quality route. Both use the actual native side panel via CDP, a separate Chrome profile and preapproved exact optional hosts. They check manager active/completed states, all saved packets, disk-file first/tail AVC/AAC decode, nonzero audio, hash, sensitive-data absence and API rule release. Computer Use and external extractors are not used. The Store package is checked statically for physical exclusion; no Store browser test is performed for this task. See [verification](verification.md#youtube-ui-integration--2026-11-09) and [upstream change record](youtube-upstream-changes.md).

## YouTube original captions

Development downloads use the existing bounded ReadSubtitles and MuxSubtitles/TimedTextTarget modules to receive original YouTube captions and embed selectable tx3g tracks. The client keeps signed timedtext URLs inside its bounded offscreen session. It unions WEB and VISIONOS catalogs by language/kind/vss identity, checks video/session/expiry/permission again, and returns only safe metadata outside offscreen. YouTube fetches omit credentials. Declared-track errors fail saving; genuinely absent catalogs are explicitly unavailable and do not pass caption acceptance. Unrelated translation configuration/UI remains outside this integration.

After building development, run `node tools/checks/probe-youtube-ui-chrome.mjs --auto --captions`. The actual native side panel starts the download. The probe rereads the saved disk file with an independent ISO BMFF reader, checks language/sbtl/tx3g/sample tables, and compares received text and full cue-timing hashes against the saved samples. The same-video ASR cues are nonoverlapping; this tuple comparison does not generalize to composited overlapping cues. The shared mux suite separately tests overlaps, clipping, Unicode, preservation, destination errors and cancellation. No Computer Use, external extractor, program installation or Store browser run is required. See [caption verification](verification.md#youtube-captions--2026-11-09).
