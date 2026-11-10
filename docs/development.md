# Development

Current source: MDownloader **0.2.43**. This reference describes the maintained implementation and commands. The [English manual](../README.md) and [Korean manual](README.ko.md) cover everyday use. Historical plans, experiments and dated test reports are not build inputs.

## Repository layout

| Location | Responsibility |
|---|---|
| `extension/` | Installable Manifest V3 pages, worker, offscreen runner and page scripts |
| `extension/features/youtube/` | Development-only provider, isolated evaluator, SABR/live reception and remuxing |
| `extension/lib/` | Shared detection, transfer, state, permissions, subtitles, translation and UI helpers |
| `extension/data/` | Provider/protocol catalogs and generated page policy/Windows installer payload |
| `extension/_locales/` | Ten interface language catalogs |
| `extension/icons/` | Final PNGs shipped to the browser |
| `extension/vendor/` | Media libraries, generated YouTube bundles, licenses and provenance |
| `native/` | Optional Explorer, PotPlayer credential-import and local speech-recognition helpers |
| `website/` | English/Korean product pages, screenshots and local sample media |
| `assets/` | Categorized originals, baselines, prompts, processing/review evidence and hash catalog |
| `tests/` | Maintained regression tests and shared helpers |
| `tools/` | Build, packaging, checks, browser fixtures and capture tools |
| `artifacts/` | Generated packages, reports, captures and media; ignored by Git |

The browser loads `extension/` directly. Node dependencies are needed only to rebuild the YouTube vendor bundles. `website/sample/media/sample-film.mp4` is both a website resource and a real parser/remux regression fixture.

## Build and distribution

There are two distributions: **development**, also the manual/unpacked build, and **chrome-store**. A flavor is mandatory:

```powershell
node tools/build/package-extension.mjs --flavor development
node tools/build/package-extension.mjs --flavor chrome-store
```

Output: `artifacts/distributions/<flavor>/extension/`. Packaging preserves the source installation and excludes local configuration. Store physically excludes YouTube provider/vendor files and sandbox, retaining only a disabled provider entry. Source/network guards also cover generic/embed candidates, playback capture, partial reads and resume. Legacy store jobs without trusted source classification require a new scan.

Development allows Chrome by default. `--block-chrome` adds an optional YouTube restriction. Store and this restricted build use `declarativeNetRequest` to block extension-owned requests before optional target host permission is granted. Store includes `tabs` for its active-page policy notice. Header modifications still need host access. Stored preferences cannot enable YouTube in Store.

Rebuild the pinned dependencies with:

```powershell
npm ci --ignore-scripts
node tools/build/build-youtube.mjs
```

The build emits `client-bundle.mjs` and `sabr-bundle.mjs`, retains dependency licenses, and records versions, lockfile hash and output hashes in `extension/vendor/youtube/provenance.json`. The unused standalone Jinter evaluator, its Jinter/Acorn dependencies and their notices were removed. The active evaluator is the manifest sandbox and its one-shot native worker. Developer checks use Node's separate built-in Acorn. Do not edit generated bundles by hand. [Third-party notices](../THIRD_PARTY_NOTICES.md) identify upstream packages and licenses.

## Runtime architecture

The service worker owns requests, permissions, source identity and persisted job metadata. The offscreen runner owns media reception, temporary storage, subtitles, remuxing and save coordination. Offscreen code uses the runtime relay for privileged APIs. Validate the actual tab/document and source identity again before enqueueing or refreshing a source.

`runtime-policy.js` centralizes bounds. Each transfer owns cancellation, scratch storage and response cleanup. Snapshots freeze a committed prefix with an independent lifecycle; canceling a snapshot must not cancel its parent. Native browser downloads and picked-folder writes share the job model while retaining separate save paths.

### Detection and transfer

