# Download options implementation plan

Goal: replace the resolution-only popup with one download-options dialog containing resolution, subtitle selection and translation. Shift-click opens it; ordinary click retains quick download. Cancel sends no download. Per-download choices reach the existing receiver/muxer without changing global defaults or copying credentials into jobs.

Use the existing working dialog, caption discovery, translation adapters and job wiring as supplied project work, preserving their original snapshot under artifacts/download-options/baseline.json. Integrate necessary modules into a clean checkout; leave unrelated naming, opaque-HLS, package version and native helper changes uncommitted. Retain development/manual YouTube and Store exclusion. No Studio work or webcam broadcasting.

1. Verify baseline and reproduce async-close/submit races in actual Chrome. Fix stale async mutation and duplicate submission; expose no-subtitle state and proper field labels. Retain native showModal/close/Esc/focus behavior.
2. Validate resolution changes, source subtitle filtering, none/all/search, translation provider/model/reasoning/language selections, existing target reuse, credentials validation and cancellation. Complete localization without raw message-key errors.
3. Verify actual development Chrome dialog at popup and manager widths, keyboard close and input preservation. Mock translation HTTP only, no user credentials or billable requests. Separately verify selected caption/translation tracks reach saved MP4 through existing unit/integration tests.
4. Fresh read-only review; full tests, project/locales, package/Store graph inspection. Preserve other root changes during integration, record exact evidence, update upstream notes and local commit.

Execution: actual Chrome RED/GREEN covered submit/cancel permission races. The final routing follows the user's correction: ordinary quick download, Shift-click options. The read-only review's three findings were fixed with regression coverage; saved subtitle tracks are independently parsed from real MP4 outputs. No paid translation request, Computer Use, Studio session or Store browser execution. Final check counts and artifact paths are recorded in the verification evidence.
