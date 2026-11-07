# Current asset sources

`catalog.json` maps the 17 shipped extension icons to six source groups and records hashes for the retained originals, baselines, references, and reviews. These are development sources; the browser loads only the derivatives in `extension/icons/`.

| Group | Current role |
|---|---|
| `icons/app/` | MDownloader logo, generation references, resize baselines, and native reviews |
| `icons/popup/` | Options, download, link, and refresh source PNGs |
| `icons/actions/` | Cancel and stop/save corrected originals, initial originals, and runtime-size baselines |
| `icons/delete/` | Single-record and section-clear source PNGs and baselines |
| `icons/folder/` | Show-in-folder source PNG and baseline |
| `icons/status/` | Failed-preview source, size baselines, retained 24px comparison, and native reviews |

Runtime duplicates are not copied into source folders. Generation edits and low-resolution RGB correction are separate stages. Existing image bytes have not been redesigned during repository cleanup.

For future edits, preserve the original canvas, silhouette, proportions, layout, and transparent area. Keep resize baselines separate from corrections. Technical retouching must preserve baseline alpha and record RGB bounds. Compare actual 16/24/32/48px displays; hashes or numeric checks alone do not establish visual acceptance.

The popup source collection did not contain separate saved resize baselines. Its catalog retains the original processing record and native review; this cleanup does not invent missing evidence or claim a new retouch review.

Website captures are stored once in `website/assets/screenshots/en/` and `ko/`. Their adjacent catalog records actual capture versions and hashes. The local MP4 under `website/sample/media/` is also a regression-test fixture and must not be removed as an unused screenshot resource.
