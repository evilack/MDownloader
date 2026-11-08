# YouTube.js 연동 변경 기록과 업데이트 절차

기준일: 2026-11-08. 이 문서는 YouTube.js 업데이트 때 MDownloader의 연동 변경을 다시 대조하기 위한 별도 기록이다. 현재 개발판은 수동 설치판이며, 스토어판에서는 YouTube 코드와 실행용 sandbox를 제외한다.

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
7. [검증 기록](verification.md#browser-only-sabr-completion--2026-11-08)에 실행 환경·성공과 실패·UI 통합 범위를 구분해 남긴 뒤 로컬 커밋한다. UI/작업 관리자 통합과 공개 배포는 별도 범위다.
