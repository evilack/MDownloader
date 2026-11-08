# YouTube Download Implementation Plan

최신 사용자 지시: 개발판이 수동 설치판이며 배포 종류는 `development`와 `chrome-store` 둘뿐입니다. SABR/UMP를 포함한 확장 범위와 최신 결과는 [SABR 작업 계획](2026-11-08-youtube-sabr.md)을 따릅니다. 아래의 SABR 제외·이전 중단 설명은 초기 단계 기록이며 최신 확장 지시를 제한하지 않습니다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개발판(수동 설치판)에서 YouTube 다운로드를 기존 미디어 목록과 다운로드 관리자에 통합하고, Chrome 웹 스토어 제출판에서는 관련 기능과 실행 코드를 제외한다.

**Architecture:** 배포 종류를 빌드 시 고정하고, 공통 차단 정책을 감지·메시지·작업 등록·실제 전송에 적용한다. 개발판(수동 설치판)은 브라우저 내부 추출 어댑터와 기존 오프스크린 저장·Mediabunny 재포장을 우선 사용한다. 추출과 MV3 호환성은 실제 Chrome의 선행 검증으로 확정하며, 외부 프로그램을 필요로 하는 방식으로 임의 전환하지 않는다.

**Tech Stack:** 기존 JavaScript ESM / Manifest V3 / Node.js 24 검사 도구 / Mediabunny 1.65.2, 신규 후보 youtubei.js 18.3.0 / jintr 3.3.1 / esbuild 0.28.2.

