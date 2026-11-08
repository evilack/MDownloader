# YouTube hover preview regression

User reports failed preview on https://www.youtube.com/watch?v=FACJInvEmY8. Development/manual Chrome only; no Computer Use; preserve fixed Store exclusion and unrelated working changes.

Evidence: actual Chrome baseline has a playing 854x480 source whose time/frames advance, but hover contains only a still image and reports failed. Code excludes YOUTUBE from both media-preview capture and CaptureCandidatePreview. The canonical watch URL is correctly not treated as a playable URL.

1. RED tests for YouTube UI capture branch and trusted document-bound player capture. Add a generic pagePlayer hint from the already validated provider candidate, scoped to the exact visible source document and one unambiguous decoded visible video. Do not relax HLS/worker URL association or read arbitrary child players.
2. Reuse existing bounded canvas-copy MediaRecorder clip (1.5s, 1MiB, timeout); never capture/stop the source player's tracks, seek/pause/reload it, or execute page player functions. Validate document/source ownership throughout recording and clean up canvas tracks on all outcomes. Playback success still requires actual preview playing events.
3. Reproduce user video natively before/after, prove decoded hover frames advance while source continues, close/cancel cleanup, stale navigation rejection, and preserved Store guards. Paused/DRM/unreadable primary sources remain outside the moving-frame capture contract; never report a static image as playing.
4. Fresh read-only review, tests/project/package checks, update docs/evidence and local scoped commit; no remote push.
