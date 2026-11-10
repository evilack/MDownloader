# Common helper verification — 2026-11-09

Mac follow-up: a [macOS common helper](../native/common-macos/README.md) and shared no-repeat-installer path have since been implemented. The user explicitly requested implementation only and no testing; no Mac tests/builds/installer/probe execution or generated package rebuilds were performed. The Windows results below are historical evidence for the Windows implementation and do not verify this later Mac/shared-module change.

The user selected a common native helper instead of downloading a caption CMD. The existing Windows Explorer helper now advertises helperVersion2/captionSetup and runs fixed caption setup/status actions. Native name, directory, installation identity, allowed origins and folder bindings stay compatible. Caption sources ship inside the common installer payload; requests contain no script, executable path or arbitrary files.

## Observed browser/native installation

tools/checks/probe-common-helper-chrome.mjs loads the production options binder/component, caption installer and native clients in isolated Chrome157. It registers two unique temporary native host aliases, then invokes the actual common helper/worker and actual managed-runtime/engine installation from the options button. Only the bootstrap destination and NoRegister setting are overridden. Existing user native keys and installations are not overwritten; temporary test keys are removed in finally.

Final actual result: **one install click; zero browser downloads; no downloads permission; common worker complete; real caption host connected; no models; no page errors**. Evidence: artifacts/common-helper-chrome-1794203691954/result.json and installed.png. This run includes the worker process-job fix. Required runtime/dependency network transfers occur inside the private installer; the zero-download figure refers to Chrome file-download events and specifically proves no caption CMD is downloaded.

Windows browser execution is now verified through this common-helper route, superseding the old downloads.open marker experiment. Initial installation/update of the common helper itself retains its separate bootstrap and OS confirmations. A current helper is the prerequisite; options display legacy/missing states and continue caption setup after the helper connects. macOS's previous PKG path is retained and not OS-verified by this Windows test.

## Boundaries and regression coverage

- Browser requests can only select installCaptions or captionSetupStatus with a bounded job ID. Other executable/path/payload arguments and unauthorized origins are rejected.
- Worker checks the exact nine filenames, source size and SHA256 hashes before writing/running sources. Junction paths are rejected.
- Same-origin duplicate requests reuse active work. Other origins cannot inspect or replace a job.
- A live worker never expires due to age; PID/start-time identity avoids PID reuse. State writes take the same mutex and recheck job/origin/expected status. Old observers cannot revert completion or overwrite a successor.
- Windows KILL_ON_JOB_CLOSE process ownership kills bootstrap descendants if the worker is terminated. A regression starts a real worker/child and confirms both stop, then observes interrupted state.
- Removal rejects active setup, coordinates on the setup mutex, and cleans only GUID staging folders' explicit source allowlist. Unknown files, media and separately installed caption engines/models are retained.
- The production Windows installer works without chrome.downloads/permission APIs. A pending native response has a bounded deadline; execution or worker completion alone never substitutes for a real caption engine probe.

Production-page fixtures cover missing/current/legacy common helpers, update→caption setup continuation, explicit model download and no-model initial state, vertical tabs at1280/680/390px, readable installation guide, saved/reverted defaults and per-download options. API fixtures are visibly labeled and perform no OS installation.

The first full working-tree test run passed **746 total:745 passed,1 skipped,0 failed**. The final shared-tree run had **753 total:751 passed,1 failed,1 skipped**. Its sole failure is tests/network.test.mjs:357, “keeps unchanged HLS observations stable after Chrome reorders stored object properties” (one cache write versus expected zero). Running that network file alone reproduces the failure. Network observation files were already modified outside this feature; they were not changed or suppressed here. No claim is made that the complete current shared tree is green. Logs: artifacts/common-helper-full-tests-final.log.

Final focused common-helper/Explorer/caption/package suite passed **54 tests, zero failures** (artifacts/common-helper-focused-tests.log); caption native Python tests passed **8 tests**. Production-page browser fixtures passed **13 checks, no page errors**; project checker passed **zero failures**. Both development and store distribution packaging/verification passed as part of the regression suites. The real browser/native result above was repeated after the Windows process-job and state-ownership fixes.

Code review identified live-job expiry/stale writes and interrupted staging cleanup. Both were fixed, regression-tested and re-reviewed with no further actionable findings.
