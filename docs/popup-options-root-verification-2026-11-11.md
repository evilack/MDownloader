# 팝업 다운로드 옵션 Root.closest 오류 수정 — 2026-11-11

## 원인과 변경

실제 툴바 팝업의 WebRTC 항목을 Shift+클릭하여 `Root.closest is not a function`을 재현했다. `popup.js`는 `CreateCandidateList({root: document})`를 호출하며, `Document`에는 `Element.closest()`가 없다. 분할 패널 옵션 배치를 판별하는 코드가 루트를 Element라고 가정했다.

`candidate-list.js`에서 실제 미디어 목록 요소인 `List`를 기준으로 `.panel-resizable` 조상을 확인하도록 수정했다. 팝업은 기존 인라인 옵션을 유지하고, 분할 패널은 기존 native dialog를 사용한다. 네이티브 도우미나 백그라운드 실행 코드는 변경하지 않았다. 실제 적용에는 팝업 문서만 다시 불러왔으며 확장 전체를 다시 시작하지 않았다.

## 실제 확장 검증

- 수정 전: 실제 Chrome 팝업에서 WebRTC 옵션 클릭 → `Root.closest is not a function`, 인라인 옵션 0개.
- 수정 후: 같은 팝업에서 WebRTC와 HLS 항목 모두 Shift+클릭 → 옵션 표시, 취소 가능. 다운로드 실행은 하지 않았다.
- HLS 품질 및 옵션 조회가 끝난 뒤에도 오류 문구 없음. 팝업 500px 유지, 가로 넘침 없음.
- `artifacts/popup-options-root-20261111/popup-after.json`에 실제 HLS 팝업 결과를 보존했다.

## 회귀 검증

`tools/checks/probe-candidate-options-root.mjs`는 실제 production candidate list와 옵션 UI를 브라우저에서 구동한다. 미디어와 전송 응답만 합성하며 다운로드를 실행하지 않는다.

1. Document 루트 팝업: 인라인 옵션이 표시되고 취소 시 슬롯이 제거된다.
2. 분할 패널 안 Element 루트: 인라인 슬롯 없이 native modal이 표시되고 취소된다.

두 경우 모두 너비 500px, 가로 넘침 없음, enqueue 0회. 결과는 `artifacts/candidate-options-root/result.json`에 있다.

다운로드 액션·스캔 갱신 검사 12개, 관련 옵션/포커스 검사 7개가 통과했다. 액션 검사의 기존 DOM 모형에 현재 버튼에서 사용하는 `classList.toggle()`을 추가하여 검사 자체의 예외를 해소했다. 옵션 전체 검사에는 기존 기대 문자열 및 DOM 모형 차이로 실패하는 항목이 남아 있으며 전체 저장소 통과를 주장하지 않는다. 제품 코드는 해당 검사에 맞춰 변경하지 않았다.

홈페이지 프리뷰를 다시 생성했고 변경 구문 및 공백 검사를 통과했다. 원격 게시·배포는 수행하지 않았다.
