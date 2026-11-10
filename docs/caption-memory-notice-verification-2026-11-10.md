# 음성 자막 메모리 안내와 상태 문구 — 2026-11-10

## 변경

설정의 음성 인식 엔진 선택 아래와 다운로드 옵션의 음성 자막 생성 선택 아래에 동일한 `CreateCaptionMemoryNotice` 컴포넌트를 배치했다. 제목은 **메모리 사용 주의**, 본문은 **메모리를 많이 사용합니다. 메모리가 부족할 수도 있습니다.** 이다. 인식 옵션을 고르는 위치와 가깝게 두고, None/미생성을 고른 상태에도 기능의 사용 조건을 미리 읽을 수 있게 유지한다.

기존 도움말과 구분되는 불투명 호박색 배경, 구조를 표시하는 테두리와 시작 방향 강조선, 13px 글자, 본문 1.65 줄간격을 사용한다. 기존의 6px 모서리와 화면 밀도를 유지하고, 별도 아이콘/움직임/버튼은 추가하지 않았다. 단어 중간 줄바꿈을 막되 아주 긴 내용은 줄바꿈할 수 있게 했다. 화면마다 임의로 다른 스타일을 만들지 않고 하나의 컴포넌트와 의미별 색상 토큰을 공유한다.

현재 메모리 부족을 감지한 오류가 아니므로 `role=alert` 대신 `role=note`를 사용했다. 관련 선택/엔진/모델 컨트롤의 `aria-describedby`에 안내를 연결했다. forced-colors에서도 내용과 테두리를 읽을 수 있다.

상태 표시도 요청대로 변경했다.

| 단계 | 문구 |
| --- | --- |
| queued | 음성 인식 대기 중 |
| loading-model | 음성 인식 모델 로딩 중 |
| recognizing | 음성 인식 중 |
| recognized (단계별 출력) | 음성 자막 준비 완료 |
| windowed-ready | 음성 인식 결과 정리 중 |

## 스킬 적용

`ui-ux-pro-max`의 로컬 UX 검색에서 `warning color text`로 확인한 Color Contrast/Color Only 규칙을 적용했다. 정상 본문 대비 4.5:1 이상을 기준으로 삼고, 색상 외에도 제목과 문장으로 주의를 전달했다. `better-ui`의 기존 토큰/밀도 유지, 구조를 위한 테두리, 일관된 표면 처리 규칙을 적용했다. 이 안내에는 중첩된 둥근 표면, 신규 아이콘, 움직이는 상태가 없어 관련 장식이나 애니메이션을 추가하지 않았다. Modern Web Guidance CLI는 현재 실행 환경에 npm/npx가 없어 조회하지 못했으며 해당 도구의 가이드를 적용했다고 주장하지 않는다.

## 확인 결과

- 실제 설치된 확장 설정 페이지에서 변경 전후를 캡처하고 새 안내를 확인했다. 설치된 모듈로 네 가지 새 한국어 상태 문구도 확인했다. 확장 전체/백그라운드 재시작, 설정 저장, 도우미/모델 변경은 하지 않았다.
- 실제 설정/다운로드 컴포넌트를 제공하는 기존 로컬 프리뷰에서 Chrome으로 화면을 검증했다. 이 프리뷰는 모의 백엔드를 사용한다. 다운로드나 음성 인식 실행을 검증한 결과로 확대하지 않는다.
- 설정 폭 1280/680/375px, 다운로드 옵션 폭 420/375px에서 가로 넘침과 안내 잘림이 없었다. 다운로드 옵션 inherit/on/off/custom 및 설정 엔진 None에서도 안내가 한 개만 표시됐다.
- 가로로 긴 뷰포트, 안내 글자 200% 확대, reduced-motion, forced-colors에서 안내 가독성과 줄바꿈을 확인했다. 실제 보조공학 프로그램의 음성 읽기 검사는 하지 않았다.
- 현재 어두운 테마에서 본문 대비 **11.16:1**, 제목 대비 **10.08:1**이었다. 별도 밝은 테마를 구현하거나 검증한 결과는 아니다.
- 프리뷰 브라우저 검사 13개 및 한국어 단계 문구 검사 5개를 통과했고 페이지 JavaScript 오류는 0개였다. 증거는 `artifacts/caption-memory-notice/ui-evidence.json`과 같은 폴더의 캡처에 있다.
- 자막 출력/단계 UI/세션/경계/복구 관련 기존 검사 **34개 통과**, 변경 파일 공백 검사와 JS 구문 검사 통과. 홈페이지 프리뷰 재생성 완료: 62개 소스 파일.
- 확대 실행한 `download-options-ui.test.mjs`에는 기존 10개 실패가 남아 있다. 이번 안내 변경만 모듈 로더에서 되돌린 읽기 전용 비교에서도 같은 10개 실패가 재현됐다. 원본 소스를 되돌리거나 사용자 작업을 수정하지 않았다. 비교: `artifacts/caption-memory-notice/baseline-comparison.json`. 전체 저장소 검사 통과를 주장하지 않는다.

관련 자동 검사 명령:

```powershell
node --test tests/caption-automatic-output.test.mjs tests/caption-job-ui.test.mjs tests/caption-session-identity.test.mjs tests/caption-seam-recovery.test.mjs tests/hls-caption-sample-boundary.test.mjs tests/local-captions.test.mjs
```

Better UI 검토 결과: 이번에 추가한 안내의 표면/테두리/상태 처리에서 조치할 UI polish 결함은 확인되지 않았다. 위에 명시한 화면·모드 범위에서만 검토했다. Approve.
