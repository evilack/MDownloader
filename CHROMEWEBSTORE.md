# Chrome Web Store Listing — M Downloader

Last updated: 2026-11-14. Package preparation only. No store submission has been performed.

## Store listing

- Base name: M Downloader.
- English package title: M Downloader – Media, MP4, HLS (M3U8) & Live Stream Downloader.
- Korean package title: M Downloader – Media, MP4, HLS (M3U8) 및 라이브 스트림 다운로드.
- Short description: Save supported web video and audio, manage downloads, and include subtitles with optional translation.
- Category: Productivity.
- Single purpose: Save supported media selected by the user and manage the resulting files and subtitles.
- Primary language: English; ten interface locales are bundled.

Detailed description draft:

M Downloader detects supported video and audio on the current website and lets you save the media you are authorized to download.

Choose available quality and subtitle tracks, manage transfers in a side panel, and save completed files. Supported sources include direct media, compatible HLS, static unencrypted DASH and supported WebRTC sources. Optional subtitle translation uses a service you configure. Optional local speech recognition requires a separately installed local helper.

Open a supported page, grant site access, open M Downloader, and choose Download. Use Download options to select quality, subtitles and translation settings. Protected media and unsupported formats are excluded.

The first-use guide and missing site access messages link directly to Site permissions.

## Build and distribution

Run `npm run build:chrome` (or `node tools/build/package-extension.mjs --flavor chrome-store`). Upload the generated `artifacts/distributions/chrome-store/MDownloader-chrome-store-<version>.zip`; its root contains manifest.json. The package is verified before output is replaced. Keep `build.json` as the local checksum record.

Use the same store release ZIP for Chrome Web Store and Microsoft Edge Add-ons. It excludes the restricted provider implementation, vendor bundles, interpreter sandbox, brand icon and caption settings, and retains the site policy notice and source/network restrictions. Use the development ZIP for manual installation.

## Permissions justification

| Permission or host | Purpose |
|---|---|
| alarms | Coordinate pending work, transfer supervision and scheduled tasks while the browser runs. |
| activeTab | Access the selected page after the user opens the extension. |
| tabs | Read the active page address to display the store policy notice, including in the side panel without site permission. |
| scripting | Inspect supported media and attach local packaged page observers on approved sites. |
| downloads | Save media and read/control extension download progress. |
| downloads.open | Open a completed file when the user requests it. |
| storage | Store preferences, job history and bounded session state. |
| sidePanel | Display the download manager beside the current page. |
| clipboardWrite | Copy a media or saved-file location when requested. |
| webRequest | Observe media responses on approved sites for detection and request context. |
| offscreen | Run media transfer, recording and remux operations outside the popup. |
| declarativeNetRequest | Block extension-owned requests to restricted media hosts and apply scoped request headers for supported transfers and issue reports. |
| nativeMessaging | Communicate with optional installed local file/speech helpers and the optional credential importer. |
| notifications (optional) | User-enabled download completion and scheduled-start notifications. |
| https://formsubmit.co/* | Send an issue report only when the user submits the reporting form. |
| https://xszcdn11.com/*; https://v1.xsz2-cdn.com/* | Access supported media servers for the existing provider integration. |
| http://*/*; https://*/* (optional) | User-granted access to selected media pages, their media servers and configured translation services. |

## Privacy and data use

The package uses local preferences and history, page/media URLs and selected website content to detect and save media. Optional configured translation sends selected subtitle text and required credentials to the chosen service. User-submitted issue reports send the entered page URL, issue types and description through FormSubmit. Optional speech recognition runs through a local helper; setup downloads the selected dependencies/models. These are data transfers and must be reflected accurately in the dashboard and public privacy policy.

No certification of the dashboard privacy form is made here. Review the current owning implementations (`issue-report.js`, `translation-providers.js`, local caption setup) before submitting disclosures. Account credentials and tokens must never be copied into the listing.

## Graphics and developer details

| Requirement | Current status |
|---|---|
| 128×128 icon | Existing `extension/icons/app-media-128.png` |
| Required store screenshot | Actual Chrome store build, 640×400 PNG. Local outputs: `artifacts/chrome-store-review/downloads-en.png` and `artifacts/chrome-store-review/downloads-ko.png` |
| Privacy policy URL | Use the English policy URL after the website changes are deployed and verified. English: https://evilack.github.io/MDownloader/privacy.html · Korean: https://evilack.github.io/MDownloader/privacy-ko.html |
| Publisher/contact information | Required in developer dashboard; not configured by this task |
| Homepage URL | https://evilack.github.io/MDownloader/ |

## Reviewer test instructions

Copy the following into **Test instructions** in the Chrome Web Store Developer Dashboard:

> No test account or local helper is needed for the core download flow. Open https://evilack.github.io/MDownloader/sample/index.html?lang=en and play the sample MP4. Open the MDownloader toolbar popup. If Chrome requests access, allow access for this sample site, then refresh the media list if needed. Click Download on the detected `sample-film.mp4` row. The sample is hosted by this project for testing.
>
> Open the download manager using the side panel button in the popup. Wait for the sample to appear under completed downloads. Open the saved file or check it in Chrome Downloads and confirm that it plays. The extension uses Chrome's normal Downloads location by default. Use another profile or the sample site alone if you want to limit site access.
>
> For the policy check, open a YouTube page and open the MDownloader popup. The Chrome store build shows a policy notice and does not offer a YouTube download. This check does not require a download attempt.
>
> Subtitle translation requires credentials for the reviewer’s selected provider and sends relevant subtitle text to that service. Local speech recognition and some file integration features require separate optional local setup. Neither is required to reproduce the sample MP4 flow. The issue report form sends the reviewed report through FormSubmit only when submitted, so sending a report is not needed for this test.

The basic sequence in Korean is **샘플 페이지에서 영상 재생 → MDownloader 팝업에서 감지된 MP4 다운로드 → 사이드 패널의 완료 목록과 저장한 파일 재생 확인**입니다. 선택적 번역과 로컬 도우미는 이 테스트에 필요하지 않습니다.

On 2026-11-12, an isolated Chrome for Testing profile loaded the packaged Chrome store build. The popup detected the public sample MP4 and completed a real download. Its SHA-256 matched the repository sample. The download manager was captured in English and Korean at 640×400, and the YouTube popup displayed the policy notice with its media area hidden. The local capture record is `artifacts/chrome-store-review/verification.json`. These checks cover the core download and the policy notice. They do not establish approval or verify the optional translation and native-helper flows.

## Version history and readiness

| Version | Date | Change | Status |
|---|---|---|---|
| 0.2.46 | 2026-11-14 | Site access guidance for detected WebRTC streams and partial saves after live HLS interruptions | Prepared for review |
| 0.2.45 | 2026-11-14 | First-use guidance and a shortcut to Site permissions when site access is missing | Submitted to Chrome and Edge |
| 0.2.43 | 2026-11-11 | Reproducible Chrome, Edge and development packaging; Chrome provider removal with preserved policy notice | Local build, not submitted |

Build verification is separate from browser installation, real-site acceptance and store approval. Edge packages retain the complete feature set but likewise have not been submitted or approved.
