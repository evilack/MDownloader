# Browser-only YouTube continuation implementation plan

> **For agentic workers:** Use superpowers:executing-plans with systematic debugging and TDD. User selected this direction and authorized continued execution.

**Goal:** Receive and save the entire same public VOD (`-XHx839rSc8`, displayed 623 seconds) using browser JavaScript, SABR and Mediabunny, with no installed helper.

**Architecture:** Keep the existing local youtubei.js/googlevideo bundles and OPFS/remux boundaries. Diagnose the actual public player's source/attestation lifecycle first; implement only changes supported by those observations. A complete file requires both track ends, full packet inspection and native save/decode evidence, not merely HTTP 200 or a token's length.

**Spec:** Latest user instructions in this chat and the existing [SABR plan](2026-11-08-youtube-sabr.md). The newer browser-only instruction supersedes the optional native-helper path for this continuation.

## Global constraints

- No Computer Use; actual Chrome with an owned isolated profile and development/manual package only.
- No yt-dlp, FFmpeg executable, external download server, native host or system installation.
- Preserve store exclusion; product UI stays gated until actual complete reception and production relay are verified.
- Preserve concurrent work in the original checkout. This worktree starts at `6937aca`; existing 280 tests pass.
- Keep signed URLs, tokens, cookies and source scripts in memory; persist only bounded structural diagnostics.
- Observe legitimate normal player token issuance; do not forge tokens, solve CAPTCHAs or bypass restricted videos.

## Tasks

1. [x] Diagnose: compare public playback and independent receiver; record every UMP protection/media outcome, token changes, challenge network status and playback progress. Compare headed Chrome with and without the test automation flag as an environment control, without JavaScript environment spoofing.
2. [x] Implement: for a proven source/session defect, write its minimal failing regression, implement the browser-only correction, and run narrow then full tests. If rejection occurs before the receiver, preserve that evidence and investigate the normal source lifecycle rather than changing mux code.
3. [x] Verify: actual Chrome complete reception, both packet timelines/decoding and disk save; verify store exclusion statically, update documents/evidence and obtain one independent final review. Commit only this scope locally. If the server still rejects, report the failed gate and exact remaining boundary without presenting partial output as full success.

## Review focus

Rejected HTTP 200 mistaken for valid media; token placeholder mistaken for accepted attestation; source/video mismatch after navigation; resource cleanup on abort/rejection; bounded reporting and no privileged remote-script execution.

Native browser-only full receive/remux/save passed with VISIONOS, all protection1. WEB negative control remains rejected. Post-review exact-format identity regression was RED then GREEN; prototype capability recovery was hardened with a separate RED→GREEN test. Final verification/evidence and local commit follow. Upstream source modification record is [youtube-upstream-changes.md](../../youtube-upstream-changes.md).
