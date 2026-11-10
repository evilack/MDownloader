# CHZZK HLS detection repair

> Execution: implement in this chat, using failing regression tests before each fix and fresh verification afterward.

**Goal:** Exclude CHZZK CDN and high-quality/P2P media fragments while retaining real HLS broadcast playlists.

**Architecture:** Keep the current permission/document scoped network cache and HLS parser. Recover manifest relationships when an otherwise unambiguous Blob player has empty helper media elements. Extend the existing conservative fragment fallback for CHZZK's observed chunklist/quality/segment naming, including loopback transport, without blocking localhost or rewriting signed addresses.

**Tech stack:** Manifest V3 JavaScript, node:test, isolated Chrome/Playwright diagnostics.

**Scope:** User request in this chat, including the supplied localhost:17080 1080p partial M4V URL. Existing unrelated work remains in place; this is a bounded repair against the current modified source, not a clean-HEAD feature branch.

## Tasks

- [x] Add failing behavior tests for CDN/loopback fragment classification and retention of unrelated direct files/playlists.
- [x] Repair `IsHlsFragmentUrl` in `extension/lib/media.js`; exercise early and late network fragment filtering.
- [x] Add failing tests for manifest recovery with a Blob player plus an empty media helper; keep multi-source, preview and SPA guards.
- [x] Repair matching player selection in `extension/detection.js` and `extension/lib/native-hls-discovery.js` only as supported by the tests.
- [x] Reproduce real CDN and high-quality/P2P traffic in an isolated Chrome profile, verify only HLS candidates remain, and inspect declared qualities/live state.
- [x] Run the complete Node test suite and project checks, review the bounded diff, and record verification and limitations.

## Review focus

- Preserve ordinary M4V downloads and unrelated same-directory files.
- Do not merge different origins, directories, qualities, documents or broadcasts.
- Preserve signed URL bytes, loopback ports and P2P query parameters.
- Empty helpers may be ignored; two sourced players remain ambiguous.
- Failed manifest reads must not justify fabricated master relationships or loss of real playlists.

## Completion evidence

See [verification report](../../chzzk-hls-detection-verification-2026-11-09.md). Initial regression run: 4 expected failures and 1 preservation test passed. Final suite: 593 passed, 1 existing skip, 0 failed. Separate scoped review: no actionable findings, 41 relevant tests passed. No commit/push or existing browser profile changes were made.
