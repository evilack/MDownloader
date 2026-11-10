# 네이버 클립 검출 검증 — 2026-11-09

## 변경 내용

- `extension/lib/naver-clip.js`: 현재 클립 URL의 ID로 공개 카드 API를 조회하고 `body.card.content.vod.playback.MPD`의 완성된 progressive MP4 표현을 추출한다.
- `extension/detection.js`: 네이버 클립 공급자를 기존 검출 경로에 추가한다. 후보는 제목과 실제 해상도를 이름으로 사용하며 높은 해상도부터 표시한다. 기존 MP4 링크 복사·다운로드 경로를 사용한다.
- 일반 `.ts` 조각과 Blob 분류는 변경하지 않았다. HLS/CMAF 표현 및 추천 카드의 주소는 이 공급자의 직접 파일 후보에 포함하지 않는다.
- 신규 운영 권한이나 의존성을 추가하지 않았다. API 읽기는 권한이 있는 문서의 ISOLATED 월드에서 쿠키 없이 실행하며 5초·1MiB 제한을 적용한다.
- 문서 ID, 현재 페이지, 화면의 단일 영상 요소 및 source를 검증한다. 30초 캐시는 성공/실패 모두에 적용하고 매번 페이지/플레이어를 재검증한다. 동시에 요청한 스캔은 조회를 공유한다.
- 다른 채팅에서 변경 중인 기존 작업은 유지했다. 이 작업에서는 커밋·푸시·스토어 게시를 하지 않았다.

## 자동 테스트

명령:

```powershell
node --test tests/naver-clip.test.mjs
node --test tests/*.test.mjs
node --expose-internals tools/checks/verify-project.mjs
```

- 신규 네이버 클립 테스트 10개 통과.
- 신규 공급자 연결 전에는 현재 JSON 전용 영상의 검출 후보가 0개여서 테스트가 실패하는 것을 확인했다. API 실패 반복 조회도 추가 테스트로 먼저 실패를 확인한 뒤 재시도 간격을 적용했다.
- 전체 테스트 최신 실행: 629개 중 628개 통과, 1개 건너뛰기, 실패 0개. 동시 작업에서 추가된 테스트도 포함한 실행 시점의 결과다.
- 테스트 범위: 사이트/ID 식별, 화질 순서, 현재 카드만 추출, 비공개/삭제/재생 불가, 잘못된 JSON/구조, 비허용 URL, 조각 제외, 페이지/영상/문서 변경, 권한 철회, 캐시 만료, 동시 조회 공유, API 오류 재시도 간격, 본문 및 헤더 크기 제한과 스트림 취소, 기존 ResolveCandidate 연동.
- 정적 프로젝트 검사에서는 다른 작업의 `tools/dev/local-captions-preview.html`에 있는 루트 기준 `/extension/settings.css` 참조를 파일 시스템 상대 경로로 찾지 못하는 1건이 확인되었다. 이번 변경의 구문/상대 import/manifest 실패는 없었다. 해당 파일은 수정하지 않았다.
- 독립 읽기 전용 코드 리뷰: 중요한 정확성/회귀 문제 없음. 본문 소비 중 타임아웃, 성공 캐시의 source 교체 및 청크 수신 도중 페이지 이동을 조합한 추가 테스트는 비차단 보완 사항으로 남겼다.

## 실제 Chrome 검증

명령:

```powershell
node tools/checks/probe-naver-clip-chrome.mjs
```

