# YouTube.js 연동 변경 기록과 업데이트 절차

기준일: 2026-11-09. 이 문서는 YouTube.js 업데이트 때 MDownloader의 연동 변경을 다시 대조하기 위한 별도 기록이다. 현재 개발판은 수동 설치판이며, 스토어판에서는 YouTube 코드와 실행용 sandbox를 제외한다.

## 공식 원본과 고정 버전

| 항목 | 고정값 / 출처 |
|---|---|
| 실제 사용하는 공식 패키지 | `youtubei.js@18.3.0`, [LuanRT/YouTube.js](https://github.com/LuanRT/YouTube.js) |
| npm 원본 | `https://registry.npmjs.org/youtubei.js/-/youtubei.js-18.3.0.tgz` |
| npm에 기록된 원본 Git commit | `204715b6acfb063dc306d8677e36fdbf09f293c5` |
| npm integrity | `sha512-6Cwn/U8a+OjpZp5XgqOjwy7Lk0RrGavm3I5zO7qZWO+fes20vhWMZnlUs0h/97SwjS0AsxAZrZ5bJ85XBJVWTw==` |
| SABR/UMP 라이브러리 | `googlevideo@5.0.1`, [LuanRT/googlevideo](https://github.com/LuanRT/googlevideo) |
| MP4 병합 | 기존 `Mediabunny 1.65.2` |
| 참고한 YouTube.js main | `ec7ef07aa194e7ecc58634f27932fed1164ebb8f` |
| 참고한 googlevideo main | `c0e73b283310c771cddc5af8993f0e6b55a7578e` |

**공식 패키지 내부에 직접 적용한 패치: 없음.** `node_modules/youtubei.js`를 수정하거나 비공식 fork로 교체하지 않았다. 아래 변경은 MDownloader가 소유하는 연결 코드, 실행 환경, 패키징과 생성 번들에 적용했다. npm 배포본과 GitHub main 예제의 시점은 다르며, main을 그대로 설치한 것으로 기록하지 않는다.

빌드 산출물은 `extension/vendor/youtube/`에 있다. 파일별 SHA-256, 의존성 버전, lockfile SHA-256은 [provenance.json](../extension/vendor/youtube/provenance.json)에 기록한다. 생성 번들을 손으로 수정하지 말고 원본 연결 코드에서 다시 빌드한다.

## MDownloader가 추가하거나 바꾼 부분

| 소유 파일 | 변경과 이유 | 업데이트 때 대조할 upstream 계약 |
|---|---|---|
| `tools/build/youtube-client-entry.mjs` | 공식 `youtubei.js/web`을 로컬 번들로 묶고 원시 URL/오류 로그를 끈다. `SabrClientProfile`은 upstream `Constants`에서 VISIONOS 이름·ID·버전을 가져온다. | `Innertube.create`, `Platform.shim.eval`, `CLIENTS.VISIONOS`, `CLIENT_NAME_IDS.VISIONOS` |
| `extension/features/youtube/client.js` | `transport:'sabr'`를 명시적으로 지원한다. WEB에서 같은 공개 VOD의 OK/비실시간 상태를 먼저 확인하고 VISIONOS 응답의 ID·상태·설정도 재검증한다. 서명 URL과 설정은 세션 메모리에만 보관한다. | `getBasicInfo`, `basic_info`, `streaming_data`, `player_config`의 snake_case 구조 |
| 같은 파일의 선택 처리 | itag가 같은 원본·더빙·DRC 음성을 구분하기 위해 세션별 고유 포맷 ID와 인덱스를 유지한다. 임의로 첫 itag를 선택하지 않는다. | 형식 배열의 순서 및 `itag`, `xtags`, 오디오 트랙 정보 |
| `evaluator.js`, `evaluator-frame.js`, `evaluator-sandbox.html/js`, `evaluator-native-worker.js` | 공식 콜백이 제공하는 코드는 마지막 `return`을 포함한 함수 본문이다. 현재 플레이어 코드의 실행 방식에 맞춰 opaque sandbox가 만든 단발 워커에서 네이티브 JS로 실행한다. 확장 페이지의 eval 금지는 유지한다. | `Platform.shim.eval(data, environment)`의 입력·출력 및 실제 `Player.decipher` 호출 |
| 같은 실행 경계 | 입력 4 MiB, 결과 sig/n 문자열 각 8,192자, 부모의 2초 제한. 전용 MessageChannel 사용. 워커 전역과 해당 prototype의 네트워크·저장소·확장 API를 제거하고 sandbox `connect-src 'none'` 적용. 평가 후 sandbox의 워커 종료 확인 응답을 기다린 뒤 프레임·채널을 정리한다. 평가 제한과 별도로 종료 확인에는 최대 1초 제한을 둔다. | 새로운 코드가 추가 전역 객체를 요구하는지, native Chrome CSP와 격리 동작 |
| `tools/build/youtube-sabr-entry.mjs` | 고정 googlevideo의 `SabrStream`과 `buildSabrFormat`을 감싼다. 기존 로컬 번들 구성 유지. | 생성자, 공개 `formats` 배열과 입력 배열의 순서, 정확한 포맷 객체 선택, 스트림 끝 시각 |
| `extension/features/youtube/sabr.js` | 선택한 정확한 정규화 포맷 객체를 전달한다. 각 포맷의 정밀 길이로 완료를 판정하고 정수 페이지 길이와도 일관성을 검사한다. 승인 1 / 대기 2 / 거부 3을 구분한다. | `Receiver.formats`, `selectedFormats`, `videoEndTimeMs`, `audioEndTimeMs`, protection 이벤트 |
| `extension/features/youtube/remux.js` | 부분 저장은 공통 구간을 유지한다. 전체 수신이 검증된 경우 `preserveTrackEnds:true`로 더 긴 음성 끝부분까지 모든 패킷을 보존한다. | Mediabunny packet/source API와 코덱·컨테이너 호환성 |
| `extension/manifest.json`, 패키징/검사 도구 | 개발판에만 sandbox/CSP를 둔다. 스토어판은 provider/vendor 파일뿐 아니라 sandbox manifest/CSP 참조도 제거·검사한다. | Chrome MV3 sandbox/CSP 및 패키지 import graph |

기존 Jinter 워커 번들은 이전 구현의 산출물로 유지하지만 기본 실행 경로는 위의 독립 sandbox 워커다. 이전 Jinter의 `return` 문맥·전역 객체·prototype 실행 불일치를 수정한 것처럼 공식 YouTube.js 패치 목록에 넣지 않는다.

## 참고 자료와 채택 범위

- [YouTube.js 공식 실행기 문서](https://ytjs.dev/guide/getting-started#providing-a-custom-javascript-interpreter): 함수 본문 실행 콜백 계약을 확인했다.
- [YouTube.js browser 예제](https://github.com/LuanRT/YouTube.js/tree/ec7ef07aa194e7ecc58634f27932fed1164ebb8f/examples/browser): README가 outdated임을 명시하고 후속 예제를 안내한다. 이 오래된 예제의 외부 프록시는 채택하지 않았다.
- [공식 후속 SABR 예제](https://github.com/LuanRT/googlevideo/tree/c0e73b283310c771cddc5af8993f0e6b55a7578e/examples/sabr-shaka-example): VISIONOS 플레이어 응답, SABR URL decipher, Ustreamer 설정, 포맷 정규화와 클라이언트별 토큰 구분을 대조했다. Shaka UI·별도 bridge 확장은 사용하지 않고 기존 MDownloader 권한·수신·Mediabunny 경로로 연결했다.
- [distubejs/ytdl-core 참고 commit](https://github.com/distubejs/ytdl-core/tree/bf4336f5696600511557a3f14fee4b36ff412dfe): 서명 실행 격리와 PO 토큰의 content binding을 읽었다. 사용자 지정대로 참고만 했으며 패키지·Node 워커·jsdom 구현을 제품에 넣지 않았다.

## 업데이트 순서와 합격 조건

1. 위 기준 버전/commit과 새 버전의 diff·릴리스 내용을 확인한다. 버전, lock integrity, 라이선스와 이 문서를 함께 갱신한다.
2. `npm ci --ignore-scripts`로 고정 의존성을 준비한 뒤 `node tools/build/build-youtube.mjs`로 다시 묶는다. 생성된 `provenance.json`과 번들 변경을 검토한다.
3. `node --test tests/*.test.mjs`, localization, page-policy, project 검사와 두 배포판의 구성 검사를 실행한다. 같은 itag의 서로 다른 음성, 만료·제한·ID 불일치, 잘린 트랙, 전체 음성 끝 보존 테스트를 포함한다.
4. **실제 Chrome에서는 개발판만** `node tools/checks/probe-youtube-library-chrome.mjs`로 검사한다. 권한은 별도 검사 프로필의 정확한 API/CDN 호스트에만 부여한다. Computer Use, 사용자 프로필, yt-dlp/FFmpeg 실행 파일과 외부 다운로드 서버를 사용하지 않는다.
5. sandbox에서 부모 eval 차단, 전역/prototype API 제거, 무한 루프 시간 제한, 다음 평가 복구와 프레임 정리를 확인한다. URL이 추출됐다는 이유만으로 통과시키지 않는다.
6. 같은 영상 전체의 양 트랙 수신 끝·모든 패킷·시작/끝 구간 디코딩·실제 파일 저장·해시를 확인한다. protection 2/3 또는 부분 파일은 전체 성공이 아니다. 스토어판에 실행 코드나 sandbox 참조가 남으면 실패다.
7. [검증 기록](verification.md#browser-only-sabr-completion--2026-11-08)에 실행 환경·성공과 실패·UI 통합 범위를 구분해 남긴 뒤 로컬 커밋한다. UI/작업 관리자 통합 후에는 아래의 실제 UI 검증도 반복한다. 공개 배포는 별도 범위다.

## 2026-11-09: 개발판 일반 UI·작업 관리자 연결

공식 youtubei.js 18.3.0, googlevideo 5.0.1, Mediabunny 1.65.2의 버전·번들·원본은 변경하지 않았다. 아래는 모두 MDownloader 소유 연동 변경이다.

| 파일/경계 | 변경 | 업데이트 때 다시 확인할 계약 |
|---|---|---|
| features/youtube/entry.js, jobs.js | SW용 provider 작업은 정적 import. 추출 중에만 extension initiator + www.youtube.com/youtubei/ + POST의 Origin/Referer 규칙을 참조 계수로 유지·해제한다. 규칙 추가 실패도 참조를 남기지 않는다. | MV3 SW의 동적 import 금지, DNR 권한/발신자와 API 경로 |
| features/youtube/qualities.js | AVC 영상과 최고 비트레이트 AAC를 조합하고 영상 해상도 순서로 정렬한다. itag만 쓰지 않고 정확한 index ID를 유지한다. | upstream 포맷 codecs/kind/bitrate/크기 및 세션 ID |
| features/youtube/runner.js | 추출/서명 URL/설정은 offscreen 메모리. 런타임만으로 SW에 정확한 호스트 권한을 문의한다. 수신 → 전체 끝 검증 → Mediabunny → 공통 폴더/Chrome 저장. 저장을 마친 뒤 공통 workspace 수명 관리로 OPFS를 해제한다. | sandbox 함수 본문 실행, SABR 양 트랙 완료, native save의 비동기 수명 |
| detection/background/candidate-download | 현재 문서의 canonical YouTube 후보, 일반 클릭 최고 화질, Shift 화질 선택, 정확한 CDN 권한 요청. watch HTML을 미디어 URL로 미리보기하지 않는다. | 활성 문서/scan ID, 공개 WEB 검증, 선택 세션 소유권 |
| jobs/browser-job-state/job-row/metrics | YouTube는 youtube:true인 별도 전송이다. HLS로 표시/가장하지 않는다. 작업 등록·수신 바이트·병합·완료·취소·runner 상실을 연결한다. 주소나 Ustreamer 설정은 영속 작업/scan에 쓰지 않는다. | 활성 ID, 취소와 진행 보고 순서, 최종 다운로드 ID |
| store packaging | 새 provider 구현도 전부 제외하고 새 export의 비활성 stub만 제공한다. 실제 Chrome 검사는 개발판만 수행한다. | 모든 import/export, sandbox 참조와 물리 파일 제외 |

업데이트 후 개발판을 생성하고 node tools/checks/probe-youtube-ui-chrome.mjs 및 node tools/checks/probe-youtube-ui-chrome.mjs --auto를 실행한다. 실제 사이드 패널은 Playwright가 일반 페이지 목록에 노출하지 않아 CDP로 그 target에 연결한다. 일반 UI 버튼/품질 선택/관리자 완료를 사용하며 수신기를 직접 호출하지 않는다. 검사 프로필의 정확한 API/CDN 호스트만 사전 승인한다. OS 권한 팝업의 수동 인수나 일반 사용자 프로필 변경으로 해석하지 않는다.

이전 WEB protection 3의 모든 서버 원인을 해결한 것은 아니다. 공개 WEB의 제한 여부를 먼저 확인한 뒤 공식 VISIONOS SABR 세션으로 성공한 범위를 유지한다. [실제 UI 검증](verification.md#youtube-ui-integration--2026-11-09)을 참조한다.

독립 검토 후 첫 일반 클릭의 새 CDN 권한은 최고 화질 1개가 선택된 기존 확인 창에서 직접 요청하도록 변경했다. 비동기 추출 뒤 원래 클릭의 사용자 제스처에 의존하지 않는다. runner 종료 시에는 진행 보고 체인을 먼저 기다려 늦은 active 스냅샷이 canceled/failed 상태를 덮어쓰지 않도록 했다. 두 항목 모두 실패 재현 → 수정 후 통과 검사와 실제 1080p UI 수신·저장 재검사를 남겼다.

## 2026-11-09: YouTube 원본 자막 수신과 MP4 트랙 저장

공식 youtubei.js 18.3.0·googlevideo 5.0.1·Mediabunny 1.65.2의 원본과 번들은 수정하지 않았다. 이번 변경은 MDownloader adapter와 기존 공통 자막 모듈이다.

- `features/youtube/client.js`: 공식 `captions.caption_tracks`의 `base_url`, `language_code`, `name`, `kind`, `vss_id`를 읽는다. WEB/VISIONOS 목록을 언어·종류·vss ID의 합집합으로 보존하고, 같은 identity에만 VISIONOS 주소를 우선한다. 공개 목록에 URL을 내보내지 않는다. 자막 해석도 세션·영상 ID·서명 만료·권한을 재검사한다.
- `features/youtube/captions.js`: 기존 `ReadSubtitles`의 트랙·리소스·합계 바이트·큐·시간·동시성 제한을 재사용한다. YouTube 요청은 credentials omit이며 원본 언어를 모두 보존한다. 작업에는 개수·언어·시각·해시만 전달하며 본문과 signed URL은 offscreen 메모리 밖에 기록하지 않는다.
- `lib/subtitles.js`, `subtitle-mux.js`, `mp4-timed-text.js`: 기존 공통 수신·MP4 tx3g 병합기를 사용한다. WebVTT의 공백만 있는 payload 줄을 자막 구분자로 오인하지 않으며, 실제 빈 줄만 구분한다. 빈 payload 큐도 허용한다. SRT 구분 방식과 일반 수신의 credentials include 기본값은 유지한다.
- `runner.js`/`jobs.js`: 자막 수신 → 전체 AV 수신·병합 → 공통 자막 병합 → native/folder 저장 순서다. 제공된 자막의 수신·병합 오류는 작업 실패로 남긴다. 자막이 원래 없는 영상은 unavailable/개수 0을 명시해 기존 AV 다운로드를 허용하며 자막 검증 합격으로 보지 않는다.
- `probe-youtube-ui-chrome.mjs --auto --captions`: 실제 개발판 Chrome 사이드 패널에서 저장한 파일을 독립 ISO BMFF 파서로 읽는다. sbtl/tx3g·언어·sample tables·UTF-8 본문과 전체 문구/시각 해시를 수신 결과와 대조하고 전체 AV와 첫/끝 디코딩을 재검사한다.

업데이트 때 WEB/VISIONOS 일부 언어 차이, 자동/수동 자막 구분, 만료·권한 철회, 빈/공백 payload, 잘린 응답, mux 실패·취소를 반복 검사한다. 새 YouTube 자막 adapter도 스토어판에서는 feature 폴더와 함께 제외한다. 기존 공통 모듈에는 YouTube 추출 로직을 넣지 않는다. 같은 영상의 ASR 큐는 겹치지 않아 전체 cue 시각/본문 해시를 직접 비교했다. 겹치는 일반 자막은 합성된 tx3g 샘플과 달라질 수 있으며 별도 공통 병합 테스트에서 다룬다. 자동 번역 기능은 이번 변경에 추가하지 않았다.

작은 후속 개선: 비표준 HTTPS 포트를 가진 YouTube timedtext URL의 명시적 거부를 강화할 수 있다. 현재 실제 공식 자막은 기본 HTTPS origin이며 이 항목은 독립 검토의 Minor로 남겼다. [자막 검증](verification.md#youtube-captions--2026-11-09)을 참조한다.

## 2026-11-09: 자동 생성 자막 포함 옵션

공식 YouTube.js 원본·번들·버전은 수정하지 않았다. 기존 `caption_tracks.kind === 'asr'`를 자동 생성 자막의 판정 기준으로 사용한다. 표시 이름이나 언어로 추측하지 않는다.

- `lib/settings.js`, `options.html/js`: `includeYoutubeAutoCaptions`를 기본 true로 저장한다. 개발판의 다운로드 설정에 네이티브 체크박스·연결된 label/help/status를 추가했다. YouTube를 쓸 수 없는 스토어판에서는 숨기고 활성화하지 않는다.
- `jobs.js`/`runner.js`: 작업 등록 시 설정을 작업에 고정한다. 이후 옵션 변경은 새 작업에 적용되며 진행 중 작업의 선택을 바꾸지 않는다. 이전 작업에 필드가 없으면 기존 포함 동작을 유지한다.
- `client.js`: `ResolveYoutubeCaptions`의 세 번째 인자 `{includeAutoGenerated}`로 `kind=asr`만 제외한다. 선택에서 제외한 자동 자막의 만료·권한 검사를 하기 전에 필터링하므로, 받지 않을 자막의 만료가 수동 자막 저장을 막지 않는다. 수동·forced·알 수 없는 종류는 보존한다.
- `captions.js`: 미포함으로 선택 가능한 자막이 없으면 `not-selected`, 개수 0·자막 HTTP 0을 기록하고 정상 AV 저장을 유지한다. 자막 내용이나 signed URL은 저장하지 않는다.

기존 같은 영상의 영어·한국어는 모두 자동 생성 자막이다. 실제 개발판 Chrome에서 포함은 자막 2개, 미포함은 자막 HTTP 0회/MP4 자막 0개로 확인했다. 이 영상에는 수동 자막이 없어 수동+자동 혼합 보존은 fixture 회귀 검사로 구분해 검증했다. [옵션 검증](verification.md#automatic-caption-option--2026-11-09)을 참조한다.

## 2026-11-09: YouTube 페이지 플레이어 미리보기 연결

공식 YouTube.js 원본·번들·클라이언트 추출/자막 계약은 수정하지 않았다. canonical watch URL을 미디어 주소로 사용하지 않는다. `detection.js`에서 현재 scan/document/video identity를 확인한 YouTube 후보에만 pagePlayer 힌트를 부여하고, `media-preview.js`의 기존 짧은 캔버스 클립 경로에 연결했다. `player-previews.js`는 정확한 문서의 단일 표시 플레이어만 읽으며 녹화 중 주소·srcObject·소유권·모호성 변화가 있으면 결과를 폐기한다. 원본 트랙을 캡처/종료하거나 원본 재생 위치를 변경하지 않는다.

업데이트 후 `node tools/checks/probe-youtube-preview-chrome.mjs`로 사용자 영상 FACJInvEmY8의 실제 움직이는 hover 재생, 원본의 계속 재생, 빠른 닫기와 문서 이동 중 정리를 검사한다. 정지 이미지만 보이거나 원본만 움직이는 것은 통과가 아니다. 스토어판의 미디어 출처 차단은 이 경로에도 적용한다. [검증 기록](verification.md#youtube-hover-preview--2026-11-09)을 참조한다.
# YouTube partial save / finish integration — 2026-11-09

Official youtubei.js 18.3.0, googlevideo 5.0.1 and Mediabunny 1.65.2 source and vendor bundles are unchanged. This update changes only MDownloader integration:

- `features/youtube/track-store.js`: each received chunk closes into a new immutable OPFS file. Snapshot Blob inputs freeze committed file lists; pending writes and later chunks cannot change them. Do not replace with `getFile()` on a growing open writable: Chrome documents that changing its underlying file invalidates a File object ([Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)).
- `sabr.js`: separate `stopSignal` stops upstream reception, joins both copies and commits their received prefix. Explicit cancel, protection rejection and disk errors still fail/discard; full reception retains exact selected-format endpoint checks. No upstream `abort` implementation is patched.
- `runner.js`: readiness inspects the committed AVC keyframe, AAC packets and overlapping packet endpoints through Mediabunny; advertised SABR format duration cannot enable finish on initialization-only data. Authenticated `youtubeSnapshot` creates an independent save with its own abort signal and output workspace. Parent reception continues; parent chunks remain owned until child save ends. `youtubeFinish` only succeeds during a ready receiving phase and exports the AV common interval. After natural completion/muxing it is rejected. Cancel remains distinct and does not save a prefix.
- `remux.js`: reports actual remux start and duration. Partial caption tracks subtract that start, shared subtitle mux clips cue ends to output duration, and a language whose cues begin later is preserved as an empty track without pulling future text into the file. Original manual/automatic caption selection is retained.
- `jobs.js`, provider entry/stub and existing job-row actions: YouTube children stay `youtube:true, hls:false`; snapshot creates a separate partial file while finish marks the parent output partial and propagates that filename into picked-folder saving. Shared native/folder save owns file lifetime through completion. Store stub gains only disabled exports; provider/store exclusion remains physical.

Update checks: receiver stop/cancel/error races, immutable-prefix stability, child/native ownership, full endpoint tests, Store import graph, and actual development Chrome UI via `node tools/checks/probe-youtube-partial-chrome.mjs`. Native test uses the latest user video FACJInvEmY8 and network throttling in its isolated receiver to keep the action window open. No Computer Use, external program, raw caption/signed-media persistence, or Store browser execution. See the partial-save verification entry.

# YouTube job thumbnails and hover — 2026-11-09

Official YouTube.js/googlevideo/Mediabunny sources and bundles are unchanged. The adapter previously skipped preview preparation for YouTube jobs; the manager also omitted the capture callback used by candidate tiles. This update connects both paths without treating a watch page as playable media.

- Registration pins tab/document/page/canonical video identity in session-only preview source and prepares the existing small job thumbnail cache.
- `shared-thumbnail-cache.js` coalesces the same bound document/video thumbnail read across popup/manager, with the existing 15s refresh and 128-entry ceiling. Cache keys do not grant capture authority; page-player reads retain exact document checks. Empty/error results retry. Observations stay in SW memory and remap each caller's candidate ID.
- `JobThumbnails` reads the shared provider observation for active jobs and refreshes their existing thumbnail cache. Sidepanel reuses the same visibility/timeout/retry scheduler as popup candidates, stopping its old observer when rows change. No extra stream download fallback is enabled for job thumbnail reads.
- `CaptureJobPreview` accepts a registered job ID only, resolves the pinned source and reuses the existing bounded canvas-copy clip. It does not depend on a mutable scan ID. Capture after document navigation cannot borrow the new player. Source playback/tracks are untouched; playing/readable/unprotected source remains required for a moving preview.
- Completed picked-folder jobs preserve local-file preview precedence. Store policy checks cover the added routes, including older YouTube job flags without a source classification. Store provider/vendor exclusion remains physical.

Native check: `node tools/checks/probe-youtube-job-preview-chrome.mjs`, same FACJInvEmY8 source, normal quality/enqueue/manager UI and a throttled receiver. It requires both hovers to advance decoded frames, shared visible thumbnails, a changed thumbnail after refresh, continuing download, capture refusal after navigation and no leftover hover players/loading. No Computer Use or Store browser execution.

# Shared download-location confirmation — 2026-11-09

The common options form now preserves a picked directory when Save location is clicked, with an explicit default-location reset. No YouTube.js, googlevideo, Mediabunny, provider/runner code, vendor bundle or Store exclusion rule changed. This applies to all download providers; see the download-location verification entry for the real browser scope and picker fixture boundary.

# Completed shortcut correction and Shift playback — 2026-11-09

The previous custom folder-list implementation was rejected by the user and has been removed. Normal browser-managed downloads retain chrome.downloads.show. Shift-click on the same folder icon opens the complete saved file in a browser tab: a file URL for Chrome downloads, or a native video over the original granted folder handle for direct saves. No extraction request or second download is made. Native controls provide seek, volume and fullscreen.

Direct picked-folder Explorer reveal is implemented through an optional Windows PowerShell native-messaging bridge, prepared but NOT registered. It needs explicit user approval to register in HKCU and one manual folder link because FileSystemDirectoryHandle exposes no usable native path. Missing host reports the requirement instead of opening a substitute page. An actual FSA DOM.getFileInfo experiment returned an empty path; no debugger permission is included.

Provider/YouTube.js/googlevideo/Mediabunny sources and bundles are unchanged. Store source guards and physical YouTube exclusion remain. Native tests cover framing, strict caller/filename/size/fingerprint checks, binding persistence and mismatch refusal without launching Explorer or a folder picker. Actual development Chrome tests cover both Shift playback routes; actual registered Chrome-to-host/Explorer observation remains pending.

# Live and upcoming broadcasts — 2026-11-09

Pinned official youtubei.js18.3.0/googlevideo5.0.1/Mediabunny1.65.2 remain; no node_modules/upstream core patches or external extractor dependency. Generated client and SABR bundles/provenance change only because the local adapters now export/use official VideoInfo/NavigationEndpoint for a context-preserving player reload and pass callbacks/heartbeatParams to SabrStream.

- client.js: allow explicitly upcoming OK/LIVE_STREAM_OFFLINE as a metadata-only waiting choice; restricted WEB still fails before another client. Current live status uses is_live plus the authorized SABR broadcast source, excluding post-live DVR. isLiveContent alone is never a live test. Zero live duration is allowed; VOD finite duration remains required. OTF entries are allowed only through SABR.
- live.js/runner.js/qualities.js: abortable30s identity-pinned wait, bounded transient retry, fresh available AVC/AAC choice at start and no scratch allocation while waiting. Active owner persists in offscreen rather than an in-memory worker timer. Waiting/cancel UI and the usual prefix snapshot/finish connect to the same job/writer path. A live capture exports its actual common AV interval and offsets captions to that interval.
- Header requests acquire/release short DNR leases through an authenticated offscreen-only worker message; leases do not span a multi-hour wait. Initial confirm requests only the googlevideo CDN wildcard because redirects/live routing can change the exact server after that gesture. No web site can use this route.
- Initial heartbeat token/server data/interval and updated heartbeatServerData are preserved; heartbeat and reload use the same VISIONOS client/session. Server ReloadPlaybackContext is forwarded through the official NavigationEndpoint and VideoInfo types. Reloaded identity/host/playability/config/permission are revalidated; URLs/tokens remain in offscreen memory. Reviewer reproduced omitted heartbeat/context RED; both fixed GREEN.
- SABR live startup keeps the library live-edge sentinel; post-live DVR flag is propagated, only live finite-end checks are skipped. Auth/disk/protection/cancel still fail or cancel rather than reporting a whole broadcast. Remux remains packet-copy through Mediabunny, with source timestamps normalized to the saved interval.

Actual JXR579POAu4 is now an ended live archive (2992s), not an ongoing-live acceptance target. Its snapshot/finish outputs decoded with captions. A separately observed ongoing FRANCE24 broadcast HvZt-nh9sGg has isLive=true/isLiveNow=true/source=yt_live_broadcast; real development Chrome capture/save/decode is recorded separately. Actual upcoming webcam broadcast registration reached waiting state with zero bytes/no output. User then explicitly deferred actual scheduled broadcasting and requested the prepared Studio tabs closed; no webcam broadcast was started. Pure scheduled transition/cancellation tests do not substitute for that deferred external transition test.

Live timedtext acquisition still uses the shared caption snapshot path and does not claim continuous live ASR subscription; the tested public live supplied no caption tracks. VOD automatic-caption option and strict advertised-caption failure behavior remain unchanged. Physical Store provider/vendor exclusion stays verified; no Store browser test.