**Spec:** 이 문서의 [설계와 범위](#설계와-범위), [배포 분리](#배포-분리), [인터페이스](#인터페이스)가 제안 명세다. 아직 사용자가 라이브러리·세부 지원 범위를 승인했거나 실제 다운로드가 검증된 상태는 아니다.


## 구현 진행 기록 — 2026-11-08

- Task 1: 로컬 커밋 21bca86. 배포 분리와 공통 차단, 생성된 store판의 실제 Chrome 일반 저장/YouTube 차단 확인.
- Task 2: 후보 및 전이 의존성 lockfile 고정, 로컬 번들/격리 worker/최소 어댑터/실패 테스트 구현. Computer Use 없이 별도 Chrome 검사 프로필의 정확한 선택적 호스트 권한 활성화 문제를 해결함.
- 지정 VOD -XHx839rSc8: 일반 페이지 HTTP 200·재생 가능, adaptive metadata 34개, 직접/cipher URL 0개·SABR 존재. offscreen WEB config/player POST는 자동 요청 관련 HTTP 403. 영상·음성 수신 및 저장은 미실행이며 Task 2 성공 게이트는 통과하지 못함.
- Tasks 3–5: 위 실패 때문에 감지/UI/화질/전송/병합/부분 저장 통합을 활성화하지 않음. 원래 provider entry는 youtube_not_verified를 유지함. Task 6의 배포 검사만 수행하며 전체 완료로 표시하지 않음.
- 최신 근거와 재현 절차: [검증 기록](../../verification.md#task-2-native-result--2026-11-08), [개발 안내](../../development.md). 아래 현재 기준과 제안의 미설치 설명은 계획서 작성 당시 상태임.

## 현재 기준

- 작업 경로: `E:\Project\MDownloader`.
- 시작 커밋: `6da81b7`, 확장 버전 `0.2.37`.
- 현재 핵심 검사: 257개 통과. 실제 구현 시작 시 HEAD·작업 트리·검사 결과를 다시 확인한다.
- 현재는 `extension/` 직접 로드, 별도 npm 빌드 없이 설치하는 구조다.
- `detection.js`가 감지/문서 소유권, `jobs.js`가 등록/파일명/제어, `hls-runner.js`가 오프스크린 수신/저장, `lib/stream-workspaces.js`가 임시 파일 수명을 관리한다.
- 이 파일은 새 채팅을 위한 계획이다. 현재 기능 추가·의존성 설치·스토어 업로드는 수행하지 않는다.

## Global Constraints

- 기존 HLS·DASH·WebRTC·부분 저장 기능과 병렬 작업을 유지한다.
- 팝업/관리자 수치 박스의 11px 글자, 12ch 너비, 색상, 버튼 순서를 유지한다.
- 원래 파일명이 없으면 제목과 현지 시작 날짜·시간을 사용한다. `MDownloader-`, `playback`, 임의 provider 이름을 추가하지 않는다.
- 날짜·시간 기본값 ON과 사용자의 명시적 설정을 유지한다.
- 개발판과 수동 설치판에서는 Chrome으로 개발·사용할 수 있어야 한다.
- 스토어판은 브라우저 종류와 관계없이 YouTube 기능이 없어야 한다. Chrome 감지는 추가 제한에만 사용한다.
- 사용자 설정·원격 설정·숨겨진 단축키로 스토어판 기능을 켤 수 없게 한다.
- 다운로드 권한이 있는 테스트 콘텐츠를 사용한다. DRM·유료·회원·로그인·연령·지역 제한을 우회하지 않는다.
- 상세 로그·영구 작업 기록에 쿠키·토큰·서명 URL·플레이어 스크립트를 남기지 않는다.
- 브라우저 판별이나 어댑터 실패 시 다른 사이트의 다운로드를 차단하지 않는다.
- 진행 중 다운로드가 있는 사용자 확장을 임의 재로드하지 않는다. GitHub 게시·푸시는 별도 요청 전까지 하지 않는다.

## 설계와 범위

### 구현 방식 비교와 제안

| 방식 | 장점 | 비용/제약 | 제안 |
|---|---|---|---|
| 브라우저 내부 추출 + 기존 저장 엔진 | 별도 프로그램 없이 기존 UX 유지 | YouTube 프로토콜 변경, URL 해석기, PO Token, SABR 및 MV3 제약 검증 필요 | 우선 검증할 기본안 |
| Native Messaging + yt-dlp + FFmpeg | 검증된 추출·병합 생태계 활용 | 별도 실행 파일·설치/업데이트·호스트 등록·권한·라이선스 관리 필요 | 기본안 실패 시 사용자에게 제시할 대안 |
| 외부 변환/프록시 서버 | 브라우저 제약 일부를 서버로 이동 | 운영비·세션/개인정보·서비스 장애·서버 유지 부담 | 초기 범위에서 제외 |

라이브러리 설치만으로 모든 YouTube 영상이 저장된다고 가정하지 않는다. 먼저 현재 Chrome 수동 설치 환경에서 공개 VOD 한 편의 실제 영상·음성 저장까지 확인한다. 실패하면 원인을 보고하고 범위/대안을 결정한다.

### 지원 순서

1. 단일 공개 VOD와 Shorts URL 정규화, 제목·썸네일·실제 화질 정보.
2. 합쳐진 미디어가 제공되면 직접 저장. 분리된 영상·음성은 두 소스를 받고 재인코딩 없이 병합.
3. 기존 Shift+다운로드 화질 선택과 다운로드 관리자 연결. 처음에는 검증된 MP4/H.264/AAC 조합을 기본값으로 사용.
4. WebM/VP9/Opus·AV1·음성 전용은 브라우저/컨테이너별 실파일 검증 후 추가. MP3 변환은 초기 범위가 아니다.
5. 라이브 HLS와 SABR/UMP는 별도 후속 작업. VOD 성공을 라이브/SABR 지원으로 확대하지 않는다.

재생목록/채널 전체 일괄 저장, 로그인 쿠키 추출, Premium·회원 전용, DRM, 자막·댓글 저장은 초기 범위에서 제외한다. `watch`, `shorts`, `youtu.be`, 허용된 embed 주소는 동일 videoId로 묶는다. YouTube SPA 이동 시 이전 문서/영상의 응답이 새 항목에 섞이지 않게 한다.

### 권한과 실행 위치

- `youtube.com` 페이지와 실제 조회에 사용하는 API 호스트, 선택한 `googlevideo.com` 미디어 서버에 필요한 접근만 기존 권한 요청 흐름으로 확인한다. 현재 광범위 optional permission을 자동으로 전부 허용하지 않는다.
- 새 `cookies`, `nativeMessaging`, `debugger`, `webRequestBlocking` 권한은 기본안에 추가하지 않는다. 제3자 프록시로 사용자 요청이나 세션을 보내지 않는다.
- 문서의 영상 식별은 기존 소유권 검사로 수행한다. 페이지에서 받은 URL/제목/메타데이터를 신뢰된 실행 코드로 취급하지 않는다.
- 수신·해석 세션은 원본 탭과 별도인 offscreen 문서가 소유한다. service worker는 권한과 작업 등록을 관리하고 큰 미디어 버퍼를 보관하지 않는다.
- 원본 탭을 닫아도 살아 있는 세션으로 수신을 계속한다. 만료 URL 갱신이 원본 페이지 없이는 불가능하면 해당 작업만 명확하게 중단하고 가능한 부분 출력을 처리한다.

## 배포 분리

### 동작표

| 배포 종류 | Chrome | Edge 등 지원 Chromium | YouTube 코드 |
|---|---|---|---|
| `development` | 허용 | 허용 | 포함 |
| `chrome-store` | 차단 | 차단 | 추출기·전송 어댑터·관련 vendor/worker 제외 |

수동 설치판에도 필요하면 `blockedBrowserFamilies: ['chrome']`로 Chrome만 막는 빌드 정책을 제공한다. 기본값은 빈 배열이므로 Chrome 개발을 막지 않는다. Chrome/Edge 구분은 UA-CH brands를 우선 확인하고 Edge를 Chrome보다 먼저 구분하며, UA 문자열은 보조 정보로 사용한다. Chrome 제한이 설정된 빌드에서 판별이 불명확하면 YouTube만 차단한다. 이 판별은 보안 경계나 스토어 적합성의 근거가 아니다.

### 게시판의 실제 제외

- `tools/build/package-extension.mjs --flavor development|chrome-store`로 원본과 별도인 `artifacts/distributions/<flavor>/extension/`을 만든다. flavor 누락/잘못된 값은 오류다.
- 원본의 명시적인 개발 정책은 개발 로드용이며, 제출판은 빌드로 생성한 경로만 사용한다. 스토어판 생성이 원본 정책이나 사용 중 확장을 덮어쓰지 않게 한다.
- 공통 entry 모듈은 동일 인터페이스의 disabled stub으로 교체한다. YouTube 기능 파일·vendor·해석 worker를 제출판에서 물리적으로 제외한다. dead-code elimination만 믿지 않는다.
- 스토어판에는 비활성 안내와 공통 차단 정책만 남긴다. 원격 다운로드·설정 동기화·개발자 옵션으로 코드를 다시 불러오는 기능은 만들지 않는다.
- `*.googlevideo.com` 직접 링크, YouTube frame, `youtube-nocookie.com` embed, 일반 MP4/HLS/DASH 감지, 재생 응답 수집, 기존 작업 재개를 통해서도 YouTube 전송이 시작되지 않아야 한다.
- 차단 판정은 신뢰된 문서/네트워크 관측의 출처와 최종 미디어 URL을 모두 사용한다. UI가 보내는 `provider` 필드만 신뢰하지 않는다. 명백한 YouTube 미디어 호스트는 출처가 불명확해도 차단한다.
- 호스트 비교는 정확한 도메인 또는 `.` 경계가 있는 하위 도메인으로 한다. `notyoutube.com`이나 `youtube.com.example.org`를 오인하지 않는다.
- 일반 미디어용 광범위 optional host permission이 있어도 위 차단을 우회할 수 없어야 한다. 모든 googleapis.com을 막아 다른 기능을 손상시키지 않는다.
- manifest, 실제 파일 목록, 정적 import 그래프, 전체 브라우저 테스트로 제출 패키지 자체를 검사한다. 스토어 심사를 통과한다고 보장하지 않는다.

Chrome 공식 문서는 YouTube 다운로드를 거부 사유로 명시한다. 또한 원격 JavaScript를 인터프리터로 실행하는 것 역시 MV3 정책 문제를 해결하지 못한다. 따라서 이 분리는 심사 시만 숨기는 동작이 아니라 제출판에서 기능을 제거하는 배포 방식이다. [스토어 거부 사유](https://developer.chrome.com/docs/webstore/troubleshooting#prohibited-products), [원격 코드 정책](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).

## 라이브러리와 의존성

2026-11-08 조사 기준의 후보이며, 설치·동작 검증은 아직 하지 않았다. 구현 시 버전과 전이 의존성을 lockfile로 고정하고 라이선스 고지를 보존한다.

| 항목 | 용도 | 설치판 구분 |
|---|---|---|
| `youtubei.js` 18.3.0, MIT | InnerTube 응답·format 해석·영상 정보 | 개발/수동판 후보; 스토어판 제외 |
| `jintr` 3.3.1, MIT | URL 서명/`n` 해석에 필요한 제한된 JS evaluator 후보 | 선행 검증 후 채택; 개발/수동판에만 포함 |
| 기존 Mediabunny 1.65.2, MPL-2.0 | 분리 영상·음성 입력의 demux/remux 및 MP4/WebM 출력 | 기존 vendor 재사용; 임의 업그레이드 안 함 |
| `esbuild` 0.28.2, MIT | YouTube 모듈·의존성을 로컬 ESM으로 묶고 배포별 entry 생성 | 개발 도구; 실행 시 CDN 사용 안 함 |
| Node.js 24 내장 `node:test`, crypto/fs | 기존 검사, 패키지 구성/해시 검사 | 개발 도구 재사용 |
| `googlevideo`, MIT | SABR/UMP 처리 | 후속 단계에서만 검토; 초기 필수 의존성 아님 |
| yt-dlp + yt-dlp-ejs + 지원 JS runtime + FFmpeg/ffprobe | 선택 가능한 외부 호스트 대안 | 별도 사용자 결정 전 설치/기본 의존성으로 추가하지 않음 |

`youtubei.js`의 관측된 전이 의존성은 `@bufbuild/protobuf`, `fflate`, `meriyah`다. 고정할 실제 버전은 생성된 lockfile에서 확인한다. 패키지 설치는 개발에만 필요하고, 배포받은 사용자는 준비된 extension 폴더를 로드하게 한다. 별도 YouTube Data API 키를 다운로드 수단으로 사용하지 않는다.

확인 근거: [YouTube.js](https://github.com/LuanRT/YouTube.js), [package 정보](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/package.json), [Jinter](https://github.com/LuanRT/Jinter), [esbuild](https://esbuild.github.io/api/#bundling), [GoogleVideo](https://github.com/LuanRT/googlevideo), [yt-dlp 의존성](https://github.com/yt-dlp/yt-dlp#dependencies). npm registry에서도 youtubei.js 18.3.0 / jintr 3.3.1 / esbuild 0.28.2를 확인했다.

### 선행 검증에서 반드시 해결할 사항

- YouTube.js는 URL decipher용 evaluator를 기본 제공하지 않는다. 공식 예제의 `new Function`을 service worker나 offscreen에 복사하지 않는다. 라이브러리의 기본 evaluator는 오류를 반환한다. [공식 가이드](https://ytjs.dev/guide/getting-started#providing-a-custom-javascript-interpreter), [기본 구현](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/src/platform/jsruntime/default.ts).
- evaluator는 개발/수동판 전용 별도 worker에 두고 `chrome`, 저장소, 임의 fetch, DOM을 노출하지 않는다. Jinter를 보안 sandbox로 간주하지 않는다. 실행 제한 2초, 입력 스크립트 4MiB 상한을 검증하며 timeout 시 worker를 종료한다. CSP를 전체 확장에서 완화하지 않는다.
- 일반 웹페이지의 CORS 예제와 host permission을 가진 확장은 다르다. 공식 브라우저 예제도 구식임을 경고하므로 그대로 이식하지 않는다. extension-origin fetch와 최소 권한으로 검증하고, 프록시 서버가 자동으로 필요하다고 가정하지 않는다. [브라우저 사용 안내](https://ytjs.dev/guide/browser-usage).
- `PO Token`, SABR만 제공되는 응답, 서명/URL 만료는 별도 실패 원인이다. 토큰 위조·자동 CAPTCHA 해결·클라이언트 무한 순회로 처리하지 않는다. 정상 세션에서 가능한 범위를 확인하고 나머지는 미지원 사유로 표시한다. [PO Token 기술 안내](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

## 인터페이스

실제 구현은 JavaScript + JSDoc으로 한다. 다음 타입 표기는 계약 설명용이다.

```text
DistributionPolicy = {flavor: 'development'|'chrome-store',
                      youtubeEnabled: boolean, blockedBrowserFamilies: string[]}
YoutubeIdentity = {videoId: string, canonicalUrl: string}
YoutubeFormat = {id: string, kind: 'muxed'|'video'|'audio', container: string,
                 codecs: string[], width?: number, height?: number, fps?: number,
                 bitrate?: number, contentLength?: number, language?: string}
YoutubeSelection = {videoFormatId?: string, audioFormatId?: string, output: 'mp4'|'webm'|'m4a'}
ResolvedYoutube = {videoId: string, title: string, duration?: number, thumbnail?: string,
                   formats: YoutubeFormat[], sessionKey: string}
```

- `CanUseYoutube(Policy, BrowserFamily): boolean` — 스토어판 판정을 최우선으로 하고 UI/worker/runner가 같은 판정을 사용한다.
- `IdentifyYoutubeUrl(Url): YoutubeIdentity|null` — URL/host/videoId를 정규화한다. query에 들어 있는 임의 주소를 요청하지 않는다.
- `IsYoutubeSource({pageUrl, frameUrl, mediaUrl}): boolean` — 문서 출처와 미디어 URL을 함께 검사한다.
- `DiscoverYoutube({tabId, documentId, pageUrl}, signal): Promise<ResolvedYoutube|null>` — 문서 소유권을 유지하며 메타데이터와 형식을 얻는다.
- `ResolveYoutubeSelection({sessionKey, videoId, selection}, signal): Promise<{tracks, expiresAt?}>` — 서명 URL은 메모리에만 두고 트랙을 전송 입력으로 정규화한다.
- `CreateYoutubeTransfers({workspaces, report, saveFile})` — `start(job, resolved, selection)`, `cancel(requestId)`, `finish(requestId)`, `snapshot(requestId)`를 제공한다.

`tracks`는 `{kind: 'video'|'audio'|'muxed', url: string, formatId: string, contentLength?: number, mimeType: string}[]`다. byte-range 파일 입력은 HLS segment 목록과 별도 계약으로 유지한다. 인터페이스 설명은 한국어, 사용자 문구는 기존 10개 언어 카탈로그를 사용한다.

## 파일 구성

| 작업 | 파일 | 책임 |
|---|---|---|
| 생성 | `extension/lib/distribution-policy.js` | 명시적 개발 정책과 공통 기능 허용 판정 |
| 생성 | `extension/lib/youtube-source-policy.js` | URL 식별과 일반 전송 경로의 출처 판정 |
| 생성 | `extension/features/youtube/entry.js` | 감지·형식·전송으로 연결하는 provider 경계 |
| 생성 | `extension/features/youtube/client.js` | youtubei.js의 fetch/cache/세션 어댑터 |
| 생성 | `extension/features/youtube/evaluator-worker.js` | 개발판 전용 제한된 서명 처리 |
| 생성 | `extension/features/youtube/transfers.js` | Range·분리 트랙 수신, 재포장, 부분 저장 |
| 생성 | `tools/build/package-extension.mjs` | 배포 종류별 독립 산출물과 비활성 stub 생성 |
| 생성 | `tools/checks/verify-distribution.mjs` | 산출물의 의존 그래프·manifest·차단 경로 검사 |
| 생성 | `tests/youtube-*.test.mjs`, `tests/distribution-*.test.mjs` | 아래 작업별 회귀 검사 |
| 생성 | `package.json`, `package-lock.json` | 개발용 의존성과 재현 가능한 로컬 번들 |
| 수정 | `extension/detection.js`, `extension/network.js`, `extension/playback.js` | 전용 감지 통합과 일반 경로의 공통 차단 |
| 수정 | `extension/jobs.js`, `extension/background.js`, `extension/hls-runner.js` | 인증된 메시지, 등록, 전송 직전 재검사 |
| 수정 | `extension/candidate-list.js`, `extension/_locales/*/messages.json` | 기존 다운로드·화질 UI, 비활성 사유 |
| 수정 | `.gitignore`, `THIRD_PARTY_NOTICES.md`, 양쪽 README, `docs/development.md` | 산출물 제외, 라이선스, 배포별 안내 |

번들은 `extension/vendor/youtube/` 아래 로컬 파일로 준비하고 라이선스를 함께 둔다. 스토어 산출물에는 이 폴더 전체가 없어야 한다.

## Review Focus

1. 스토어판에서 일반 MP4/HLS 감지·embed·직접 CDN 주소·기존 작업 재개로 YouTube 전송이 시작되는 누락.
2. SPA 이동, 같은 탭의 다른 videoId, 늦은 응답으로 영상·음성이 바뀌는 문제.
3. URL 만료/403 이후 중복 바이트를 쓰거나 다른 형식으로 조용히 바꾸는 재시도.
4. 영상·음성의 언어·코덱·타임라인 불일치와 짧은 음성 구간에서의 부분 저장.
5. 원본 탭 닫기, 한 트랙 실패, 취소, 공간 부족으로 다른 작업까지 중단하는 수명 관리.

## 구현 작업

### Task 1: 배포 경계와 일반 전송 차단

**Files:** 위 파일 표의 distribution/source 정책, 배포/검사 도구, detection/network/playback/jobs/runner. 검사: `tests/distribution-policy.test.mjs`, `tests/distribution-package.test.mjs`.

**Interfaces:** `DistributionPolicy`, `CanUseYoutube`, `IdentifyYoutubeUrl`, `IsYoutubeSource`를 먼저 고정한다.

- [x] development의 Chrome·Edge 허용, store의 모든 브라우저 거부, Chrome 추가 제한, 도메인 경계를 검사하는 실패 테스트를 작성한다.
- [x] `node --test tests/distribution-policy.test.mjs tests/distribution-package.test.mjs`로 미구현 실패를 확인한다.
- [x] 공통 차단과 배포별 생성, 명시적 제외 목록, 비활성 entry를 구현한다. 저장된 설정을 바꿔도 store의 거부가 바뀌면 안 된다.
- [x] 직접 미디어·embed·위조 provider·기존 작업 경로와 기존 전체 테스트를 통과시킨 뒤 로컬 커밋한다.

### Task 2: 실제 수동 설치 Chrome에서 추출 가능성 검증

**Files:** `client.js`, `evaluator-worker.js`, entry, vendor 번들·라이선스. 검사: `tests/youtube-client.test.mjs`.

**Interfaces:** `DiscoverYoutube`, `ResolveYoutubeSelection`. 처음에는 UI와 결합하지 않고 같은 계약의 픽스처로 검사한다.

- [x] 고정 응답, URL 만료, 해석기 시간 초과, 권한 거부, 미지원 SABR의 실패 테스트를 준비한다. `node --test tests/youtube-client.test.mjs`로 실패를 확인한다.
- [x] 후보 버전을 고정하고 로컬 번들을 만든다. worker에 필요한 최소 기능만 노출하고 라이브러리 로그의 민감한 출력을 막는다.
- [ ] 본인 소유/허가된 공개 VOD로 실제 Chrome unpacked에서 정보 조회 → 미디어 응답 → 영상·음성 읽기를 확인한다. Node 성공만으로 통과하지 않는다.
- [ ] MV3·PO Token·SABR 때문에 성립하지 않으면 결과를 보고한다. 실패를 숨기고 UI 구현으로 진행하지 않는다. 성립하면 의존성과 최소 어댑터를 로컬 커밋한다.

### Task 3: YouTube 후보와 화질 선택

**Files:** entry, detection, candidate-list, background, 10개 언어. 검사: `tests/youtube-detection.test.mjs`, `tests/youtube-quality.test.mjs`.

**Interfaces:** `ResolvedYoutube`, `YoutubeFormat`, `YoutubeSelection`. UI에는 서명 URL 대신 sessionKey와 format ID를 전달한다.

- [ ] watch/Shorts/단축/embed의 동일 ID 처리, 광고 제외, SPA 전환, 늦은 응답, 중복 후보를 실패 테스트로 고정한다.
- [ ] 기존 후보·Shift 선택에 연결한다. 기본값은 사용 가능한 호환 MP4 중 최고 해상도, 같은 해상도에서는 fps/bitrate 순이다. 음성은 기본 언어를 우선하고 다른 언어를 조용히 섞지 않는다.
- [ ] `node --test tests/youtube-detection.test.mjs tests/youtube-quality.test.mjs`와 번역 검사를 실행한다.
- [ ] development에서 선택 가능하고 store에서는 조회 자체를 시작하지 않음을 확인해 로컬 커밋한다.

### Task 4: 병렬 수신·음성 통합·저장

**Files:** transfers, jobs, hls-runner, 기존 workspace/output 도구. 검사: `tests/youtube-transfers.test.mjs`.

**Interfaces:** `CreateYoutubeTransfers`와 기존 job/report/saveFile 계약. URL을 얻은 직후 대상 videoId/format ID를 다시 확인한다.

- [ ] 분리 영상·음성, Range 무시 200, 잘못된 Content-Range, URL 만료, 한쪽 실패, 공간 부족, 병렬 작업 독립성을 실패 테스트로 만든다.
- [ ] 전체 파일을 메모리에 쌓지 않고 OPFS에 순서대로 쓴다. 기존 한도인 총 16GiB·개별 요청 32MiB·같은 작업 합계 4개 동시 전송을 지킨다. 처음 Range는 4MiB이며 Range 지원을 확인한 소스만 병렬화한다.
- [ ] Mediabunny로 별도 입력의 영상·음성을 재포장한다. 일반 byte-range MP4를 HLS LocalPlaylist로 위장하지 않는다. URL 갱신은 같은 videoId/format으로 최대 1회, 검증한 바이트 위치부터 수행한다.
- [ ] `node --test tests/youtube-transfers.test.mjs`, 원본 탭을 닫은 뒤 실제 수신, 저장 파일의 영상·음성 재생을 확인하고 로컬 커밋한다.

### Task 5: 중지·현재까지 저장과 UI 유지

**Files:** transfers, 기존 partial/output 도구. 검사: `tests/youtube-partial-save.test.mjs`.

**Interfaces:** `cancel`, `finish`, `snapshot`. 기존 버튼 순서와 저장 준비 판정을 재사용한다.

- [ ] 처음부터 연속된 영상·음성 범위, 짧은 음성, 끝부분 메타데이터, 동시 snapshot, 부모 취소와의 분리, 빈 출력을 실패 테스트로 만든다.
- [ ] 안전하게 재포장할 수 있는 구간만 저장한다. 필요한 메타데이터가 없을 때 저장 버튼은 비활성화하고 빈 MP4를 성공으로 처리하지 않는다.
- [ ] `node --test tests/youtube-partial-save.test.mjs`와 기존 부분 저장 검사를 실행한다.
- [ ] 11px 공통 수치 박스·8px 진행 바·파일명·다른 작업의 독립성을 실제 화면에서 확인하고 로컬 커밋한다.

### Task 6: 배포물 자체 검증과 인계

**Files:** 배포/검사 도구, 양쪽 README, development/verification, 외부 구성 요소 고지.

- [ ] 두 배포물을 생성하고 store에서 YouTube 어댑터·vendor·해석기가 제외되며 import 누락이 없음을 검사한다. 일반 CDN 경로에서도 네트워크 요청이 시작되지 않아야 한다.
- [ ] 실제 Chrome에서 development 저장 성공, 생성된 store판의 YouTube 거부와 일반 사이트 동작을 확인한다. 검사 프로필을 사용하고 진행 중인 사용자 작업을 중단하지 않는다.
- [ ] `node --test tests/*.test.mjs`, `node tools/checks/audit-localization.mjs`, `node tools/build/build-page-policy.mjs --check`, `node --expose-internals tools/checks/verify-project.mjs`를 실행한다.
- [ ] `node tools/checks/verify-distribution.mjs --flavor chrome-store`를 통과시키고 배포별 README·남은 제한·라이선스를 갱신한 뒤 로컬 커밋한다. 공개·업로드는 하지 않는다.

## 완료 판정

- 개발판(수동 설치판)에서 실제 Chrome VOD의 영상과 음성이 함께 저장·재생된다.
- 화질 선택과 제목·날짜·시간 파일명이 기존 흐름에서 작동한다.
- 다른 HLS/WebRTC 작업 및 source-tab 종료 후 수신이 유지된다.
- 안전한 구간에서만 중지·부분 저장이 가능하고 빈 파일을 성공으로 표시하지 않는다.
- 생성된 store판에서 UI·메시지·일반 감지·CDN 직접 주소·기존 작업 재개 모두 YouTube 전송을 시작하지 않는다.
- store판에 YouTube 추출기·해석기·vendor가 없고, 설정·원격 변경으로 다시 켤 수 없다.
- 새 테스트를 포함한 전체 검사가 통과하며, Node/픽스처/실제 Chrome 확인 범위를 구분해 기록한다.

## 새 채팅에 전달할 요청문

```text
E:\Project\MDownloader의 docs/superpowers/plans/2026-11-08-youtube-download.md를 읽고 YouTube 지원을 진행해 주세요.
먼저 현재 HEAD와 작업 트리를 확인하고, Task 1 배포 분리와 Task 2 실제 Chrome unpacked의 추출·수신 검증부터 진행해 주세요.
개발판(수동 설치판)은 Chrome에서도 사용할 수 있어야 하고 Chrome Web Store판에는 YouTube 코드를 제외해 주세요.
버튼만 숨기지 말고 일반 MP4/HLS·embed·googlevideo·재개 경로도 막아 주세요.
추가 프로그램·서버 방식으로 임의 전환하지 말고 실패 조건을 보고해 주세요.
기존 기능·파일명·UI를 유지하고 로컬 커밋까지 진행해 주세요. GitHub push와 스토어 제출은 하지 마세요.
```