- Chrome 157.0.8103.39, 별도 프로필, 사용자 브라우저 연결/재로드 없음, Computer Use 사용 없음.
- 테스트용 복사본의 manifest에만 `m.naver.com`, `clip.naver.com` 페이지 접근을 미리 허용했다. 이는 선택 권한 프롬프트를 자동 조작하지 않기 위한 테스트 설정이다. 운영 manifest는 그대로이며 API/CDN 호스트 권한은 추가하지 않았다.
- 최초 대상: `https://m.naver.com/shorts/?seedMediaId=8FE4B3731735D2AB0B33346FF3FB11FE605A&serviceType=CLIP`
- 확장의 실제 `Scan` 및 `ResolveCandidate`를 통해 해당 클립의 720×1280, 480×854, 360×640 MP4 3개를 검출했다.
- 재스캔 시 후보와 mediaKey가 유지되었다.
- 확장의 실제 `Enqueue` → 기존 직접 다운로드 경로로 720×1280 MP4를 저장했다. 크기 7,916,488바이트, SHA-256 `50fac6e1a25520b4ee41e8cf19fff714f44faad7c0f4f5e23f613e11e3ee9ac7`.
- 저장 파일을 Chrome에서 다시 열어 720×1280, 78.808005초, 오디오 디코딩 바이트 51,828, 76.8초 지점 탐색을 확인했다.
- 피드 스크롤 후 URL의 새 클립 ID에 속한 화질 후보만 검출되었고 이전 스캔 후보는 거절되었다.
- 최종 Chrome probe 종료 코드 0, `passed: true`.
- 최종 생성 근거: `artifacts/naver-clip/chrome-1794194128295/result.json`. 해당 실행의 `downloads/`에 실제 MP4가 있다. 보고서에는 서명 쿼리와 API 원문을 기록하지 않았다.

## 확인 범위와 제한

- 제공된 모바일 주소와 피드 내 다른 클립의 전환·검출·다운로드를 검증했다. 공개 JSON이 완성된 MP4를 제공하는 클립이 대상이다.
- `clip.naver.com/contents`의 ID 식별도 구현되어 있지만, 해당 데스크톱 주소는 네이버가 “일시적인 오류가 발생했어요”를 표시하여 플레이어가 생성되지 않았다. 데스크톱 페이지의 실제 검출은 검증 완료로 포함하지 않는다.
- 로그인·연령 제한·유료/비공개 콘텐츠, API 형식이 다른 영상 및 전체 네이버 서비스 지원으로 확대하지 않는다.
- Modern Web Guidance의 `security`, `deprioritize-background-fetches`를 참고해 응답 검증/크기 제한, 쿠키 제외, 낮은 우선순위 조회를 적용했다.

## 후속 수정: 미리보기 해상도 누락

- 사용자 보고: 네이버 클립 미리보기에 해상도가 나타나지 않음.
- 원인: API에서 읽은 후보의 `width`/`height`가 썸네일 배치, 호버 응답 및 작업 썸네일 응답에 전달되지 않았다. 기존 미리보기는 Blob 플레이어와 progressive MP4를 직접 연결하지 못하면 빈 결과를 반환했다.
- 수정: `WithCandidateResolution`에서 검증된 후보의 해상도를 세 응답 경로에 공통 반영한다. 이미지가 없어도 해상도 메타데이터를 반환하고, 이미지/길이가 있는 응답은 그대로 보존한다. 재생 중인 720p 화면과 별개로 360p 후보는 360×640을 표시한다.
- 회귀 테스트는 수정 전에 썸네일 결과가 빈 배열이어서 실패함을 확인했다. 세 경로의 화질별 값과 플레이어 해상도와의 충돌을 검증하고 수정 후 통과했다.
- 전체 테스트: 632개 중 631개 통과, 1개 건너뛰기, 실패 0개.
- 실제 Chrome 명령: `node tools/checks/probe-naver-clip-chrome.mjs --preview-only`.
- 제공된 URL에서 썸네일/호버/작업 미리보기 응답의 720×1280, 480×854, 360×640을 확인했다. 실제 공통 `PreviewTile` 컴포넌트에 응답을 전달하여 세 해상도 라벨의 가시성도 검증하고 스크린샷을 확인했다. 전체 팝업 재생 흐름을 자동화한 검증으로 확대하지 않는다.
- 후속 근거: `artifacts/naver-clip/chrome-1794194567189/result.json`, 같은 폴더의 `preview-resolutions.png`.
- Modern Web Guidance에서 영상 크기/메타데이터 관련 항목을 검색하고 목록을 확인했다. 이번 변경은 검증된 메타데이터의 기존 응답 연결이므로 적용할 새 DOM/API 패턴은 없었다.
