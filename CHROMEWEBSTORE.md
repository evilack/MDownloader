# Chrome Web Store Listing — MDownloader

Last updated: 2026-11-11. Package preparation only; no store submission has been performed.

## Store listing

- Name: MDownloader (matches manifest).
- Short description: Save supported web video and audio, manage downloads, and include subtitles with optional translation.
- Category: Productivity.
- Single purpose: Save supported media selected by the user and manage the resulting files and subtitles.
- Primary language: English; ten interface locales are bundled.

Detailed description draft:

MDownloader detects supported video and audio on the current website and lets you save the media you are authorized to download.

Choose available quality and subtitle tracks, manage transfers in a side panel, and save completed files. Supported sources include direct media, compatible HLS, static unencrypted DASH and supported WebRTC sources. Optional subtitle translation uses a service you configure. Optional local speech recognition requires a separately installed local helper.

Open a supported page, grant site access, open MDownloader, and choose Download. Use Download options to select quality, subtitles and translation settings. Protected media and unsupported formats are excluded.

## Build and distribution

Run `npm run build:chrome` (or `node tools/build/package-extension.mjs --flavor chrome-store`). Upload the generated `artifacts/distributions/chrome-store/MDownloader-chrome-store-<version>.zip`; its root contains manifest.json. The package is verified before output is replaced. Keep `build.json` as the local checksum record.

This flavor physically excludes the restricted provider implementation, vendor bundles, interpreter sandbox, brand icon and caption settings. The existing site policy notice and source/network denial remain. Edge and manual development packages are separate outputs and are not Chrome submission artifacts.

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
| Required store screenshot | Existing website captures are available; store dimensions and final selected content need review |
| Privacy policy URL | Required before submission; not configured by this task |
| Publisher/contact information | Required in developer dashboard; not configured by this task |
| Support/homepage URLs | Choose and verify the public project URLs before submission |

## Version history and readiness

| Version | Date | Change | Status |
|---|---|---|---|
| 0.2.43 | 2026-11-11 | Reproducible Chrome, Edge and development packaging; Chrome provider removal with preserved policy notice | Local build, not submitted |

Build verification is separate from browser installation, real-site acceptance and store approval. Edge packages retain the complete feature set but likewise have not been submitted or approved.
