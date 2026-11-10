# CHZZK HLS 수집 수정 검증 — 2026-11-09

## 범위와 원인

- 대상: `https://chzzk.naver.com/live/de6a400d191c13b9523717896a7e4e2f`
- 사용자가 제공한 `localhost:17080`의 1080p M4V 부분 조각이 일반 영상 후보로 표시되는 문제를 수정했다.
- CHZZK는 `방송식별자_chunklist.m3u8`와 `1080p_체크값_시각_순번_0_조각번호_부분번호.m4v`처럼 재생목록과 조각의 접두사가 다르다. 기존의 공통 접두사 판별에서 빠졌다.
- 소스 없는 보조 `<video>` 요소 때문에 Blob 플레이어가 두 개로 집계되어 기존 native HLS 본문 복구도 실행되지 않았다.

## 변경

- `extension/lib/media.js`: 같은 출처(포트 포함), 정확히 같은 방송/인증/화질 디렉터리, `/chzzk/` 경로, chunklist 이름, 관측된 숫자형 M4V 조각 패턴이 함께 맞을 때만 조각으로 판정한다. 완전 조각과 부분 조각을 모두 포함한다.
- 기존 `ObserveResponse` 경로에서 새 조각의 캐시 유입을 막으며, `ReadMediaContext` 경로에서 재생목록보다 먼저 들어온 조각도 표시 대상에서 제외한다. 이 두 네트워크 경로 자체는 변경하지 않았다.
- `extension/detection.js`, `extension/lib/native-hls-discovery.js`: 소스 없는 보조 미디어 요소를 단독 플레이어 판정에서 제외한다. 실제 소스가 있는 정지/로딩 중인 플레이어, `srcObject`, 선언된 `src`와 `<source src>`는 계속 센다. 기존 권한·문서·시점·미리보기·SPA 검사도 유지한다.
- localhost를 차단하거나 CDN 주소로 치환하지 않는다. 인증 경로와 P2P 쿼리도 그대로 유지한다.

## 실제 Chrome 검증

Chrome `157.0.8103.39`, 별도의 일반 화질/고화질 테스트 프로필과 현재 소스의 복사본을 사용했다. 테스트 복사본에만 관측에 필요한 호스트 권한을 부여했다. 기존 사용자 Chrome 프로필이나 설치된 확장을 재로드/수정하지 않았다.

고화질 프로필에는 기존 설치본인 네이버 동영상 플러그인 `1.0.2.4`를 로드했다. 처음에는 테스트 프로필의 루프백 접근 권한이 없어 요청이 차단됐다. Modern Web Guidance의 `local-network-access` 가이드에 따라 보안 검사를 끄는 대신, 테스트 프로필의 `https://chzzk.naver.com`에 `loopbackNetwork` 권한을 부여하고 재검증했다. 최종 검증에서는 실제 1080p 재생과 네이버 커넥터를 통한 M4V 응답이 발생했다.

페이지 로드 후 약 20초 시점에 첫 스캔을 하고, 6.5초 뒤 다시 스캔했다. 진단기는 실제 재생, 새 조각 응답 발생, 두 스캔 모두 비어 있지 않은 HLS 전용 후보 목록을 assertion으로 확인했다.

| 경로 | 실제 재생 폭 | 관측 M4V 응답 | 첫 스캔 후 추가 M4V 응답 | 첫/최종 후보 | M4V 후보 |
|---|---:|---:|---:|---|---:|
| 일반 화질 CDN | 853px | 50개 | 8개 | HLS 2개 → 2개 | 0개 |
| 고화질/P2P | 1920px | 31개 | 8개 | HLS 3개 → 3개 | 0개 |

일반 화질은 일반 HLS와 저지연 HLS의 상위 재생목록 2개가 남았다. 고화질에서는 여기에 `localhost:17080`의 1080p 상위 재생목록 1개가 추가됐다. 이 로컬 후보는 1920×1080 화질 및 라이브로 인식됐고, 로컬 하위 chunklist와 M4V 조각은 독립 후보에서 제외됐다. 서로 다른 전송 경로의 상위 재생목록을 임의로 하나로 합치는 변경은 하지 않았다.

로컬 원시 기록과 토큰을 제외한 요약은 Git에서 제외된 다음 경로에 보존한다.

- `artifacts/chzzk-investigation/result.json`: 수정 전 일반 화질 재현, M4V 30개 + HLS 3개.
- `artifacts/chzzk-investigation/cdn-after/summary.json`: 최종 일반 화질 검증.
- `artifacts/chzzk-investigation/p2p-after/summary.json`: 최종 1080p/P2P 검증.
- `artifacts/chzzk-investigation/verification.json`: 검증 시각, 소스 해시, 요약.
- `artifacts/chzzk-investigation/probe.mjs`: 실제 Chrome 진단기. P2P 실행에는 `MDOWNLOADER_NAVER_EXTENSION_PATH`로 기존 네이버 확장 경로를 지정한다.

## 회귀 검사와 리뷰

`tests/chzzk-detection.test.mjs`는 CDN·localhost·127.0.0.1의 완전/부분 조각, 보통 M4V 보존, 출처·포트·디렉터리·화질·문서 분리, 늦게 도착한 조각, 빈 보조 요소와 복수 소스 판정을 검사한다. 수정 전에 4개 테스트가 의도한 assertion에서 실패했고 보존 검사 1개는 통과했다.

최종 결과:

```text
node --test tests/*.test.mjs
594 tests: 593 pass, 0 fail, 1 skip

node --expose-internals tools/checks/verify-project.mjs
305 JavaScript, 17 JSON, 722 imports, 126 references, 84 preserved files
failures: []
```

기존 skip은 `MDOWNLOADER_LIVE_SUBTITLES=1`일 때만 실제 외부 사이트에 접속하는 `real supplied HTML declares all 23 subtitle languages on the same HTML5Player`이다. 첫 전체 실행에서는 별도 작업 중인 YouTube vendor build 테스트가 `jintr` 누락으로 실패했으나, 단독 재실행과 최종 전체 실행에서 모두 통과했다. 이 수정에서는 YouTube 빌드 파일을 변경하지 않았다.

별도 검토자가 수정 직전 기준본과 이번 세 파일의 차이만 리뷰했고 조치가 필요한 문제를 발견하지 않았다. 검토자가 독립 실행한 CHZZK/native-HLS/playback-HLS/selected-HLS/network 테스트 41개도 통과했다.

다운로드 전체 저장이나 장시간 P2P 연결의 내구성 검사는 이번 수집 수정의 검증 범위에 포함하지 않았다. 실제 사용 중인 확장에는 확장을 다시 로드하고 방송 페이지를 새로고침한 뒤 반영된다. 커밋·푸시·스토어 게시를 수행하지 않았다.
