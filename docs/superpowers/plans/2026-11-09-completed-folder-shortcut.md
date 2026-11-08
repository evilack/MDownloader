**Superseded after user rejection:** the folder-list substitution did not satisfy native Explorer reveal. Its implementation is removed by [the correction plan](2026-11-09-native-explorer-and-browser-play.md). The text below records the rejected historical approach only.

# Restore completed folder shortcut

User reports the existing completed-row folder icon missing and explicitly removes browser-default-location settings button. Base f87aaac. No Computer Use, no new native helper, development-only browser checks, preserve Store exclusion and unrelated root work.

Cause: row hides show action for pickedDownloadFolder; ControlJob only implements Chrome downloadId show. Direct folder writes have no Chrome downloadId. Restore the same icon/action placement. Browser-managed downloads retain chrome.downloads.show; direct folder jobs open a small extension saved-folder view that resolves their original handle and highlights/opens the saved media. This does not claim Windows Explorer integration for File System Access handles, which Chrome public API cannot reveal by downloadId.

1. RED completed picked-folder row must include show; show control opens registered location while active/missing/other jobs cannot. Preserve browser download show.
2. Add read-only saved-folder view using registered job ID and existing IndexedDB handle, read permission/restore gesture, bounded1000-entry listing, current file media-only Blob link, revoke URLs on refresh/pagehide; no arbitrary path/HTML execution, copies or downloads. Public metadata route only from trusted extension UI; dedicated viewer can request only this read route. Store guards preserved.
3. Remove unneeded browser settings button and handler. Native Chrome fixture: real OPFS handle/file, completed job, click original manager icon, folder lists/highlights file, open link decodes local media. Document fixture and native Explorer verification boundary.
4. Full tests, locale/project/package checks, fresh read-only review, docs and scoped local commit.

Ruling: keep original show affordance and native behavior where a Chrome download ID exists; adapt direct folder jobs to actual readable folder content instead of leaving a dead button or opening the wrong default folder. No external helper or browser-profile modification.
