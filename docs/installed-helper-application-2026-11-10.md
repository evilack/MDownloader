# 실제 설치본 적용과 Chrome 확인

2026-11-10. 사용자 요청에 따라 격리 검증 이후 실제 등록된 Windows 설치본에 적용했다.

## 변경 전 보존

- 실제 Chrome의 MDownloader 확장 ID: eaimflahgdgfehekmdefignmffapamjk.
- 확장 저장소의 작업은 취소된 항목1개였고, 진행 중 다운로드/오프스크린/인식/모델 다운로드는 없었다. 기존 host.py 프로세스2개는 런처/실제 Python의 대기 연결이었다.
- 기존 설정/작업25개 키와 네이티브 소스/설정/등록 정보20파일을 artifacts/installed-helper-apply-20261110-093133에 백업했다. 설정 백업에는 비공개 값이 있을 수 있어 내용을 로그나 최종 응답에 출력하지 않았다.
- 기존 확장의 captionReconnect 요청으로 대기 네이티브 연결을 정상 해제했고, 기존 Python 호스트 종료를 확인한 뒤 교체했다.

## 실제 적용

- native/explorer/install.ps1의 데스크톱 사용자 등록 경로로 공통 본체9/revision1을 설치했다.
- 기존 전용 Python 환경으로 native/captions/install.py --skip-dependencies를 실행해 실행 프로토콜2/음성패키지4를 설치했다. 설치된 의존성 버전이 요구사항과 일치하여 pip/모델 다운로드는 하지 않았다.
- 설치 경로의 verify_install.py가 faster-whisper/whisper.cpp 및 converter의 실제 호스트 응답을 검증했다.
- 진행 작업0개를 다시 확인하고 chrome.runtime.reload로 실제 확장을 새로 불러왔다.
- 실제 options.html에서 CommonHelper 최소버전9, 등록된 공통 본체9.1/captionPackageUpdate/genericPackageManifest, 실제 captionProbe의 executionProtocol2/package4/engineReady/converterReady/modelReady를 확인했다. 기존 tiny/large-v3/large-v3-turbo 모델이 그대로 조회됐다.
- 설치된 공통5파일과 자막7파일의 SHA-256이 현재 소스와 일치했다. 모델14파일의 경로/크기/수정시각 변화0건, config.json과 폴더 연결 파일의 해시 불변을 확인했다.

## 확장 사용 검증과 중단

실제 확장 설정 화면에서 도우미 진단을 시작했고, 기존 Chrome의 실제 툴바 팝업을 열어 로컬 음성 영상의 미디어감지1개(MP4/320x180/약8초)를 확인했다. 사용자 기본 자막설정(비활성/faster-whisper/large-v3-turbo)을 바꾸지 않고 다운로드별 Tiny 설정으로 전체 파이프라인을 확인하려 했다.

Shift+다운로드 옵션을 여는 입력 단계에서 browser-harness가 Chrome의 Allow remote debugging 허용을 다시 요구했다. 상태 확인용 Computer Use는 현재 Windows 브라우저 URL을 정책상 충분히 확인하지 못해 제어를 중단하고 최종 응답을 요구했다. 그 이후 브라우저 입력을 중단했다. 이번 실제 Chrome 경로의 다운로드→인식→자막삽입→저장 전체 검증은 완료되지 않았다.

자체 로컬 검증 서버와 대기 browser-harness 호출만 정리했다. 사용자 Chrome/다른 확장/등록된 도우미 연결을 강제 종료하지 않았다. 설치 결과 및 보존 대조는 artifacts/installed-helper-apply-20261110-093133/application-result.json에 있다.
