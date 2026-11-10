# FormSubmit issue report submission — 2026-11-10

## Implemented behavior

- Confirm submits selected issue types, optional details and the page URL to the extension worker. The worker sends a fixed-destination FormSubmit AJAX POST to `evilackyt01@gmail.com`.
- Subject: `MDownloader_report_YYYYMMDD-HHmmss_xxxxxxxx`. Time is Korea Standard Time; the suffix is 8 cryptographically generated hexadecimal characters. The JSON timestamp is UTC ISO 8601.
- Request fields: `_subject`, `_url`, `message`. There is no `name`, sender-email or Reply-To field. `message` is an indented JSON string with app/version, timestamp, reported URL, selected issue types and description.
- Only the extension's popup and sidepanel may invoke this worker operation. The worker validates the URL, type whitelist and description length before sending.
- Pending submission opens a blocking progress modal over the whole report, disabling interaction with all underlying controls, cancellation and duplicate submits. Success/failure opens a separate confirmation modal. Acknowledging success closes the result and report dialogs; acknowledging failure closes only the result dialog and keeps all entered values for retry.
- An HTTP 200 is insufficient: only boolean `true` or string `"true"` in `success` marks acceptance. Requests have a 20-second deadline and no automatic retries. Network errors explicitly acknowledge an uncertain submission result.

## FormSubmit source handling

Actual extension requests were rejected with `Make sure you open this page through a web server` even with `_url`, using both JSON and form-encoded test transport. The final transport remains JSON.

The extension temporarily sets matching HTTP Referer and Origin headers for exactly its FormSubmit POST/XHR endpoint, scoped to the extension initiator. Rule ID `2147000001` does not overlap existing media/distribution rules. Submissions serialize the rule lifetime; removal is attempted after success or failure. Cleanup failure does not turn an accepted submission into a retryable error.

The stable app source is `https://evilack.github.io/`, already linked as the developer's site by the product website. `_url`, Referer and Origin use this identity. The reported page URL remains in `message.page_url`. A new isolated extension instance with a fresh timestamp/random subject successfully submitted after this source was activated.

Official references: [AJAX](https://formsubmit.co/ajax-documentation), [special fields](https://formsubmit.co/documentation), [source URL and activation help](https://formsubmit.co/help).

## Verification

- `node --test tests/issue-report.test.mjs`: 9 passed. Covers title/time/suffix, omitted sender fields, JSON report schema, success-string handling, HTTP/body/network failures, validation, worker sender authorization, narrow header scope/removal and cleanup failure after acceptance.
- `node tools/checks/probe-issue-report-chrome.mjs`: passed using an isolated unpacked extension and a loopback endpoint, with popup -> worker -> POST routing, failure/input retention, explicit retry, pending lock, duplicate/ESC guards, accepted state and sidepanel integration. Actual Origin/Referer were asserted on the wire, and session rules were confirmed removed after success and failure. Evidence: `artifacts/issue-report-mock-1794312630581/`.
- New `issue_report_*` keys: all 22 keys match across all 10 locales.
- Related tests: 25 passed, 1 failed. The failure is existing full-catalog locale parity: Japanese lacks five unrelated panel-resize keys. Log: `artifacts/issue-report-send-tests-final.log`.
- Static project validation: see `artifacts/issue-report-send-project-check-final.log`.
- Code review completed without actionable findings for this scope.
- Follow-up modal behavior: `artifacts/issue-report-mock-1794313201382/` verifies seven integration flows, including the read-only URL being unfocusable while pending, separate failure/success notifications, and closing both dialogs only after success acknowledgement. Related unit/regression checks: 11 passed. Follow-up static validation: `artifacts/issue-report-modal-project-check.log`.

## Live status and installation boundary

Early real requests reached FormSubmit but returned `success: "false"` / activation required. The user supplied the confirmation link for the `https://evilack.github.io/` form. Opening that link returned `Form Activated` and named the expected source.

The subsequent final-source live test passed: isolated extension UI -> runtime message -> worker -> real FormSubmit AJAX POST -> HTTP 200 with `success: "true"` and `The form was submitted successfully.` The UI displayed the accepted state and the temporary header rule was absent afterward. Evidence: `artifacts/issue-report-live-1794312661717/verification.json` and `accepted.png`. The test report was clearly marked as implementation verification. Recipient inbox delivery was not independently read.

The running user Chrome extension has not been reloaded, and no distribution package was created. All browser verification used isolated profiles/copies.

To perform one clearly marked live integration submission after activation:

```powershell
node tools/checks/probe-issue-report-chrome.mjs --live
```
