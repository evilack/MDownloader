# Verification

Run the current checks from the project root; no previous evidence directory is required:

```powershell
node --test tests/*.test.mjs
node tools/checks/audit-localization.mjs
node tools/build/build-page-policy.mjs --check
node --expose-internals tools/checks/verify-project.mjs
node tools/checks/measure-debug-cost.mjs
```

Reports and optional media output are generated under Git-ignored `artifacts/<run>/`. Set `MDOWNLOADER_ARTIFACTS` to group related runs under a chosen name.

## Automated coverage

The local suite covers URL/media classification, page/document ownership, source refresh, HLS/DASH parsing, request-header isolation, concurrent jobs, naming, preview state, cancellation, committed partial segments, direct-file prefix remuxing, job deletion, settings, localization, and logging. Media integration tests use the retained local MP4 and real parser/remux code.

Encrypted HLS tests cover all four whole-segment methods, IV derivation, key rotation including a repeated URI during live refresh, clear/encrypted transitions, map key scope, invalid keys/padding/GCM tags, host denial, and observed-response capture. The real fMP4 fixture is tested both clear and AES-128 encrypted through full download, contiguous partial export, preview, and MP4 packet parsing.

For an accessible external **media** playlist, `node tools/checks/verify-encrypted-hls.mjs <https-media-playlist-url>` downloads the first three segments and verifies the resulting MP4. Add `--full` to download the entire finite playlist. Set `MDOWNLOADER_ARTIFACTS` to choose the ignored report/output directory. This is a Node check of transfer/remux behavior; it does not establish installed-extension permissions, browser storage quota, or native playback. Reports contain counts, byte totals, duration, codecs, and packet counts, without raw key data or source URLs.

The project checker validates JavaScript syntax, relative module imports, local manual/website links, manifest entry files, and hashes for retained icon sources/runtime derivatives, vendor files, sample media, and active screenshots. Localization checks render every message in all ten catalogs.

Detailed-log cost checks count lazy evaluations, clock access, serialization, stack construction, timers/observers, log messages, and storage writes on the OFF path. ON burst checks verify throttling. These are Node measurements with a synthetic sink, not Chrome console benchmarks.

The HTTP server test uses real persistent HTTP connections and repeats HEAD, exact Range, invalid Range, method handling, and full-byte comparisons. In this Windows environment, connection-closing HEAD sequences also produced `ECONNRESET` against a separate memory-only response server. Persistent native HTTP passed the control comparison. The test uses no retry; the environment's closing-connection behavior is not claimed to be fixed.

## Browser checks

General website pages and the options rendering fixture can be checked independently of an installed extension. The fixture loads the actual options HTML/modules with Chrome API substitutes; it does not prove permission grants, real download buttons, or offscreen lifetime.

Installed-browser acceptance still requires checking the changed version in the intended Chrome/Edge profile, including:

1. Popup, manager, permissions, previews, and quality selection.
2. Concurrent transfers, source-tab closure, cancellation, partial save, and stop/save.
3. Direct/folder output and completed-file actions.
4. Detailed logging ON/OFF propagation across UI, worker, and offscreen contexts.

Finish active downloads before deliberately reloading an extension for such checks. Respect the session's browser access restrictions; automated tests or a fixture are not a substitute for installed-browser acceptance.

## Capture provenance

The screenshots shipped with the manuals/website are existing real captures. Their language, capture date, version, and hashes are in `website/assets/screenshots/catalog.json`. Current source-icon metadata and retained review captures are in `assets/catalog.json`. Repository cleanup changes paths and metadata organization without redesigning those images.
