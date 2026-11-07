# Tools

Run commands from the project root. The full command, environment, and runtime contracts are in [Development](../docs/development.md).

| Category | Tools |
|---|---|
| `checks/` | `verify-project`, `audit-localization`, `measure-debug-cost`, `verify-encrypted-hls`, website/language/motion verification |
| `build/` | `build-page-policy`, `encode-sample-gif.py` |
| `capture/` | `capture.mjs`: shared engine selected by preset, or sample motion selected by locale |
| `dev/` | `preview-options` and `preview-job-actions`: actual settings/row components with Chrome API substitutes; the row fixture includes a popup-style measure for matching dimensions |
| `maintenance/` | `format-unreal`: read-only by default; `--write` applies formatting |
| `lib/` | Shared configuration and capture engines |

Generated reports, captures, and test media go into Git-ignored `artifacts/<run>/`. No tool needs a previous development session's logs, snapshots, or absolute user paths. Browser tools require an already-available automation module; they do not install it.

With an existing Python/Pillow environment, encode a real capture sequence into a new output directory:

```powershell
python tools/build/encode-sample-gif.py --source artifacts/<run>/sample-motion/en --assets artifacts/<run>/encoded
```

Keep original frames and review the result before replacing a website asset.
