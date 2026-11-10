# Bilibili URL 검색 검증 — 2026-11-09

## 원인과 변경

- 사용자 URL: `https://www.bilibili.com/zh-Hans/video/BV1yS4q6mEan/` (원래 추적 쿼리를 포함한 주소로 실제 검사).
- 실제 플레이어는 Blob 소스를 사용하고 playurl JSON에서 분리된 `.m4s` 영상·오디오를 읽는다. 기존 검색기는 이 조각을 완전한 영상으로 취급하지 않으며 별도 MPD도 없어 후보가 나오지 않았다.
- `extension/lib/bilibili.js`에서 로케일 경로와 `p`를 파싱한다. 현재 문서의 `__INITIAL_STATE__`에 있는 bvid, cid, p, videoData.pages와 단일 플레이어를 대조한 뒤 Bilibili의 `/x/player/playurl`에 `fnval=1`, `qn=64`를 요청한다.
- 현재 세션에서 제공하는 단일 progressive MP4만 후보로 만든다. 분할 파일, 미리보기, DRM 표시, 전체 길이와 맞지 않는 파일, 자격 증명이 URL에 포함된 파일, 허용하지 않은 CDN은 제외한다. 검색 후 같은 URL에서 현재 part가 바뀌어도 예전 후보의 다운로드를 거부한다.
- 국내 기본 CDN이 직접 다운로드 요청에 `SERVER_FORBIDDEN`을 반환하는 경우를 관측했다. API가 제공한 동일 파일의 서명된 `upos-hz-mirrorakam.akamaized.net` 주소가 있으면 이를 우선 선택한다. URL 호스트나 인증 쿼리를 임의로 재작성하지 않는다.
- `extension/detection.js`의 검색·후보 재검증·현재 플레이어 미리보기 경로에 연결했다. 성공 결과는 30초 동안 공유하되 매 조회에서 문서·페이지·현재 part와 플레이어 소스를 다시 확인한다. API 응답에는 5초 및 1MiB 제한을 적용한다.
- 영구 host permission, 외부 의존성, 설치 프로그램은 추가하지 않았다. API 호출은 사용자가 접근을 허용한 페이지의 MAIN 월드에서 정상 세션으로 수행한다.

## 자동 검사

```powershell
node --test tests/bilibili.test.mjs
node --test --test-concurrency=1 tests/*.test.mjs
node --expose-internals tools/checks/verify-project.mjs
node tools/build/package-extension.mjs --flavor development
node --expose-internals tools/checks/verify-distribution.mjs --flavor development
```

- Bilibili 회귀 테스트 11개 통과.
- 최종 전체 테스트: 713개 중 712개 통과, 1개 건너뜀, 실패 0개.
- 초기 병렬 실행에서는 `distribution-package.test.mjs`가 패키징 중 `development/extension/sidepanel.js` 누락으로 한 번 실패했다. 해당 테스트 단독 재실행과 전체 순차 실행은 모두 통과했다. 공유 배포 산출물을 생성하는 테스트가 있으므로 최종 결과는 순차 실행 기준이다.
- 프로젝트 검사: JavaScript 354개, JSON 18개, 상대 import 819개, 로컬 참조 137개, 보존 파일 84개, 실패 없음.
- 개발용 패키지: 파일 225개, import 537개 검증 통과.

## 실제 Chrome 검사

재현 도구: `node tools/checks/probe-bilibili-chrome.mjs`.

- Chrome 157.0.8103.39, 격리된 임시 프로필, Computer Use 사용 없음.
- 테스트 복사본에 Bilibili 페이지 호스트만 허용했다. API 및 CDN용 확장 host permission은 추가하지 않았다.
- 추적 쿼리가 붙은 사용자 URL에서 MP4 후보 1개 검출. 반복 검색에서도 동일 mediaKey 유지.
- `Scan` → `ResolveCandidate` → `Enqueue` → Chrome 다운로드로 81,680,891바이트 파일 저장 완료.
- 실제 영상 트랙: AVC, 1280×720, 793.1000625초, 첫 패킷 2,820바이트.
- 실제 음성 트랙: AAC, 793.1239909297052초, 첫 패킷 406바이트.
- 저장한 MP4를 별도 Chrome에서 재생하고 끝부분으로 탐색했다. 791.585023초 위치에서 정상 재생, 음성 디코딩 47,252바이트, 미디어 오류 없음.
- 최종 증거: `artifacts/bilibili/chrome-1794200114639/report.json`.
- 전체 테스트 로그: `artifacts/bilibili/test-suite-final.log`.

초기 실다운로드 한 번은 도구의 90초 제한에 걸려 74,523,085바이트 수신 상태에서 종료됐다. 검사 도구의 제한을 5분으로 늘려 최종 완전한 파일을 검증했다. 별도 시도의 국내 CDN 403도 증거 폴더에 보존했다.

## 검증 범위

이 영상은 정상 세션의 progressive 720p MP4로 검증했다. DASH 전용 고화질 선택, 모든 Bilibili 콘텐츠·로그인 상태·지역에 대한 보편적 지원, 유료 또는 접근 제한 영상의 다운로드를 검증한 것은 아니다. 다른 채팅의 기존 변경은 유지했으며 커밋·푸시·스토어 게시를 수행하지 않았다.
