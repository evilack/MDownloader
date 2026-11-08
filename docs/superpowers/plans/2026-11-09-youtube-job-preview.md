# YouTube job thumbnail and hover repair

User reports missing/stale download-row thumbnail and failed hover, asks to share popup thumbnail. Computer Use forbidden; development/manual Chrome only; Store exclusion unchanged. Base 16bd65b; preserve unrelated root work.

Root causes: YouTube StartJob passes PreparePreview=false. Manager tile has no capture callback. Its one-shot cached-thumbnail reader cannot refresh a playing source.

1. Reproduce exact same FACJInvEmY8 source natively with a playing decoded player and a throttled active download. Candidate hover should work while job hover fails. Retain baseline.
2. RED tests: same bound document/video shares thumbnail load across callers, concurrent reads coalesce, no cache hit across documents/pages, empty results retry, capacity bounded. Job source never exposes canonical watch URL as playable media; capture uses pinned document independent of scan lifetime, Store policy guards every read. Deleted jobs cannot regenerate cache.
3. Prepare YouTube preview source during registration. Share a bounded in-memory thumbnail cache at the existing provider-bound ReadPreviews entry. Persist only existing small job thumbnail + session source descriptor. Add authenticated jobThumbnails and captureJobPreview routes, using exact registered tab/document/page/canonical identity; no UI-supplied source. Reuse existing bounded canvas clip and shared visible-thumbnail scheduler in manager. Do not change source player state or tracks.
4. Native after: popup candidate and active job both decode images and moving hover frames; thumbnail changes while source frames/time and download bytes continue. Navigation rejects new capture; close leaves no preview player/loading. Unit/project/locales/Store package checks, fresh read-only review, docs/upstream log and local scoped commit.

Ruling: reuse the established source-player preview contract (currently playing/readable/unprotected page player); this change connects manager to the same provider path. Do not invent a watch URL media source or introduce another extraction/downloading path. Cache is bounded and short-lived, source identity stays pinned even if current scan changes. Last valid thumbnail may remain after source closes; new capture must fail rather than borrow another video.
