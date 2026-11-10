# 명령 실행 전용 도우미: 책임과 검증

## 변경한 책임

확장 caption-execution.js가 준비·인식 순서, 실패 후 대체 입력, 인식 구간 큐, 모델 목록/다운로드 대상/체크섬, 인식 옵션과 백엔드 선택, 자막 시간 변환·직렬화, 이름 충돌 재시도, 상태·수명·인수 판정을 관리한다. 네이티브 host.py는 개별 execute 및 cancelExecution만 제공한다. 업무 상태 파일을 해석하거나 후속 처리를 선택하지 않는다. 확장이 저장하는 extension-state.json은 네이티브 파일 쓰기의 불투명 데이터다.

중복된 언어/옵션 기본값, 결과 파일명, 자막 직렬화와 타임라인 정책을 제거/이전했다. 입력·경로·프레임·자원 검증, 소유 프로세스 종료 대기와 패키지 잠금은 유지한다.

Kakao 확장 제어기는 프로세스 선택, 도메인/경로/헤더 필터, 제한 시간과 인증값 해석을 소유한다. 네이티브 프로토콜 2는 인증된 요청의 프로세스 나열·지정 PID 관찰과 raw header 반환만 한다. 탐색기 파일 종류 판정은 확장의 기존 IsSavedMedia에 있으며 본체의 중복 확장자 목록을 제거했다.

## 본체와 기능 패키지

공통 본체 9는 기능 파일 이름/개수의 고정 목록을 없앴다. 최대 128개 안전한 상대 경로, 디코딩 합계 1 MiB, JSON 프레임 2 MiB의 가변 매니페스트를 검증한다. 경로 탈출·리다이렉트·대소문자/접두 충돌·예약 이름·해시 변조를 거부한다. OS별 안정 bootstrap 진입점으로 실행하고 선언 파일만 정리하며 미확인 파일은 보존한다.

본체 SHA-256을 변경하지 않고 새 nested module 패키지를 실제 격리 PowerShell에서 추출/정리하는 테스트가 있다. 실제 source installer 테스트도 새 nested Python module의 설치를 확인한다. 이름·버전 분리만으로 완료 판정하지 않는다.

본체 8에는 고정 목록이 있어 9로의 최초 계약 전환이 필요하다. 구형 음성 패키지 2/3은 프로토콜 2/패키지 4로 갱신해야 한다. 이후 내부 모듈 변경은 기능 패키지 갱신이며 본체 재설치 사유가 아니다. Kakao 구형 호스트는 별도로 프로토콜 2 전환이 필요하다.

## 실행 근거와 경계

- 확장 회귀: prepare/decode → 개별 infer → 앱 직렬화 → 명시 이름 copy. 대체 입력, 중복 시작, stale attempt, 취소/재시도, 지연 저장, 단절/상태 복구, 구간 coverage/ACK와 입력 해제.
- 실제 Windows 인식: node tools/checks/probe-command-only-captions.mjs. 기존 Tiny 모델을 격리 폴더로 복사하고 로컬 speech video를 처리했다. 실제 execute 명령만으로 SRT/VTT를 저장하고 complete를 확인한다. 모델 다운로드·사용자 설치 변경·기존 프로세스 재시작은 하지 않는다. 실행 산출물은 artifacts/command-only-captions-*/evidence.json이다.
- 네이티브 회귀: framing/origin, 파일 순서/충돌/경로, checksum/publish rollback, 취소/자식 종료, 연결 간 잠금, bounded PCM/exact trim, 동적 nested 설치, binding/CLI capability 및 실제 CLI 인식.
- Kakao: 격리 fake Frida + 실제 Python framing과 앱 제어기/설정 테스트. 실제 PotPlayer 후킹/실사용 인증정보는 미검증이다.
- macOS: 공유 validation/cleanup은 Node VM에서 검증했다. 실제 JXA/Foundation/Installer/인식은 미검증이다.

관련 Node 회귀71개, 네이티브 Python21개, 별도 알림회귀4개가 통과했다. 전체 Node 테스트는788개 중730통과/57실패/1skip이다. 다운로드옵션/후보 UI fixture, 설치/제거 UI fixture, 자막/YouTube 기대값 등이 실패한다. 전체 통과로 보고하지 않는다. 구문/모듈/참조 검사는 실패0건이며 설치용19파일의 source/payload/hash가 일치한다. 근거는 artifacts/command-only-helper-focused-tests.log, command-only-helper-python-tests.log, command-only-helper-final-tests.log, command-only-helper-final-check.log, command-only-helper-integrity.json이다.

최초 구현 검증 때는 구형 설치본을 보존했다. 후속 사용자 요청으로 진행 작업0개를 확인·백업하고 실제 본체9/음성4를 설치했으며 실제 Chrome 연결 응답까지 확인했다. 전체 Chrome 다운로드 검증은 브라우저 제어 도구가 중단해 미완료다. 단계별 근거와 보존 대조는 [실제 설치본 적용 기록](installed-helper-application-2026-11-10.md)에 있다.
