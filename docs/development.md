# Development

MDownloader is an unbundled Manifest V3 extension. The browser loads `extension/` directly; there is no npm installation or build step for normal use.

## Repository layout

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
| `tests/` | Regression tests and shared test helpers |
| `tools/checks/` | Source, reference, localization, performance, and website checks |
| `tools/build/` | Classic policy generation and captured-frame encoding |
| `tools/capture/` | One CLI for extension or sample-motion captures |
| `tools/dev/` | Options rendering fixture with Chrome API substitutes |
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

## Settings and diagnostics

`debugDownloads` opens the existing job diagnostics tab. `logDownloads` keeps bounded local result events. `debugLogging` enables detailed console diagnostics and a bounded internal memory buffer. All default to OFF.

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
```

Presets are `aligned`, `english`, `manager`, and `website`. All use shared engines and write generated captures into `artifacts/`. Promoting a capture into the website is a separate reviewed asset update. The capture tools do not install dependencies automatically. Do not use extension capture commands to bypass a session's extension-page access restrictions or reload an extension with active downloads.

The options preview runs the actual HTML/modules against Chrome API substitutes. It cannot validate installed-extension permissions, offscreen lifetime, or real download buttons.

## Asset maintenance

See [the asset guide](../assets/README.md) before changing icons. Original PNGs, resize baselines, correction metadata, generation prompts, and retained visual reviews belong in `assets/`; runtime derivatives belong in `extension/icons/`. Website screenshots and their capture metadata belong in `website/assets/screenshots/`.