- Direct HTTP(S) media preserves original bytes unless selected subtitles require remuxing. Supported native downloads can pause/resume. Direct partial saves may make additional bounded Range requests.
- HLS supports compatible MPEG-TS/fMP4 and whole-segment `AES-128`, `AES-256` CBC, `AES-256-CTR` and `AES-256-GCM` with accessible identity keys. Key rotation, explicit/sequence-derived IVs and initialization key scopes are handled separately. DRM, `SAMPLE-AES` and `SAMPLE-AES-CTR` are excluded.
- DASH supports static, unencrypted, single-Period fMP4 representations. Dynamic/live DASH and encrypted DASH are excluded.
- WebRTC uses registered signaling descriptors and an independent receiver. Recording starts after real remote AV readiness, using MP4 where available and WebM otherwise. Source-tab closure is independent of receiver ownership. Disconnect/stall is interruption; user stop-and-save is intentional finish. Browser shutdown or extension reload ends reception.
- HLS/DASH bounds: 16 GiB temporary media per job, 32 MiB per resource, 5,000 combined track segments. WebRTC: 2 GiB recording bound. Browser storage availability may be lower.

### YouTube

Development uses YouTube.js 18.3.0, GoogleVideo 5.0.1 and Mediabunny 1.65.2. Public watch/short/embed identities lead to real supported selections, separate SABR tracks and AVC/AAC packet copying to MP4. Normal click chooses the best supported quality; Shift-click opens shared Download options. Signed URLs, player configuration and caption URLs stay in bounded offscreen sessions, outside persistent jobs/diagnostics.

API Origin/Referer rules are temporary and extension-scoped. CDN access is requested before reception. Complete VOD reception validates track endpoints and preserves track tails; partial output uses a usable contiguous interval. No yt-dlp, FFmpeg executable or external downloader is a product dependency.

Upcoming broadcasts poll the same video every 30 seconds while Chrome runs. Reception starts with available live formats at the live edge. Snapshots and stop-and-save export the received interval. Closed Chrome and sleeping computers do not receive broadcasts. Full-broadcast natural-end completion and continuous live captions remain separate acceptance cases.

The signature evaluator runs in an opaque sandbox without extension APIs or network access. Its parent enforces a 2-second timeout, 4 MiB script bound, 8,192-character sig/n result bounds and worker disposal acknowledgement. Preserve this boundary during upstream updates.

### Subtitles and translation

`subtitle-discovery.js` owns discovery; `subtitles.js` acquisition/parsing; `subtitle-timing.js` timing; `subtitle-mux.js` and `mp4-timed-text.js` selectable MP4 `tx3g`/`mov_text` output. Supported inputs include WebVTT, SRT, TTML, ended HLS WebVTT and compatible static DASH text. Advanced source styling becomes plain text.

Download options select actual quality/caption identities and per-job translation choices. Matching target-language originals avoid redundant translation. Subtitle/translation errors remain separate from AV transfer state: successful original captions are retained, failed tracks/translation produce an explicit error count, and usable AV can still save. A subtitle mux failure falls back to the original AV with subtitle Error status; actual AV/save failures remain job failures. Encrypted/fragmented MP4 captions, live/discontinuous HLS text and unsafe preservation of existing non-AV tracks are unsupported and reported as subtitle errors. Cancellation still propagates.

`translation-provider-catalog.js` centralizes identity, capabilities and permission scopes for both settings surfaces. Requests belong to `translation-providers.js`; credentials stay in trusted settings storage. Display only actual stored/discovered models and supported reasoning levels. Google uses its fixed NMT choice; Azure/Kakao have no model selector. [Kakao helper](../native/kakao/README.md) documents optional credential import prerequisites.

### Shared UI, state and diagnostics

`row-presentation.js` derives display values without mutating jobs. `media-row.js` owns shared structure and metadata; candidate/job rows supply actions. Unchanged metadata retains its DOM during progress updates. `media-thumbnails.js` exclusively owns duration/resolution overlays, suppression and late-response handling.

`icon-catalog.js` owns JavaScript paths for action icons, source badges, preview failure and notifications. Static HTML and manifest declarations reference the same cataloged PNGs. Originals and processing records remain outside the extension.

`settings-ui.js` handles section navigation and saved-state feedback; existing modules own language, location, permissions, notifications, translation and logs. Download options reuse one form/controller in modal and inline display. Avoid screen-specific copies of provider or row-state logic.

