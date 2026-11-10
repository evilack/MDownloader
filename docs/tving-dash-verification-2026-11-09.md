# TVING DASH 진단 및 초기화 MP4 오인식 수정

대상: `https://www.tving.com/player/E004388799`

## 직접 확인한 원인

- 사용자가 제공한 MP4는 HTTP 200, `video/mp4`, 100,270바이트였다. MP4 구조에는 `soun` 오디오 트랙과 `moof`/`mdat` 조각이 있으나 영상 트랙은 없었다. 완전한 31분 영상으로 취급할 수 없다. 이 파일에서는 DRM 상자를 확인하지 않았다.
- 사용자가 별도로 제공한 본편 MPD는 HTTP 200, 16,804바이트였고 재생 길이는 `PT31M37.437234999S`, Period는 2개였다. 본편에는 `cenc` ContentProtection과 Widevine/PlayReady scheme UUID가 있었다. 브라우저 재생 가능 여부와 별개로 현재 다운로드 엔진은 이 보호된 본편을 일반 MP4로 저장하지 못한다.
- 비로그인 격리 Chrome에서는 180.096초짜리 미리보기만 재생되었다. 이 검사를 로그인 본편 다운로드 검증으로 취급하지 않는다.
- 수정 전 실제 페이지 스캔은 트랙 초기화 MP4 2개와 미리보기 MPD 1개를 별도 영상처럼 표시했다.
- 같은 MPD를 다시 요청하면 CDN과 서명이 바뀔 수 있었다. 새 요청의 본문만 사용하면 기존에 관측한 초기화 파일을 정확히 연결할 수 없었다.
- 실제 Chrome에서 MAIN/ISOLATED 등록이 같은 정책 JS 경로를 공유할 때 MAIN 관측기의 정책이 누락되고 본문 메시지가 나오지 않았다. MAIN 정책 파일 경로를 분리한 대조 실행에서는 정책과 실제 MPD 본문 메시지가 모두 확인되었다.

서명 쿼리, 인증 토큰, 콘텐츠 키 식별자는 이 문서와 테스트에 기록하지 않았다. 원시 응답과 진단 실행물은 Git에서 제외하는 `artifacts/tving-diagnosis/`에만 있다.

## 변경

- 재생목록 본문 관측에 MPD를 추가했다. 실제로 관측한 문서·출처·정확한 URL과 접근 권한이 일치하는 본문만 세션에 보관하며 탭별 원문 크기를 제한한다.
- 원래 본문을 우선 파싱하고, 관측 전에 열렸던 페이지에 한해 제한된 재조회로 보충한다. 다른 CDN이나 서명으로 바뀐 주소를 추측해서 합치지 않는다.
- DASH가 명시한 정확한 초기화 URL을 문서·페이지 범위에서 누적 보관하고 독립 파일 후보에서 제외한다. 다른 서명, 다른 프레임, 독립 MP4, 전체 파일과 초기화 범위를 공유하는 SegmentBase/범위 파일은 유지한다.
- 스캔당 신규 파싱은 2개로 제한하지만 이후 MPD도 다음 스캔에서 검사한다. 후보 저장에는 MPD 원문을 복제하지 않는다.
- MAIN 정책을 별도 경로로 생성하며 기존 ISOLATED 정책과 같은 단일 원본 설정에서 생성·검사한다.
- 광고/안내 Period 뒤에 보호된 본편이 있는 MPD는 일반적인 다중 Period 오류 대신 기존 DRM 미지원 안내를 반환한다.

## 실제 브라우저 검증

최종 실행: `artifacts/tving-diagnosis/run-1794196439724/report.json`

- 실제 TVING 미리보기 스캔: MPD 1개, 독립 MP4 0개.
- 실제 페이지에서 MPD 원문 관측 메시지와 MAIN 정책 설치를 확인했다.
- 사용자 본편 MPD 원문을 실제 Chrome의 다운로드 파서에 전달한 결과: `stream_dash_encrypted`.
- 비로그인 미리보기는 H.264 영상과 AAC 음성으로 계속 파싱되었다.
- 사용자 브라우저의 로그인 상태 변경, DRM 라이선스/키 추출, 본편 복호화, 본편 다운로드 성공은 수행하거나 주장하지 않았다.

## 검사

- `node tools/build/build-page-policy.mjs --check`
- `node --test tests/dash-initialization.test.mjs tests/dash.test.mjs tests/network.test.mjs tests/native-hls-discovery.test.mjs`
- `node --test tests/*.test.mjs`
- `node --expose-internals tools/checks/verify-project.mjs`

관련 검사 33개는 모두 통과했다. 프로젝트 검사는 JavaScript 333개, JSON 17개, 상대 import 782개, 로컬 참조 134개, 보존 파일 84개를 검사해 실패 0개였다.

현재 트리의 최종 전체 검사: 총 661개 중 660개 통과, 실패 0개, 건너뜀 1개.

최종 결과는 `artifacts/tving-diagnosis/targeted-final.log`, `tests-current.log`, `check-final.log`, `live-final.log`에 보관한다. 최초 전체 검사에서 테스트 HTTP 서버의 모듈 경로 누락을 발견해 고쳤으며, 이를 다운로드 엔진의 실패로 집계하지 않는다. 이후 다른 작업에서 추가한 HLS 해상도 테스트 3개가 실패했고, 이번 DASH 변경을 통과하지 않는 별도 코드 경로임을 검토했다. 해당 작업의 코드 갱신 뒤 현재 트리로 전체 검사를 재실행했다.

로컬 소스 반영 후 Chrome 확장 관리 화면에서 MDownloader를 새로고침하고 TVING 페이지를 다시 열어 관측기를 설치해야 한다. 이 수정은 잘못된 파일 노출 및 오류 안내를 교정하며 DRM 본편 다운로드 지원을 추가하지 않는다.
