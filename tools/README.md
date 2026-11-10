# Tools

Run from the project root. [Development](../docs/development.md) documents environment variables and runtime boundaries. These are maintained development inputs; generated reports and recordings belong under ignored `artifacts/`.

| Category | Maintained tools |
|---|---|
| `build/` | `build-youtube`, client/SABR bundle entries, `package-extension`, `build-page-policy`, `build-explorer-installer`, `encode-sample-gif.py` |
| `checks/` | Project/import/link/asset checks, localization, debug cost, distribution validation, encrypted HLS and website/language/motion checks |
| `checks/probe-*.mjs` | Isolated browser checks for distribution, saved-location/Explorer actions, notifications and complete YouTube library reception |
| `capture/` | `capture.mjs`: shared extension presets and localized sample-motion captures |
| `dev/` | `preview-options` and `preview-job-actions`: real UI/components with Chrome API substitutes |
| `maintenance/` | `format-unreal`: read-only style check; `--write` applies formatting |
| `lib/` | Shared configuration, capture engines, acceptance and MP4 inspection helpers |

## Routine checks

```powershell
node --test tests/*.test.mjs
node --expose-internals tools/checks/verify-project.mjs
node tools/checks/audit-localization.mjs
node tools/build/build-page-policy.mjs --check
node tools/checks/measure-debug-cost.mjs
node tools/checks/verify-website.mjs
node tools/checks/verify-site-languages.mjs
node tools/checks/verify-sample-motion.mjs en
node tools/checks/verify-sample-motion.mjs ko
```

## Distribution checks

```powershell
node tools/build/package-extension.mjs --flavor development
node --expose-internals tools/checks/verify-distribution.mjs --flavor development
node tools/build/package-extension.mjs --flavor chrome-store
node --expose-internals tools/checks/verify-distribution.mjs --flavor chrome-store
```

Both outputs are independent of the source installation. Tests exercise mandatory-flavor validation and physical Store exclusion.

## Optional browser checks

Browser tools need an existing Chrome and Playwright/Puppeteer module; they do not install dependencies. `probe-youtube-library-chrome.mjs` uses production extraction/reception/remux/save modules and inspects a complete disk file in an isolated profile. It is an external-network check, outside the deterministic suite. Retired extraction experiments and probes for the old quality UI were removed.

`probe-distribution-chrome.mjs` checks Store denial with a loopback fixture. Explorer setup/removal probes can change the real current-user host registration; run only with explicit authorization. Notification checks need `MDOWNLOADER_NOTIFICATION_MEDIA` pointing to a local synthetic MP4. Never reload a user's installation with active downloads.

## Captures and previews

```powershell
node website/serve.mjs
node tools/dev/preview-options.mjs
node tools/dev/preview-job-actions.mjs
node tools/capture/capture.mjs --preset english
node tools/capture/capture.mjs --motion --locale en
```

Capture presets: `aligned`, `english`, `manager`, `website`. Preview fixtures do not validate installed-extension permissions, offscreen lifetime or actual downloads. Review captures before promoting website assets.

With an existing Python/Pillow environment:

```powershell
python tools/build/encode-sample-gif.py --source artifacts/<run>/sample-motion/en --assets artifacts/<run>/encoded
```

Keep source frames while reviewing a replacement, then retain the approved website resource and provenance. Do not make personal runtime paths or old artifact directories required tool dependencies.