`debugDownloads`, `logDownloads` and `debugLogging` default to off. Detailed logging is lazy, bounded and throttled, using approved codes/numbers. Its off path must not evaluate detail factories, serialize data, start log timers/observers, send log events or write log storage. Logs exclude URLs, headers, tokens, IPs, paths and raw error text/stacks.

Completion/scheduled-start notifications default to off. Settings request optional permission from the initiating gesture. Completion is suppressed for represented jobs in an actual popup or open side panel. Persistent handled markers prevent stale/duplicate alerts. Scheduled-start alerts require positive received bytes. Banner/sound behavior follows Chrome/OS settings.

### Saved-file helpers

The [Explorer helper](../native/explorer/README.md) only reveals picked-folder files. Folder selection can offer its installer; success requires a native ping. First folder association verifies filename, size and bounded fingerprints. Removal requires an authenticated receipt and absent host before resetting location preferences. Media and history remain. macOS uses browser Downloads. The optional PotPlayer importer is independent of this helper.

## Maintenance commands

Run from the project root with Node.js 24:

```powershell
node --test tests/*.test.mjs
node --expose-internals tools/checks/verify-project.mjs
node tools/checks/audit-localization.mjs
node tools/build/build-page-policy.mjs --check
node tools/checks/measure-debug-cost.mjs
```

`verify-project` checks syntax, relative imports, local document/website links, manifest paths, icon catalog coverage and retained asset/vendor/sample/screenshot hashes. Tests check deterministic boundaries and real media fixtures. They do not establish installed-browser visual/audible acceptance. Actual saved-media playback, OS dialogs/notifications, permissions and upstream YouTube behavior still require relevant browser checks.

Regenerate `extension/data/page-policy.js` after changing `PagePolicy` with `node tools/build/build-page-policy.mjs`. Regenerate `extension/data/explorer-installer.json` after changing helper payload scripts with `node tools/build/build-explorer-installer.mjs`. Packaging regenerates its own installer payload.

Regenerate the caption bootstrap payload with `node tools/build/build-caption-installer.mjs` after changing `native/captions` sources. Both distribution builds regenerate caption, Windows common-helper and Mac common-helper payloads. Caption installation on both platforms calls the registered common helper directly; it never downloads a caption CMD/PKG. macOS uses MDownloader-Common-Setup.pkg once for the lightweight helper. `node tools/build/build-mac-common-installer.mjs` builds its payload and ignored native/common-macos/caption-installer.json cache. These commands were not executed for the implementation-only Mac change because the user requested no tests. See [Mac implementation status](../native/common-macos/README.md) and [earlier Windows verification](common-helper-verification-2026-11-09.md).

Optional style check: `node --expose-internals tools/maintenance/format-unreal.mjs`; `--write` applies changes. It excludes vendor code and compares syntax trees. Formatting alone is not behavioral verification.

## Browser tools and website

[Tools](../tools/README.md) lists maintained commands. Browser checks use isolated profiles and existing automation dependencies. Do not reload an installation with active downloads. Checks that install/remove helpers need explicit authorization because they change current-user Windows state. Routine tests use fixtures; external translation requests may consume provider quota.

| Environment variable | Purpose |
|---|---|
| `MDOWNLOADER_ROOT` | Root override; normally derived from tool location |
| `MDOWNLOADER_BROWSER_PATH` | Existing Chrome/Chromium executable |
| `MDOWNLOADER_PLAYWRIGHT_MODULE` | Existing Playwright module path for probes |
| `MDOWNLOADER_PUPPETEER_MODULE` | Existing Puppeteer module/path for captures |
| `MDOWNLOADER_PREVIEW_PORT` | Loopback port; default 4173 |
| `MDOWNLOADER_PREVIEW_URL` | HTTP(S) preview URL override |
| `MDOWNLOADER_ARTIFACTS` | Output run name for shared tools |
| `MDOWNLOADER_NODE` | Node executable for preview CMD launcher |

`node website/serve.mjs` serves a loopback product/sample preview. [Website maintenance](../website/README.md) covers language routing, store/support links and captures. New captures stay in ignored artifacts until reviewed and promoted. Follow [the asset guide](../assets/README.md) for icon changes; preserve original/resize/retouch distinctions and actual small-size review.
