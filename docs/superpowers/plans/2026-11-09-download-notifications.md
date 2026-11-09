# Chrome Download Notifications Implementation Plan

> For agentic workers: use superpowers:executing-plans inline, TDD, one fresh final review.

**Goal:** Chrome desktop alerts for unseen completed downloads and actual scheduled starts, controlled in options.
**Architecture:** background-owned state/event controller using native download events and job-storage changes. Popup publishes displayed request IDs over an authenticated live port; runtime.getContexts validates actual POPUP/SIDE_PANEL surfaces. Persistent per-job event claims deduplicate suppressed and emitted events; no heartbeat polling or browser-history scans.
**Tech Stack:** existing MV3 JavaScript, Chrome116+ notifications/permissions/runtime/storage APIs, existing ten catalogs and check tools.
**Spec:** ../specs/2026-11-09-download-notifications.md

## Constraints and review focus

- No Computer Use, external publishing, new dependencies or vendor modification. Actual browser tests development only; Store inspection only.
- Only successful completion and first positive scheduled bytes trigger. Missing permission, native API failure and stale UI must not affect the transfer.
- Per-request identity matters when multiple jobs share a media key. Native completion can precede job download-ID persistence.
- Chrome optional permission requests must remain directly inside the checkbox gesture; rejection rolls the option back.
- Worker restarts, hidden/closed popup connections and unknown senders must not produce duplicates or stale suppression.

## Tasks

- [x] RED policy/controller tests for the visibility matrix, scheduled zero/positive transition, duplicate/restart claims, API failure, foreign/native-complete race and UI sender authentication.
- [x] Implement lib/download-notifications.js and background listeners, scheduled identity, popup view publisher and displayed-request reporting. GREEN tests.
- [x] RED options permission/rejection/persistence tests; implement options-notifications.js, settings/defaults, HTML, manifest optional permission and ten catalogs. GREEN tests.
- [x] Actual normal development Chrome: real popup/side-panel contexts, all completion cases, options persistence, actual native completion plus scheduled-event fixture -> registered notifications. No claim of OS audible output without observation.
- [x] Focused/full checks sequential with package builds, project/locales/Store graph inspection, final review, docs/evidence/upstream and scoped local commit preserving root overlays.

## Ledger

Ruling: request uses Chrome desktop notifications; two opt-in settings default off to avoid permission escalation disabling existing installs. The completion condition uses represented request IDs, not scroll clipping, because the user specified presence of an item. Scheduled-start alerts are unconditional on UI visibility because only completion was given that restriction.

Ruling: actual Chrome popup message senders omitted documentId. Switched UI ownership to authenticated live ports, with current-state refresh/acknowledgement at completion and automatic disconnect cleanup. Chrome context types validate surfaces; ordinary popup HTML tabs never register (getViews popup/window check). Worker suspension requires no heartbeat: a completion refresh reopens the port.

Validation: scoped 470 passed/1 skipped/0 failed; focused14 passed. Actual normal Chrome accepted nine cases, four native downloads and three notification registrations, including the merged settings/row UI. Root UI overlays are preserved outside the notification commit. History tests include terminal/waiting metadata normalization and legacy completed native records. The localization auditor ignores DOM .name identifiers in its generic-key heuristic while retaining explicit Translate/data-i18n checks; this resolves a real root-UI false positive without inventing a message. Remaining local commit is the final action after these recorded checks.
