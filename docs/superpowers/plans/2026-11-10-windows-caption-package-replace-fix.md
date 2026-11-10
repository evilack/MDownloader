# Windows 음성 패키지 교체 실패 수정

사용자 증상: 도우미의 `음성 기능 업데이트` 클릭 시 `reveal_failed`가 표시된다. 테스트 금지 지시를 유지하며 설치된 파일·기존 로그와 소스를 읽어 조사한다.

## 읽은 근거

- Chrome 등록은 `%LOCALAPPDATA%/MDownloader/ExplorerBridge/host-manifest.json`을 가리킨다.
- 설치된 common-setup.ps1의 기존 패키지 교체 분기는 `[IO.File]::Replace($Temporary,$Path,$null)`을 호출한다.
- 기존 `caption-installer.json`과 이전 설치 완료 상태가 남아 있고, 이번 시도의 새 queued/worker 기록은 없다. 패키지를 교체한 뒤 설치 작업을 생성하는 코드 순서와 일치한다.
- 실제 예외 내용은 이전 코드가 저장하지 않았으므로 이번 실패의 런타임 원인으로 확정하지 않는다. 발견한 분기 결함은 수정한다.

## 변경

- .NET string 인수에 PowerShell이 빈 문자열 대신 진짜 null을 전달하도록 `System.Management.Automation.Language.NullString.Value`를 사용한다. 원자적 교체와 임시 파일 정리는 유지한다.
- 패키지 쓰기 실패는 `caption_package_write_failed`로 분류하고 내부 예외를 보존한다. 설치 작업의 나머지 예외는 `common_setup_failed`로 분류하여 폴더 표시 실패인 `reveal_failed`와 구분한다.
- 설치 오류에 대해 검증된 도우미 루트의 `helper-last-error.json`에 코드·작업·예외 유형·HResult·제한된 메시지·소스 줄을 기록한다. 패키지 본문은 기록하지 않는다.
- Windows 도우미에 수정 리비전 1을 추가한다(8.1). v8 Windows의 이전 리비전만 업데이트가 필요하며 macOS에는 요구하지 않는다. 음성 패키지 버전 2는 변경하지 않는다.
- 설치 링크·준비 조건·상태 데이터·진단 표시가 같은 리비전 계약을 따른다. 새 진단 파일은 기존 삭제 대상에 포함한다.

## 공식 계약

- Microsoft NullString: https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.language.nullstring
- File.Replace의 백업 경로 null: https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace

테스트·문법 검사·도우미 실행·재설치·음성 기능 업데이트는 수행하지 않는다. Windows 설치 소스 데이터만 재생성한다. 설치된 도우미와 기존 사용자 파일은 수정하지 않는다.
