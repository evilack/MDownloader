# Command-only helper implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Steps use checkbox syntax.

**Goal:** 확장이 모든 기능 정책과 처리 흐름을 소유하고 도우미는 개별 명령만 실행한다.
**Architecture:** 기존 자막 API를 확장 실행 관리자로 옮긴다. 네이티브는 파일·전송·디코딩·단일 인식 명령으로 축소하고 공통 설치기는 가변 파일 매니페스트를 받는다.
**Tech Stack:** MV3 JavaScript, PowerShell, Python, macOS JXA.
**Spec:** ../specs/2026-11-10-command-only-helper-design.md

## Global constraints

원본 미커밋 변경 보존. 임의 셸 실행 금지. 모델 자동 다운로드 금지. 설치된 사용자 도우미·활성 작업 변경 금지. 전역 정책 지침 기록.

## Review focus

취소가 실행 시작보다 먼저 도착하는 경우, 끊긴 연결/워커 재시작, 구간 인식의 언어·시간 보존, 이름 충돌 시 기존 파일 보존, 패키지 내부 파일 추가와 악성 상대경로.

## Tasks

- [x] 1. 확장 실행 관리자와 네이티브 개별 명령 계약을 실패 테스트로 고정한다.
- [x] 2. 작업·모델·출력 정책을 확장으로 이전하고 네이티브의 상위 워크플로 API를 제거한다.
- [x] 3. 양 OS 공통 설치기의 고정 파일 목록을 안전한 매니페스트로 교체하고 번들을 갱신한다.
- [x] 4. 전역/프로젝트 도우미 정책, 설치 검증과 문서를 갱신한다.
- [x] 5. 관련 테스트·전체 검증·소스/번들 해시를 확인하고 실제 설치·엔진 검증 범위를 따로 보고한다.

## 실행 기록

관련 Node 회귀 71/71, 네이티브 Python 21/21, 알림 회귀 4/4 통과. 실제 격리 Tiny 인식·SRT/VTT 저장과 CLI 인식을 확인했다. 설치용19파일의 해시가 소스와 일치한다. 전체 Node 테스트는788개 중730통과/57실패/1skip으로, 전체 통과가 아니다. 코드 리뷰에서 확인된 admission/attempt/취소/지연응답 경합을 수정하고 재현 테스트를 통과했다. 세부 근거는 docs/command-only-helper-verification-2026-11-10.md 및 artifacts/command-only-helper-*.log.

기존 본체8/음성2 설치본에는 활성 연결이 있어 덮어쓰거나 종료하지 않았다. macOS 실기 및 실제 PotPlayer 후킹은 미검증이다. 이 체크리스트의 완료는 구현·기록된 검증 범위이며 실제 사용자 설치본 반영/전체 앱 인수가 아니다.
