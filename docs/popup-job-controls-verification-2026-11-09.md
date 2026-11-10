# 팝업의 진행 중 작업 버튼 전환 — 2026-11-09

## 동작

사용자 요청: 라이브 다운로드 중 팝업 버튼을 “중지 및 저장”으로, 일반 다운로드 중에는 “취소”로 전환한다.

| 작업 상태 | 버튼 동작 |
|---|---|
| 시작 전 / 완료·취소·실패 등 종료 후 | 기존 다운로드 버튼과 Shift 다운로드 옵션 |
| 진행 중인 라이브 / WebRTC 녹화 | 중지 및 저장, 기존 `CanFinishJob` 준비 조건에 따라 활성화 |
| 진행 중인 일반 파일·유한 HLS·유한 YouTube / 예약 대기 | 취소 |
| 제어 요청 후 처리 중 | 해당 버튼 잠금; 실제 종료 후 다운로드로 복원 |
| 제어 요청 실패 | 오류 안내 후 해당 제어 동작 재시도 가능 |

새 아이콘이나 문구를 생성하지 않고 기존 아이콘 카탈로그의 `stop-save`, `cancel`, `download` 및 현지화 메시지를 재사용한다. 아이콘 버튼 형태는 유지하고 아이콘·툴팁·`aria-label`을 함께 전환한다. Modern Web Guidance의 `accessibility` 가이드에서 “Don't use `title` as a naming mechanism”을 적용하여 툴팁만으로 동작을 전달하지 않는다.

## 구현

- `extension/lib/candidate-download-state.js`: 다운로드 준비 상태와 최신 작업 스냅샷을 함께 관리한다. 작업의 실제 `requestId`로 제어 동작을 선택하며, 중지·저장 준비 여부는 관리자와 동일한 `CanFinishJob`을 사용한다. 성공 응답 뒤에도 오래된 active 스냅샷 때문에 중복 요청이 발생하지 않도록 버튼별 요청 잠금을 유지한다.
- `extension/candidate-row.js`: 작업 스냅샷을 공통 버튼 상태에 전달한다.
- `extension/candidate-download.js`: 진행 중인 작업에는 기존 `control` API로 `finish` 또는 `cancel`을 보낸다. 스캔 세대나 다른 후보의 다운로드 옵션 대기가 작업 제어를 막지 않는다. 신규 다운로드에는 기존의 스캔·동시 준비 검사를 유지한다.

## 자동 검사

`tests/candidate-job-controls.test.mjs`의 첫 5개 검사를 수정 전 실행하여 의도한 실패를 확인했다. 리뷰에서 발견된 스캔 세대 변경 / 다른 후보의 옵션 대기 상황도 각각 실패하는 테스트로 재현한 뒤 수정했다.

```text
node --test tests/candidate-job-controls.test.mjs tests/candidate-download.test.mjs tests/media-row-components.test.mjs tests/job-lifecycle-ui.test.mjs
36 passed, 0 failed

node --test tests/*.test.mjs
605 tests: 604 passed, 0 failed, 1 existing live external-site test skipped

node --expose-internals tools/checks/verify-project.mjs
307 JavaScript, 17 JSON, 728 imports, 126 references, 84 preserved files
failures: []
```

별도 검토자가 두 제어 차단 문제의 수정과 회귀 검사를 재리뷰했고 추가로 보고할 구체적인 결함을 발견하지 않았다. 검토자가 실행한 candidate control/download/row 검사 17개도 통과했다.

## 실제 Chrome 검사

별도 headless Chrome 프로필에 현재 확장 소스의 복사본을 로드했다. 실제 `popup.html`을 일반 탭 문서로 열고, 테스트 프로필에서만 활성 탭 조회를 원본 fixture 탭에 연결했다. 그 외 팝업 컴포넌트, 작업 피드, 서비스 워커의 작업 제어, HLS 수신·저장 및 Chrome 다운로드 취소 코드는 수정하거나 mock 처리하지 않았다. 사용자 Chrome 프로필은 변경하지 않았다.

- 라이브: 대상 치지직 방송에서 받은 초기화 데이터와 완전 M4V 조각 한 개를 로컬 HLS 서버에서 라이브 재생목록으로 제공했다. 팝업의 “중지 및 저장” 버튼을 클릭하여 실제 작업이 complete로 종료되고 MP4가 저장되는 것을 확인했다. 작업의 수신 바이트는 105,727바이트, 최종 MP4는 104,141바이트였다.
- 일반: 로컬 서버의 느린 MP4를 Chrome 다운로드로 시작했다. 팝업의 “취소” 버튼으로 실제 Chrome 다운로드가 canceled로 전환됐다.
- 두 경우 모두 동작 후 버튼이 기존 다운로드 아이콘·접근성 이름으로 돌아오고 다시 활성화됐다.
- 420px 폭에서 실제 렌더 캡처를 확인했다. 기존 크기·행 배치·공통 PNG 아이콘이 유지된다.

Git에서 제외된 실행 증거:

- `artifacts/popup-job-controls/browser-verification.json`
- `artifacts/popup-job-controls/live-active.png`
- `artifacts/popup-job-controls/ordinary-active.png`
- `artifacts/popup-job-controls/full-tests.log`
- `artifacts/popup-job-controls/project-check.log`
- `artifacts/popup-job-controls/probe.mjs`

이번 검증은 팝업 버튼 전환과 기존 제어 경로 연결을 대상으로 한다. 물리적 툴바 팝업 창의 열기·닫기나 장시간 라이브 수신 검사는 포함하지 않는다. 커밋·푸시·스토어 게시는 수행하지 않았다.
