# YouTube partial save implementation plan

> Execute inline using executing-plans, TDD, and verification-before-completion. User authorized existing snapshot/finish behavior and local commit.

**Goal:** Connect snapshot and finish/save to YouTube AV and captions in the existing manager.
**Architecture:** Commit received chunks into immutable OPFS files. A snapshot freezes committed file lists as Blob inputs, with independent cancellation/output ownership; the parent retains chunks until all snapshot readers finish. Finish uses a dedicated receiver stop signal, drains writes, and remuxes the common playable interval. Cancel remains discard. Shared subtitle mux clips cues to exported duration and offsets by the remux start.
**Constraints:** Development/manual only, no Computer Use, no helper or upstream/vendor edits; Store physically excludes provider; preserve unrelated root changes. Same-video native verification uses FACJInvEmY8, the latest user-reported video. Existing rounded-623s full save remains covered by prior evidence.

## Task 1: Receiver and frozen prefix storage
- [x] RED: immutable snapshots survive further writes; unfinished writes excluded; graceful stop saves committed prefix while cancellation/protection/write failures do not become success.
- [x] Implement committed chunk store and independent stop signal; preserve full endpoint validation.
- [x] GREEN receiver/storage tests.

## Task 2: Runner, manager, and captions
- [x] RED: snapshot keeps parent receiving; duplicate/late requests rejected; finish differs from cancel; active IDs and scratch outlive saves; empty-overlap captions retained without out-of-range text.
- [x] Wire authenticated provider snapshot/finish messages, child YouTube jobs, existing native buttons and shared safe save. Return partial timing receipt and offset captions.
- [x] GREEN unit/integration tests, Store import/exclusion checks.

## Task 3: Native verification and delivery
- [x] Actual isolated development Chrome: UI snapshot and finish on FACJInvEmY8. Prove parent bytes increase after snapshot, both disk files decode beginning/tail video and nonzero audio, captions clipped within AV, receiver released after finish, no signed state persisted.
- [x] Fresh read-only whole-change review; resolve meaningful findings with RED/GREEN; run scoped suite, project/locales/package checks.
- [x] Update YouTube.js integration record and verification evidence, preserve root unrelated work via scoped index, local commit only.

Review focus: finish racing natural completion; cancellation or native interruption; snapshot cancel cannot cancel parent; source workspace cannot release during child save; audio-only/init-only prefix must not be advertised as playable.

Ruling: immutable chunks avoid repeated copying of a growing file and invalid File references when its underlying file changes (Chrome File System Access documentation). Capture only committed chunks. No raw source bodies, URLs or captions in receipts. One final local commit after native acceptance, per user request.
