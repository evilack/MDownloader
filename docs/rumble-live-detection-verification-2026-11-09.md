# Rumble live URL detection — 2026-11-09

Reported page: https://rumble.com/v7i1odg-q-after-hours-ep.-43.html?e9s=src_v1_live%2Csrc_v2_hp

The video played, but URL search returned no candidates. Approved remote debugging of the user's existing Chrome session established that the extension already held the successful HLS master and rendition responses for the current document. Both had `mediaRole: preview`, which excluded them from detection.

The main video lives inside a page-wide `article`. Its first link is the channel link with `rel="author"`, not a link to another video. The old `CardFor` treated any first link inside an article as its media navigation target. Hovering this large article could therefore mark main-player requests as preview-only. The same mistaken card ownership also prevented the main `playing` event from restoring the playback role.

`extension/media-context-page.js` now requires a container card's link to own the hovered element or a cover, and to have the same nearest card owner. The owner selector includes both structural cards and `[role="link"]`, so nested recommendations cannot lend their covers to the main article. Author links do not establish a preview card. Direct enclosing media links, real hover cards, and ad slots retain their existing roles.

## Verification

- Before the production change, the new main-article/author and unrelated-link tests failed as expected. Existing preview and ad cases passed.
- Independent review found two role-link ownership edge cases. Each was reproduced with a failing test before correction. The final six observer tests pass, including standalone role-link cards and nested role-link recommendations.
- Related observer/network/native-HLS/selected-HLS tests: **37 passed**.
- Final whole-suite command: `node --test tests/*.test.mjs`. **714 tests: 713 passed, 1 skipped, 0 failed**. The live external subtitle test remains opt-in. Other work was concurrently changing this checkout, so these counts describe this verification snapshot.
- Project verification: `node --expose-internals tools/checks/verify-project.mjs`, **failures: []** (354 JavaScript, 18 JSON, 819 relative imports, 137 local references, 84 preserved files). Final observer syntax and whitespace checks also passed.

The original Rumble tab was refreshed to load the revised content script, without reloading the entire extension or terminating its existing runner. The normal `FindMedia` result changed from zero items to one supported HLS master with two declared qualities, **1280×720 and 640×360**. With the source tab visible, the normal public `Scan` result also contained exactly one supported M3U8 candidate. The source remained paused as it was before the refresh.

Local evidence:

- `artifacts/rumble-live/actual-before.json`: original DOM, resource timing, and current-document network/context records.
- `artifacts/rumble-live/actual-after.json`: final normal detection and public scan results.
- `artifacts/rumble-live/refresh.json`: actual source-tab refresh and paused player state.
- `artifacts/rumble-live/full-tests.log`: final complete test output.

Initial disposable-browser attempts were limited by a Cloudflare challenge or a player that had not started. Those attempts are not acceptance evidence; the successful check used the approved existing session. Temporary inspection tabs were closed. No download/save test, long-duration recording test, commit, push, or store publication was performed as part of this detection fix.
