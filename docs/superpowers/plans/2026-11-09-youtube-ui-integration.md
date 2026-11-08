# YouTube development UI integration

Approved scope: development/manual installation only, no Computer Use, no external extraction program, no Store YouTube code, local commit only.

1. Add tests for supported AVC/AAC quality selection, exact format identity and runner state/cancellation.
2. Add a development-only provider boundary. Discover a canonical watch candidate from the current document; perform extraction and resolve sessions in the offscreen document. Keep signed URLs and configuration in memory only.
3. Reuse normal download/Shift quality controls, job registration, progress, cancellation, folder/native save. Give YouTube its own transfer identity, not an HLS format. Scope API request headers to extension-owned YouTube API POSTs and release them after extraction.
4. Build/check development and Store exclusion. Run actual Chrome in a separate profile, click the normal UI, observe manager progress, full 623-second video/audio receipt, native save and decode beginning/end of the actual saved file.
5. Review changes, update upstream change record and verification documents, run checks and commit locally. Preserve unrelated working changes.

Acceptance: normal UI creates one YouTube job, final MP4 has complete AVC/AAC timelines and audible samples at both ends, no secret URLs persist, Store package contains only the disabled provider entry. Failures remain failed; no partial output is reported complete.
