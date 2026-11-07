# WebRTC Shift 화질 조회 오류 — 0.2.29

사용자 화면에서 `import() is disallowed on ServiceWorkerGlobalScope` 오류가 발생했다. Shift+다운로드 → webrtcQualities → WebRtcQualities 경로에서 detection.js를 동적 import하던 것이 원인이다. Chrome 확장 서비스 워커는 동적 import를 지원하지 않는다([Chrome 공식 문서](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)).

webrtc-jobs.js에서 ResolveCandidate를 정적으로 import하도록 수정했다. 나머지 품질 선택·서버 전환·기존 관리자 저장 경로는 유지한다. 이전 Node 검증은 서비스 워커의 이 제약을 재현하지 않아 누락을 찾지 못했다.

새 회귀 검사는 실제 webrtc-jobs.js를 VM 모듈로 읽고 동적 import를 거절한 상태에서 화질 조회 함수를 실행한다. 수정 전에는 사용자 화면과 같은 TypeError로 실패했으며 수정 후에는 후보/문서/트랙/MAIN world 연결과 서버 목록 반환, 다른 포맷 거절, 서버 화질 불가 오류 전달까지 통과했다.

전체 Node 테스트 223개, JavaScript 167개를 포함한 프로젝트 검사, 10개 언어 × 373개 현지화 검사, 페이지 정책 생성물 일치 검사 및 git diff 공백 검사를 통과했다.

현재 Chrome 방송의 MAIN 관측기에서도 WebRTC 1920×1080 수신 및 source/720p/480p/240p의 실제 서버 프로필 네 개를 읽었다. 방송 화질이나 진행 중인 녹화/다운로드는 변경하지 않았다. Windows 컴퓨터 사용 없이 브라우저 API로 확인했다.

사용자가 확장을 새로고침한 뒤 Chrome의 MDownloader 문서에서 0.2.29 적용을 확인했다. 브라우저 도구로 실제 popup.html을 열어 확인하려 했으나 URL 정책이 chrome-extension 프로토콜 접근을 거부했다(http/https만 허용). 우회하지 않고 사용자에게 클릭 결과 확인을 요청했으며, 사용자가 같은 WebRTC 항목에서 Shift+다운로드 시 화질 선택창이 정상적으로 열린다고 확인했다. 이로써 보고된 화질 선택창 진입 오류의 해결은 사용자 확인까지 완료했다. 선택 화질 전환 후 최종 파일 저장 완료는 이번 사용자 확인의 범위에 포함되지 않는다.

변경 전 webrtc-jobs.js/manifest는 artifacts/webrtc-shift-fix-2026-11-08/originals에 보존했다. 회귀 테스트는 tests/webrtc-service-worker.test.mjs와 tests/helpers/webrtc-quality-service-worker.mjs에 있다.
