# WebRTC 현재까지 저장 — 0.2.28

사용자가 관리자에서 현재까지 저장 버튼이 보이지 않는다고 보고했다. WebRTC 수신 경로에는 snapshotAvailable 보고와 부분 저장 읽기 등록이 없었고, 작업 제어도 HLS 또는 HTTP 파일만 지원했다. UI 조건만 바꾸면 버튼을 눌러도 실패하므로 수신·저장·제어를 함께 연결했다.

## 변경한 동작

- WebRTC의 첫 조각이 OPFS에 close된 후 기존 관리자 행에 취소 → 현재까지 저장 → 중지 및 저장 버튼을 표시한다. 현재까지 저장은 기존 다운로드 아이콘과 라이브 구간 저장 문구를 사용한다.
- 현재까지 저장은 클릭 시점에 이미 커밋된 조각의 핸들만 동기적으로 고정한다. 이후 수신한 데이터는 해당 부분 파일에 섞이지 않는다. 녹화 중 받은 조각을 네트워크로 다시 요청하지 않는다.
- 기존 부분 저장 관리자와 RemuxFilePrefix로 고정된 MP4/WebM prefix의 완전한 패킷을 별도 컨테이너로 내보낸다. 별도의 부분 저장 작업이 기존 다운로드 관리자에 등록되며 원래 녹화는 계속 수신한다.
- 부분 저장의 취소 신호는 원본과 분리한다. 원본 종료·취소 시에도 이미 시작한 부분 저장이 원본 파일을 다 읽기 전에는 조각 폴더를 제거하지 않는다.
- 중지 및 저장의 기존 의미는 유지한다. 부분 저장의 확장자는 실제 출력 컨테이너를 따른다.

## 검증

- 누락 재현 테스트: WebRTC 현재까지 저장 요청이 HTTP source 경로에서 실패했고, 녹화 저장소에는 snapshot 함수가 없었다. 수정 후 두 테스트 통과.
- 전체 Node 테스트 222개 통과. 관리자 버튼 순서와 snapshot 요청, 첫 커밋 후 행 재생성, 고정 경계, 원본 계속 수신, 부분 저장 취소 후 원본 및 재저장 지속, 원본 취소 시 읽기 수명 보존을 포함한다.
- 프로젝트 검사: JavaScript 165개, JSON 16개, 상대 import 434개, 로컬 참조 98개, 보존 파일 73개, 실패 0. 현지화 10개 언어 × 373개, 누락 0. 페이지 정책 생성물 일치 검사 통과.
- 사용자 작업과 관련된 기존 Chrome MediaRecorder WebRTC MP4의 앞 35%와 65%를 각각 부분 변환했다. 3.517375초 및 5.374458초 파일에서 AVC 영상과 AAC 음성 패킷이 모두 읽혔다. 네트워크 요청은 0이었다. 원본 파일은 수정하지 않았다. 실제 녹화 파일은 ftyp/moov가 앞에 있는 fragmented MP4였다. 결과와 원본 해시는 artifacts/webrtc-snapshot-2026-11-08/recorded-prefix-results.json에 보관했다.
- FFmpeg 실행 파일이 없어 별도 디코더 검사는 수행하지 않았다. 위 확인은 패킷·트랙·재생 시간 검증이며 실제 플레이어 재생 검수로 확대하지 않는다. WebM의 실제 녹화 파일 변환은 이번 실측 범위에 포함되지 않는다.
- 별도 읽기 전용 코드 리뷰에서 Important 이상의 잔여 이슈는 보고되지 않았다.
- 사용자 새로고침 후 Chrome의 MDownloader content-script 문맥에서 manifest 버전 0.2.28을 확인했다. 브라우저가 관리자/팝업 확장 표면을 제공하지 않아 설치된 UI의 버튼 클릭과 최종 Chrome 저장 완료는 직접 확인하지 못했다. 진행 중인 다른 다운로드는 조작하지 않았다. Windows 컴퓨터 사용 없이 파일 검사와 브라우저 API만 사용했다.

변경: extension/lib/webrtc-recording.js, extension/lib/webrtc-transfers.js, extension/hls-runner.js, extension/jobs.js, extension/job-row.js, extension/manifest.json. 수정 전 주요 파일은 artifacts/webrtc-snapshot-2026-11-08/originals에 보존했다. Git main의 기존 작업 변경들은 유지했으며 커밋·게시하지 않았다.
