# 다운로드 중 오디오 추출·음성 자막 병행 Implementation Plan

> **범위 정정(사용자 재지적): A/B/C는 구현 순서에 대한 제안이었으며 사용자가 C 제외를 승인한 것이 아닙니다. A/B만 구현한 상태를 전체 요청 완료로 보고한 것은 잘못입니다. HLS Live·DVR, YouTube 수신 구간, 일반 파일·녹화의 병행 처리까지 누락을 다시 대조하여 계획·리뷰·구현을 이어갑니다. 아래 A/B 완료·C 후속 표시는 이전 작업의 범위를 기록한 것이며 전체 요청 완료 판정으로 사용하지 않습니다. 실행 검증 금지는 유지합니다.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **권한 갱신(2026-11-10): 사용자가 계획 구체화·리뷰·수정 후 구현을 명시적으로 요청했습니다. 소스 구현과 정적 리뷰를 진행합니다. 테스트·구문 검사·브라우저·네이티브 프로브·설치·실제 다운로드·모델 다운로드·음성 인식·번역 API 실행 금지는 유지됩니다.** 아래 과거 계획의 미실행 검증 항목은 실행 승인으로 해석하지 않습니다. 커밋·배포도 이번 작업에 포함하지 않습니다.

**Goal:** 지원 가능한 VOD에서 다운로드와 오디오 추출·인식을 겹치고, 확정 결과를 재사용하여 임시 저장소에서 번역·자막 삽입을 마친 최종본만 한 번 저장합니다.

**Architecture:** A 단계는 이미 존재하는 전체 오디오 조기 준비 경로에 인식 시작과 최종 시각 정렬을 연결합니다. B 단계는 확장앱이 닫힌 연속 HLS 창·큐·타임라인·가설 병합을 소유하고, 기존 음성 패키지의 제한된 추론 worker를 재사용합니다. 기존 공통 전송·취소·번역·삽입·최종 저장 경로와 공통 진행 바를 유지합니다.

**Tech Stack:** Chrome MV3/offscreen/OPFS/native messaging, JavaScript ES modules, Mediabunny 1.65.2, Python 3.12, ffmpeg, Faster-Whisper 1.2.1/CTranslate2, whisper.cpp 및 pywhispercpp 1.5.1·Intel Mac 1.2.0.

**Spec:** [다운로드와 음성 자막 병행 처리 가능성·설계](../specs/2026-11-10-concurrent-download-speech-captions-design.md). 현재 파이프라인·입력별 범위는 §2–3, 공식/커뮤니티 직접 근거는 §4, 결정·인터페이스는 §5–6에 있습니다. 구현자는 두 문서를 함께 읽어야 합니다.

## Global Constraints

- 도우미는 OS 파일·프로세스 등 최소한의 헬퍼 역할이며 처리 정책/오케스트레이션은 확장앱이 소유해야 합니다.
- 공통 도우미 버전과 음성 기능 패키지 버전은 별개입니다.
- 모델은 최초 설치에 포함하지 않고 옵션에서 직접 다운로드한 모델만 사용합니다.
- Faster-Whisper(large-v3-turbo 포함)와 whisper.cpp, 프리셋/개별 인식 설정, VAD, 언어, 컨테이너 자막/SRT/VTT를 유지해야 합니다.
- 임시 폴더에서 인식·번역·자막 삽입까지 마친 최종 미디어만 저장 폴더로 복사하고, 원본 미디어 중복 저장은 하지 않습니다.
- 별도 자막 취소 버튼 대신 기존 다운로드 취소 버튼으로 수신/음성 인식/번역/저장까지 취소합니다.
- 기존 웹 자막과 음성 생성 자막 중 번역 원본을 고를 수 있으며 generated:true와 기존 trackIds를 함께 사용할 수 있습니다.
- 생성 번역 결과는 기존 자막 개수와 실패 정보를 보존해 병합합니다.
- 별도 음성 진행 바를 없애고 공통 다운로드 바에서 수신 0~100% 후 음성 인식 0~100%로 전환합니다.
- `mediaReady` 마커는 완성된 임시 미디어의 후처리 시작을 뜻합니다. 조기 인식 시작으로 의미를 바꾸지 않습니다.
- 현재 브랜치는 조사 당시 `codex/youtube-distribution-probe`이고 변경 항목이 매우 많습니다. 매 작업 시작 시 현재 소스·규칙·소유자를 다시 확인하고 타 작업의 변경을 보존합니다. 이 계획은 별도 작업트리·일괄 add/commit을 요구하지 않습니다.
- 정책 수치와 wire 계약은 아래 구현 반영 절 및 실제 소스에 대응합니다. 소스 구현 상태와 실행 검증 결과는 구별하며, 실행 인수 항목은 계속 미검증입니다.

## Review Focus

1. 오디오가 먼저 인식된 뒤 영상 remux 원점이 달라져도 컨테이너/SRT/VTT가 같은 시각을 사용해야 합니다. → 작업 1·3·4의 `early-result-retiming` 시나리오.
2. 뒤 세그먼트 완료·init 지연·재시도·동일 ID 다른 bytes가 앞의 미수신 구간을 덮지 않아야 합니다. → 작업 6·7의 `out-of-order-window` 시나리오.
3. 긴 한국어 발화·무음·실제 반복 문장이 경계에서 누락/중복되거나 VAD 때문에 미디어 시간이 줄면 안 됩니다. → 작업 8의 `seam-and-silence` 시나리오.
4. 취소·native disconnect·새 attempt가 구세대 결과를 저장하거나 다른 작업 프로세스를 끝내면 안 됩니다. → 작업 2·3·7·8의 `cancel-and-attempt-isolation` 시나리오.
5. sidecar 일부 저장 실패·생성 번역 실패 때 기존 자막 오류가 사라지거나 최종 미디어가 중복 저장되면 안 됩니다. → 작업 4의 `artifact-retry-and-subtitle-merge` 시나리오.

위 시나리오는 빠뜨리기 쉬운 검토 지점이며 각 작업의 향후 검증에 포함했습니다. 현재 실행한 테스트는 없습니다.

---

## 1. 파일 구조와 단계 경계

### 구현 전 리뷰 반영: 아래 계약이 초안의 모호한 제안보다 우선합니다

- B는 매 창마다 tail playlist를 다시 만들지 않습니다. 기존 최종 `RemuxHls`와 **동일한 전체 유한 VOD manifest/트랙 조합**을 여는 Input 하나를 유지하고 packet iterator를 한 번 진행합니다. CustomPathedSource는 해당 파일의 Writer.close/commit까지 별도 promise로 기다립니다. 전송 worker는 음성 처리를 기다리지 않습니다. 따라서 라이브러리의 동일한 normalized packet clock을 사용하며 이를 raw PTS라고 부르지 않습니다.
- 최종 HLS remux는 기존 start에 실제 복사한 audioStart/audioEnd/outputEnd를 추가 반환합니다. EXTINF 합계를 최종 clip/진행률 길이로 사용하지 않습니다. finish는 전송이 확보한 공통 A/V 끝을 확정하고, 미수신 파일을 기다리는 source만 전용 sealed sentinel로 깨웁니다. abort/손상 오류와 구별하고 이미 모은 packet은 drain합니다.
- B의 normalized packet timestamp에는 RemuxHls의 AudioShift가 아직 적용되지 않습니다. B는 이를 그대로 sample화하고 final mapping에서 trackShift=AudioShift/shiftApplied=false를 사용합니다. A의 aligned 오디오 remux는 이미 적용한 shift를 다시 더하지 않습니다. seal의 입력 extent와 최종 출력 coverage도 분리해, audio가 앞서 수신된 finish의 최종 coverage 부분집합을 재인식 없이 clip합니다.
- 공유 normalized clock의 첫 AAC packet이 음수일 수도 있으므로 Input당 고정 epochOrigin=min(0, firstAudioTimestamp)을 한 번 정하고 sample=(packetTimestamp-epochOrigin)*sampleRate를 사용합니다. mapping.sourceOrigin으로 이 원점을 복원합니다. 이후 창/repair마다 원점을 다시 정하지 않습니다. 시간 격자 검사는 공통 A/V 정규화 offset의 영향이 없는 첫 AAC timestamp 대비 delta/duration으로 합니다.
- core/context/queue/sample-rate 등 조절 정책의 원본은 `native/captions/bootstrap.json`의 processing입니다. 생성 `CaptionProcessingPolicy`를 확장/native가 함께 읽습니다. 프로토콜의 물리적 메시지/입력 방어 상한은 정책과 구별합니다.
- macOS installer는 9파일/전체 제한 외에 **각 파일 base64 길이 262144 이하**를 요구합니다. 현재 본체를 유지하므로 새 host/engine/worker도 이 제한 안에 둡니다. Windows의 raw 파일/합계 제한도 유지합니다.
- `cpp-worker.py`의 엔진 import는 요청 엔진에 따라 지연합니다. Faster-Whisper만 설치된 환경에서 pywhispercpp import가 필수가 되지 않게 합니다. 지속 worker 제어와 부모 종료 감시는 같은 stdin을 경쟁해서 읽지 않습니다.
- PCM admission credit과 압축 창/raw hypothesis의 seam 보존 lease를 분리합니다. 추론 완료 PCM은 해제하고 seam repair는 보존 압축 창/원본 packet으로 다시 디코딩합니다. 세 창 PCM 한도에서 양쪽 창과 repair를 모두 잡은 채 ACK를 기다리는 교착을 만들지 않습니다.
- seam은 같은 시간의 token 정렬/겹침을 확인한 뒤에만 확정합니다. 중점으로 문장 소유권을 정해 삭제하거나 불확실한 양쪽 문장을 단순 합치지 않습니다. repair도 실패하면 명시한 epoch 후처리 계약을 따릅니다.
- 기존 staged retry의 빈 반환, SaveMediaFile의 recursive 작업 사본, 저장 receipt·OPFS lease를 한 컴포넌트로 소유합니다. 저장된 final 미디어가 있으면 그 파일을 raw 입력처럼 재인식하거나 재복사하지 않습니다.

공유 파일과 인터페이스 때문에 실제 구현은 **네이티브 처리(작업1·2·7) → 확장 통합(작업3·4·6·8) → 패키지/최종 리뷰(작업5·9)** 단위로 순차 진행합니다. 이는 작업 범위 축소가 아니며 원래 작업별 완료 기준을 그대로 유지합니다. 실행 검증 기준은 미검증으로 별도 남깁니다.

| 파일 | 변경 책임 | 단계 |
| --- | --- | --- |
| 신규 `extension/lib/caption-processing-policy.js` | 생성기/확장 공통 정책 스키마와 물리적 패키지·프로토콜 한도 | A/B |
| 신규 `extension/lib/concurrent-captions-contract.js` | 입력 eligibility/capability·상태·창/샘플/상한 계약, 순수 검증 | A/B |
| 신규 `extension/lib/concurrent-captions-runner.js` | 작업별 시작·대기·취소·attempt·fallback·window scheduling | A/B |
| 신규 `extension/lib/caption-window-source.js` | HLS 닫힌 연속 구간 → 유한 창 descriptor, 미디어 시각 매핑 | B |
| 신규 `extension/lib/caption-window-merge.js` | 가설/경계/coverage/확정 cue 원장·repair 요청 | B |
| 기존 `extension/lib/local-captions-runner.js` | 기존 CaptionStage chunk 전송과 조기 인식 coordinator 연결 | A/B |
| 기존 `extension/lib/local-captions-service.js`, `local-captions-native.js` | background 송신자/작업/attempt 검증, capability, 상태 이벤트·복구 | A/B |
| 기존 `extension/hls-runner.js`, `features/youtube/runner.js` | A의 준비 완료 훅·수명·최종 timing 전달 | A |
| 기존 `extension/lib/stream-transfer.js`, `committed-snapshot.js`, `hls-remux.js` | B의 닫힌 구간 노출과 기존 패킷/remux 공통 로직 재사용 | B |
| 기존 `extension/lib/caption-output-pipeline.js` | 이미 시작한 인식 결과 재사용, finalize, 기존 번역/artifact 준비 | A/B |
| 신규 `extension/lib/caption-output-session.js` | 순차 출력 세션, 임시 입력 lease·개별 저장 receipt·실패 유예 만료 | A/B |
| 기존 `extension/lib/generated-caption-translation.js`, `subtitle-status.js` | 기존 API 재사용; 필요 시 재시도 receipt만 보강 | A/B |
| 기존 `extension/lib/caption-job-progress.js`, `row-presentation.js`, `metrics.js`, `extension/local-captions-job.js`, `job-row.js` | mediaReady gate·sample 진도·기존 문구·렌더 invalidation | A/B |
| 기존 `extension/jobs.js`, `lib/browser-job-state.js`, `lib/download-notifications.js` | staged retry와 취소/완료·출력 receipt 연계 | A/B |
| 기존 `extension/lib/stream-workspaces.js`, `transfer-snapshots.js` | 기존 수명 재사용; retry lease가 필요한 작업에만 국소 보강 | A/B |
| 기존 `native/captions/host.py` | 추가 action·창 업로드·작업 lease·admission·결과 보관/최종화 | A/B |
| 기존 `native/captions/engine.py` | 유한 입력 디코딩·추론 어댑터·raw transcript 재직렬화 | A/B |
| 기존 `native/captions/cpp-worker.py` | 기존 단발 모드 보존, 두 엔진의 지속 세션/취소 프로세스 모드 | A/B |
| 기존 `native/captions/bootstrap.json`, `README.md`, `extension/lib/caption-runtime-contract.js` | 독립 패키지 capability·호환성·운영 문서 | A/B |
| 생성 데이터 `extension/data/caption-runtime-metadata.js`, `caption-installer.json` | 승인된 후속 단계에서만 기존 빌드 도구로 생성 | A/B |

**새 native 파일을 추가하지 않습니다.** 공통 도우미의 고정 9파일 allowlist를 유지하기 위한 결정입니다. `native/explorer/common-setup.ps1`, `native/common-macos/host.js`의 본체 동작을 수정할 필요가 없는지 패키지 크기·목록을 확인합니다. 필요성이 생기면 이유를 명시하고 범위를 재판단하며 본체 버전을 관성적으로 올리지 않습니다.

A는 작업 1–5까지로 독립적으로 도입할 수 있습니다. B는 A 위에 작업 6–9를 추가합니다. 일반 MP4/WebM·DASH 구간·SABR 구간·라이브/녹화 병행은 C로 남기며 이번 A/B 구현의 완료 조건에 포함하지 않습니다. 이 유형들의 기존 후처리는 보존합니다.

## 2. 공통 타입·인터페이스

아래는 소스 반영된 인터페이스입니다. 구체 payload 필드는 Spec §6과 native action을 함께 따릅니다. 기존 `captionPipeline:'staged'`는 유지하고 별도 `captionStatus.mode:'postprocess'|'early-audio'|'windowed'`를 사용합니다.

- `CaptionAttempt`: 안전한 정수 `>=1`. job 단위 시작/재시도 때 증가하고 모든 새 요청·응답·원장에 포함합니다.
- `SelectConcurrentCaptionMode({job,source,capabilities}) -> {mode,reason?}`: 지원 외 입력은 `postprocess`로 반환합니다. snapshot/live/불명확 codec/timeline 및 capability 없음은 조기 모드가 아닙니다.
- `CaptionConcurrentReady(value,mode) -> boolean`: early-audio는 concurrency/finalize>=1, windowed는 추가 window>=1을 요구합니다. 기존 staged 최소 패키지는 `MinimumCaptionOutputPackageVersion=2`로 분리하고 최신 배포 packageVersion을 최소 조건에 그대로 대입하지 않습니다.
- `CreateConcurrentCaptionRunner({stage}) -> Coordinator`: 상태/파일/DOM을 직접 참조하지 않고 주입한 stage 통신을 사용합니다. 정책은 공통 `CaptionPolicy`를 소비합니다.
- `Coordinator.earlyReady(job,signal) -> Promise<void>`: job의 준비된 오디오 원점·shift로 A의 시작 승인까지 기다리고 추론 완료는 기다리지 않습니다. 동일 attempt의 중복 호출은 같은 세션을 재사용합니다.
- `Coordinator.windowed(job,source,signal,fingerprint) -> Promise<boolean>`: capability/admission 후 독립 창 루프를 시작합니다. 다운로드 worker는 `configure/commit/seal`만 통지하고 추론/credit을 기다리지 않습니다.
- `Coordinator.finalize(job,timing,signal) -> Promise<FinalCaptionResult|null>`: timing은 실제 remux의 `{start,audioStart,audioEnd,outputEnd}`입니다. 시작된 창·병합을 drain하고 정렬된 revision을 반환하며, 명시 fallback이면 null을 반환해 기존 후처리로 연결합니다.
- `Coordinator.cancel(jobId) -> Promise<void>`: 현재 attempt의 큐·worker quiesce와 소유 source 정리를 기다립니다. `release`, `suspend`, `retryRecognition`은 출력 전용 재시도와 인식 재시작을 구별합니다.
- `Coordinator.fail(jobId,attempt,error)` / `signal` / `ownership` / `markFinalized`: native 연결 종료를 해당 세대의 source·clock·producer에 전달하며, 사용자 전체 취소와 확정된 출력 checkpoint를 구별합니다. `clipPrepared`는 finalize 기능이 없는 postprocess의 부분 저장 입력만 최종 임시 미디어로 교체합니다.
- `Coordinator.fallback(job,reason,signal) -> Promise<attempt>`: source/worker를 정지한 뒤 새 attempt를 만들며, 호출자가 보존한 최종 임시 미디어로 후처리합니다. 큐 포화만으로 호출하지 않습니다.
- `CreateCaptionWindowSource({getFile,createWindowFile,signal}) -> Source`: `configure(tracks,committed)`, `commit(path)`, `seal(reason)`, 비동기 `next()/repair()`, `releaseBefore()/release()`를 제공합니다. source의 `clock/sourceOrigin/sourceStartSample/sourceEndSample`은 Input당 동일 시각 축입니다.
- source 내부 유한 remux는 닫힌 AAC m4a 파일과 정수 sample descriptor를 반환합니다. 별도 공개 `RemuxCaptionWindow`로 같은 패킷 처리기를 복제하지 않습니다.
- `CreateCaptionWindowMerger() -> {accept(),repair(),seal(),snapshot()}`: 원본 whole cue를 보존하며 ACK할 window ID, 절대 frontier·길이 counter, 제한 repair 요청과 확정 원장을 반환합니다.
- native `finalize_result(directory, mapping, selected_cues, formats, expected_coverage) -> dict`: raw cue 원장의 출력 시각 변환/clip/직렬화만 수행하며 모델을 호출하지 않습니다. A는 기존 `segments.jsonl`, B는 `appendFinalCues` 원장이 입력입니다.
- native `open_inference_session(root, options, cancel, progress) -> InferenceSession`, `session.infer(wav_path, language) -> CaptionHypothesis`, `session.close() -> None`: 한 작업 세션 안 모델 로드 한 번, 명시 취소 가능 자식 프로세스입니다.

`FinalCaptionResult`는 `{attempt,resultRevision,language,formats,committedSamples,finalSamples}`입니다. 결과 내용은 기존 `CaptionStage('readResult')`로 읽으며, 임의 native 경로를 UI/작업에 저장하지 않습니다. `CaptionWindow`/`CaptionHypothesis`와 새 action·capability는 패키지3 소스에 반영했으며 실제 설치·호출은 하지 않았습니다. 기존 패키지2는 기본 staged 후처리 준비 조건을 계속 만족합니다.

## 3. 작업 체크리스트

체크는 소스 반영과 문서 작성만 뜻하며 실제 실행 인수와 구별합니다. `향후`, `fixture`, `실제`, `측정`을 포함한 실행 검증 항목은 금지가 유지되어 미실행입니다. 구현자 자기검토를 끝낸 뒤 독립 리뷰에서 발견한 회귀도 수정·재리뷰하며, 최종 판정은 별도 정적 리뷰 기록에 남깁니다.

| 작업 | 소스 연결 지점 | 실행 인수 |
| --- | --- | --- |
| 1 지연 정렬 | native raw 원장/immutable extent·finalize revision, JS attempt/capability 계약 | 시각 fixture·실제 A/V/SRT/VTT 미실행 |
| 2 지속 worker | 기존 worker 파일의 두 엔진 세션, bounded IPC·소유 자식·OS lease | 로드 횟수·GPU/RAM·OS 취소/잠금 미실행 |
| 3 A 조기 인식 | 기존 완전 오디오 ready 훅→earlyReady, mediaReady gate·sample 진도 | mediaReady 전 인식 시작과 실제 성능 미실행 |
| 4 출력/재시도 | output session·확정 뒤 번역/삽입·개별 receipt·workspace lease·공통 취소 | 저장 오류·취소·retry 경합 미실행 |
| 5 독립 패키지 | speech3/min staged2, 정책 메타데이터·9파일 hash/크기 | 설치·업데이트·모델 보존 미실행 |
| 6 B 입력 | 전체 finite HLS Input 한 개·commit 대기·AAC 유한 창·고정 clock | 실제 TS/fMP4/priming/resample 미실행 |
| 7 B admission | 창 hash/offset·credit·PCM/압축 lease·결과 paging | 부하·복구·프로세스 crash 미실행 |
| 8 B 병합 | whole-cue anchor·bounded repair·명시 epoch fallback·실제 끝 clip | 긴 발화·무음·반복·finish 품질 미실행 |
| 9 인수 기록 | A/B/C 범위와 source/설치/인식/저장 상태 분리 | rollout·성능·품질 인수 보류 |

### 작업 1: 조기 인식 결과의 지연 정렬·호환 계약

**Files:** 신규 `extension/lib/concurrent-captions-contract.js`; 수정 `native/captions/host.py:119,199`, `engine.py:66,118,436`, `extension/lib/local-captions-service.js:134`, `caption-runtime-contract.js`.

**Interfaces:** 기존 begin/append/prepare/start/readResult를 소비합니다. `recognizeEarly`와 `finalizeResult`, `captionConcurrencyVersion:1/captionFinalizeVersion:1`, `FinalCaptionResult`를 제공합니다. B window capability는 이 단계에서 광고하지 않습니다.

- [ ] 1. `early-result-retiming` 향후 fixture를 정의합니다. raw `[2,3,'문장']`, 입력 원점 10초, 최종 outputStart=11초이면 최종 cue는 `[1,2]`; container·SRT·VTT가 동일해야 합니다. A의 영상/오디오 원점 관계가 이미 적용된 경우 offset 두 번 적용을 거절합니다.
- [x] 2. `start`에 `attempt/timelineMode:'deferred'`를 추가하고 raw transcript와 출력 result를 분리합니다. 기존 staged/레거시 호출은 기존 시맨틱을 유지합니다. recognized 후 PCM 정리는 유지하되 raw transcript를 finalize까지 보존합니다.
- [x] 3. `finalize_result`와 native `finalizeResult` action을 추가합니다. 매핑 값·정수 범위·coverage·format을 검사하고 resultRevision별 원자적 출력으로 직렬화합니다. 동일 입력 재호출은 결과 재사용, 다른 mapping이면 재직렬화하며 인식 호출 수는 증가하지 않아야 합니다.
- [x] 4. 서비스에 `recognizeEarly/finalizeResult`를 추가합니다. 신뢰된 offscreen·저장된 job/설정·현재 attempt를 검증합니다. 아직 완성되지 않은 미디어에는 `mediaReady`를 설정하지 않습니다.
- [ ] 5. 미래 검증이 허용되면 native 결과 fixture와 JS 계약 fixture를 실행합니다. 기대 결과는 재인식 0회, 잘못된 mapping/attempt 거절, resultRevision 일치입니다. **이번에는 작성/실행하지 않았습니다.**

**완료 기준:** 기존 저장 전 인식 경로와 새 deferred 결과의 차이가 명시적이며, 최종 정렬만 다시 실행할 수 있습니다.

### 작업 2: 작업별 지속 추론 worker와 취소 격리

**Files:** 수정 `native/captions/engine.py:401,436`, `cpp-worker.py`, `host.py:46,119,188,323`. 새로운 native 파일/의존성을 추가하지 않습니다.

**Interfaces:** 작업 1의 attempt·raw result를 소비합니다. `open_inference_session/session.infer/session.close`를 제공하며 A는 기존 30초 WAV 목록을 이 세션으로 처리합니다. B도 같은 세션을 재사용합니다.

- [ ] 1. `cancel-and-attempt-isolation`/`model-load-reuse` 향후 fake worker 시나리오를 정의합니다. 3개 WAV에 모델 생성 1회, 작업 변경 시 prompt/context 초기화, 한 작업 취소 시 다른 작업 worker 생존, 이전 attempt 결과 무시를 확인 대상으로 둡니다.
- [x] 2. 기존 `cpp-worker.py`의 단발 CLI를 보존하며 내부 `--session --engine` 모드를 추가합니다. 고정 로컬 모델 경로만 열고, 제어/응답은 원자적 파일 IPC·stderr는 작업 로그를 사용합니다. stdin은 POSIX 부모 생존 감시 전용으로 분리합니다. Faster-Whisper는 `local_files_only=True`, whisper.cpp는 기존 옵션 지원 검사와 absolute model path를 유지합니다.
- [x] 3. 세션 시작/추론/정지 명령의 제한된 내부 IPC와 parent-death 감시를 구현합니다. `--session` 파일명은 역사적 이름이며 두 엔진 공통 worker라는 설명을 추가합니다. 취소 2초 내 종료 ACK를 목표로 하고 협조 종료 실패 시 소유 자식만 강제 종료합니다. 실제 목표 충족은 향후 측정합니다.
- [x] 4. 기존 audio/recognition pool 제출에 admission을 둡니다. 모델 사용 lease가 있는 동안 삭제·패키지 교체를 막고 job+attempt/OS lease를 사용합니다. native 연결이 둘이면 같은 경로를 동시에 쓰지 못하게 합니다.
- [ ] 5. 미래 검증 허용 시 fake worker의 hang/crash/late-result와 Windows/macOS 실제 엔진별 모델 로드/해제·GPU 옵션 지원을 분리 검증합니다. 기존 Intel Mac 1.2.0 미지원 옵션은 명시 오류여야 합니다. 엔진 실행 결과가 없으면 동작 완료로 표시하지 않습니다.

**완료 기준:** 동일 작업의 WAV/창마다 모델을 다시 로드하지 않고, 인식 도중 취소가 다음 결과 yield에만 의존하지 않습니다. 실제 런타임 인수는 향후 허용된 검증까지 보류합니다.

### 작업 3: A의 조기 인식 연결과 공통 바 유지

**Files:** 신규 `extension/lib/concurrent-captions-runner.js`; 수정 `local-captions-runner.js:8,42`, `local-captions-service.js:38,134`, `extension/hls-runner.js:493,532`, `features/youtube/runner.js:116,148`, `caption-job-progress.js:15`, `row-presentation.js:83`, `metrics.js:55`, `local-captions-job.js:13`, `job-row.js:236`.

**Interfaces:** 작업 1·2 capability와 early request를 소비합니다. `Coordinator.earlyReady/finalize/cancel/fallback` 및 저장 상태의 mode/attempt/sample progress를 제공합니다.

- [ ] 1. A eligibility fixture를 정의합니다. 비라이브/전체 AAC 오디오/안정 시각/첫 영상 기준/모델 준비는 early-audio, live·snapshot·Opus·capability 부족은 postprocess입니다. 오디오 EOF 뒤 전체 SABR 길이 검사 실패는 출력 성공이 아닙니다.
- [x] 2. 기존 `PrepareCaptionBlob` 성공 뒤 `earlyReady`를 호출합니다. 준비 경로의 exception은 병행 실패 원인으로 보관하고 기존 최종 입력 fallback을 사용할 수 있게 합니다. 동일 준비 성공을 두 번 begin/start하지 않습니다.
- [x] 3. job별 controller abort를 **준비/조기 인식 시작 전** coordinator에 연결하고 finally에서 모든 작업/파일 lease가 끝난 뒤 해제합니다. `CaptionTiming`은 최종 mapping 전달로 확장하며 이미 인식된 결과도 작업 1로 정렬합니다.
- [x] 4. `CaptionJobProgress`는 mediaReady 이전 무조건 수신 바를 유지하게 수정합니다. 인식 상태 문구만 기존 영역에 표시하고, mediaReady 이후 실제 완료 sample 비율부터 표시합니다. 조기 80%라면 80%부터 시작하며 0으로 초기화하지 않습니다.
- [x] 5. `job-row`는 기존 `UpdateJobRowMetrics`의 caption/진도 갱신 경로를 재사용하고 버튼 구조가 달라지는 retryAvailable만 비교 키에 추가합니다. sample 진도마다 row를 다시 만들어 포커스를 잃지 않습니다. progress 계산과 label은 popup·sidepanel 공통 함수를 사용합니다.
- [ ] 6. 향후 허용 시 `early-result-retiming`, `recognition-before-media-ready`, `render-progress-in-same-phase`, 준비 중/추론 중/영상 실패 후 취소 시나리오를 확인합니다. 기대값: mediaReady=false 동안 수신 바, 이후 80→100, 저장 전 complete 알림 없음, cancel 뒤 native start/목적지 저장 없음.

**완료 기준:** 코드·상태 계약상 기존 일부 VOD에서 인식이 수신과 겹치며, 다운로드 진도·취소·최종 시간 정렬을 보존합니다. 속도 향상은 실행 측정 전까지 주장하지 않습니다.

### 작업 4: 최종 출력 재사용·생성 번역·재시도 receipt

**Files:** 수정 `caption-output-pipeline.js:33,80`, `hls-runner.js:175`, `local-captions-service.js:104,134`, `jobs.js` `ControlJob`, `lib/browser-job-state.js`, `lib/download-notifications.js`; 기존 `generated-caption-translation.js`, `subtitle-status.js`, `stream-workspaces.js`, `transfer-snapshots.js` 재사용.

**Interfaces:** `Coordinator.finalize`와 기존 translation/subtitle mux/save APIs를 소비합니다. job의 `captionStatus.outputReceipts:{media?,sidecars}` 및 attempt/resultRevision과 현재 세션의 retry lease를 제공합니다. receipt에는 인증값·임의 OS 경로를 넣지 않습니다.

- [ ] 1. `artifact-retry-and-subtitle-merge` fixture를 정의합니다. 기존 웹 자막 count=3/completed=2/errorCount=1에 생성 원문을 병합하면 count=4/completed=3이고 기존 errorCount를 유지해야 합니다. 재시도 병합에서도 count가 다시 증가하면 안 됩니다.
- [x] 2. `PrepareCaptionOutput`은 현재 mode를 확인하고 이미 인식 중이면 기다리고 완료되면 재사용합니다. `processing/mediaReady`는 조기 인식 수치를 지우지 않습니다. finalize 전 기존 미디어 변환/원점·최종 범위를 전달하고 그 뒤에만 VTT를 읽습니다.
- [x] 3. 기존 웹 자막 번역과 `generated:true + trackIds` 경로를 유지합니다. provisional 결과를 번역하지 않고, 확정 원문을 기존 provider adapter로 번역합니다. `MergeGeneratedSubtitleStatus`는 원래 수집 summary를 기준으로 멱등 병합합니다.
- [x] 4. 모든 선택 artifact를 임시 폴더에서 완성한 뒤 최종 미디어/선택 sidecar만 저장합니다. container-only·SRT-only·VTT-only·복수 선택을 유지합니다. 생성 원문과 번역 sidecar가 모두 최종 시각을 사용하는지 확인합니다.
- [x] 5. 기존 staged retry가 `Start`에서 바로 반환하는 제한을 해소합니다. 조기 실패/번역 실패/삽입 실패/sidecar 저장 실패를 구별하고 보존된 입력/원장/receipt로 실패 단계부터 재개합니다. 미디어 receipt가 있으면 재다운로드/재저장을 하지 않습니다.
- [x] 6. partial save 후 실패 시 저장한 파일을 표시하고 작업 전체를 complete로 표시하지 않습니다. 브라우저 복수 파일 원자성을 약속하지 않습니다. retry lease는 소유 job에만 적용하고 전체 OPFS startup cleanup을 끄지 않습니다.
- [ ] 7. 향후 허용 시 생성 번역 선택, 기존 트랙과 병용, 번역 오류 보존, native/browser sidecar 일치, sidecar 두 번째 저장 실패→retry, 저장 중 취소, finish 후 부분 저장을 확인합니다. 기대값: raw 원본 목적지 저장 0회, 최종 미디어 복사 최대 1회/receipt, 선택하지 않은 sidecar 0개, 최종 완료 알림 1회.

**완료 기준:** 정상 경로 전체 재인식 없이 번역/삽입/저장하며, 실패·재시도에도 자막 수·오류·최종 파일 일관성이 유지됩니다.

### 작업 5: A의 독립 패키지·후처리 호환 도입

**Files:** 수정 `native/captions/bootstrap.json`, `README.md`, `extension/lib/caption-runtime-contract.js`; 생성 데이터 `extension/data/caption-runtime-metadata.js`, `caption-installer.json`; 기존 `tools/build/build-caption-installer.mjs` 재사용.

**Interfaces:** 작업 1–4의 A capability를 소비합니다. 기본 `CaptionRuntimeReady`와 병행 capability 판정을 분리하여 구형 준비 패키지는 기존 staged 경로를 유지합니다.

- [x] 1. 최신 packageVersion을 다시 읽고 다음 독립 버전으로 올립니다. 조사 시 2이므로 다른 작업이 없을 때만 3입니다. helperVersion=8/revision=1/protocol=1과 모델 카탈로그는 이 기능 때문에 바꾸지 않습니다.
- [x] 2. 9개 native 파일 목록·각 hash·전체 1MiB 제한을 검토합니다. 새 worker 파일 추가로 본체 allowlist가 깨지지 않는지 Windows/macOS 경로를 함께 확인합니다. 자동 모델 다운로드를 추가하지 않습니다.
- [x] 3. 후속 구현 지시에 따라 기존 `node tools/build/build-caption-installer.mjs`로 소스 패키지 JSON/메타데이터를 갱신했습니다. runtime 설치·probe와 소스 데이터 생성은 별개이며 설치본은 변경하지 않았습니다.
- [ ] 4. 향후 허용 시 구패키지→postprocess, 신패키지→A, 설치 중 작업 존재→교체 대기, 모델 미설치→설정 안내, 기존 설치 모델 보존을 검증합니다. 설치본 검증 없이 패키지 소스 일치만으로 성공을 선언하지 않습니다.

**완료 기준:** A만 점진 도입할 수 있으며 신규 본체 설치·신규 모델 수신을 요구하지 않는 구조입니다. 실제 업데이트 실행 여부는 따로 기록합니다.

### 작업 6: B의 연속 확정 HLS 창과 타임라인

**Files:** 신규 `extension/lib/caption-window-source.js`; 수정 `stream-transfer.js` `DownloadTrackResources`, `committed-snapshot.js:4`, `hls-remux.js:107`, `concurrent-captions-contract.js`.

**Interfaces:** 기존 Committed/LocalPlaylist/packet reader를 소비합니다. `CreateCaptionWindowSource`의 내부 유한 remux와 Spec §6의 `CaptionWindow`를 제공합니다. 별도 중복 공개 remux 함수는 두지 않으며 후속 작업 7·8이 이 descriptor를 사용합니다.

- [ ] 1. `out-of-order-window` fixture를 정의합니다. sequence 2 완료/1 미완료 또는 init 미완료이면 offer=0개, 모두 완료되면 신규 core가 순서대로 1회씩 나와야 합니다. 동일 retry는 window ID/hash를 유지합니다.
- [x] 2. transfer 완료 뒤 `{track,segment,committedBytes}` descriptor 알림을 노출합니다. 기존 committed prefix 함수의 순서/공통 A/V 검사를 재사용하도록 작은 공통 부분만 추출합니다. 네트워크 콜백에서 모델/추출 결과를 await하지 않습니다.
- [x] 2a. 현재 `Track.saved`가 생략하는 원본 sequence/range/init identity를 별도 metadata 또는 descriptor에 보존합니다. PTS는 패킷 읽기에서 얻고 저장 목록의 duration만으로 추정하지 않습니다.
- [x] 3. core=26초, 좌우 문맥 최대2초, 전체 입력 최대30초로 유한 창을 구성합니다. 추출은 새롭게 확정된 범위와 필요한 overlap만 읽고 누적 prefix 전체를 remux하지 않습니다. packet ring과 유한 압축 파일의 합이16MiB 한도를 넘으면 명시 budget 사유로 후처리하며 임의로 자료를 버리거나 무제한 버퍼를 만들지 않습니다.
- [x] 4. normalized packet clock/timebase·init/config·실제 오디오 샘플/priming 근거를 가진 source 내부 유한 remux를 구현합니다. HLS VOD 분리 AAC와 결합 오디오의 안정 단일 epoch에 한하며 실제 TS/fMP4 동작·품질 인수는 향후 검증으로 남깁니다.
- [x] 5. discontinuity/init 변경/PTS 비연속·지원 밖 codec·복원 불가 trim은 eligibility를 해제하고 이유를 반환합니다. packet clock의 근거가 없는데 EXTINF 누적으로 가짜 timestamp를 만들지 않습니다.
- [ ] 6. 향후 허용 시 TS/fMP4·ADTS/ID3·byterranges·init 지연·후행 세그먼트 먼저 완료·26초 정수배/1초 잔여·양/음 오프셋 fixture를 확인합니다. sample grid 매핑 오차 목표는 1/16000초 이내이며 ASR cue 정확도 목표와 구별합니다.

**완료 기준:** 닫히지 않은 파일이나 init 없는 fragment가 native에 전달되지 않고, source clock 증거가 있는 지원 입력에서만 B가 열립니다.

### 작업 7: B의 유한 창 업로드·admission·결과 보관

**Files:** 수정 `native/captions/host.py`, `engine.py`, `cpp-worker.py`, `extension/lib/local-captions-service.js`, `local-captions-native.js`, `local-captions-runner.js`, `concurrent-captions-contract.js`.

**Interfaces:** 작업 2 InferenceSession과 작업 6 CaptionWindow를 소비합니다. Spec §6의 `openConcurrent/beginWindow/appendWindow/sealWindow/windowResults/ackWindows/sealConcurrent/appendFinalCues`와 `CaptionHypothesis`를 제공합니다. `captionWindowVersion:1`은 이 계약이 완성된 뒤에만 광고합니다.

- [x] 1. 창 상태를 uploading→sealed→decoding→recognizing→result-ready→acknowledged로 정의합니다. 모든 상태는 job/attempt/windowId에 속하고 입력 bytes/hash가 다르면 같은 ID 재사용을 거절합니다.
- [x] 2. 기존 192KiB base64 chunk/offset ACK와 크기·순서·symlink/작업 경로 검증을 재사용합니다. 창 파일은 native job 디렉터리 아래에서만 생성하고 hash 검증 후 원자적으로 sealed 상태로 바꿉니다.
- [x] 3. 추출1·추론1·PCM3개·전송대기4개/16MiB admission을 집행합니다. 포화 시 credit=0을 반환하며 무제한 pool future/메모리 buffer를 만들지 않습니다. 기존 디스크/TTL 한도도 유지합니다.
- [x] 4. 결과는 revision/cursor를 포함해 영속 보관하고 작은 state event로 존재를 알립니다. `windowResults`는 한 페이지 최대64개·256KiB 미만이며 초과 result는 chunk 읽기를 사용합니다. raw 가설을 최종 SRT에 바로 append하지 않습니다.
- [x] 5. `ackWindows`는 확장이 확정한 범위만 해제합니다. 현재/다음 seam repair에 필요한 문맥과 raw 가설은 별도 lease로 보존합니다. cancel/forget은 worker 종료 ACK 후 소유 파일만 정리합니다.
- [ ] 6. 향후 허용 시 동일 chunk 재전송·offset 역전·내용 충돌·상한 초과·3개 PCM 대기·연결 두 개 같은 job·취소 후 late-result·worker crash 복구를 확인합니다. 기대값: 손실 없는 재시도, 큐 상한 유지, 다른 작업 미영향, 구세대 결과 저장 0회.

**완료 기준:** 창이 독립적으로 재시도 가능하고 결과/credit/수명 계약이 명시적이며, 정책 결정은 확장 coordinator에 남아 있습니다.

### 작업 8: B의 경계 병합·잔여 처리·finish/fallback

**Files:** 신규 `extension/lib/caption-window-merge.js`; 수정 `concurrent-captions-runner.js`, `caption-output-pipeline.js`, `hls-runner.js`, `local-captions-service.js`, `caption-job-progress.js`, `job-row.js`.

**Interfaces:** 작업 6의 창과 작업 7의 가설/credit를 소비합니다. 작업 2절의 merger 계약, `FinalCaptionResult`, sample coverage, repair/fallback reason을 제공합니다.

- [ ] 1. `seam-and-silence` 정답 fixture를 정의합니다. 26초 경계를 가로지르는 긴 한국어·영어 문장, 무음 두 창 뒤 첫 발화, 서로 다른 시각의 실제 반복 문장, 음악·발화 전환, 정확히 26초/끝 1초 잔여를 포함합니다. 텍스트가 없더라도 무음 coverage는 진도에 포함합니다.
- [x] 2. 가설 ID/revision/hash와 source sample 범위로 원장을 관리합니다. 같은 시각의 overlap token만 정렬하고 안전 구간을 확정합니다. 임의 전역 중복 제거·중점 기준 문장 삭제를 금지합니다.
- [x] 3. 미확정 seam에는 최대30초 repair 창을 최대2회 요청합니다. 해결되지 않으면 해당 epoch를 후처리하고 그 이유·재인식 범위를 기록합니다. 처음 B는 단일 epoch이므로 예외 전체 재인식 가능성을 UI/진단에서 숨기지 않습니다.
- [x] 4. EOF/finish 시 source를 seal하고 최종 미디어 공통 구간까지 남은 core와 마지막 seam을 처리합니다. `appendFinalCues`→`finalizeResult`로 확정 결과를 전달하고 작업 4 출력 경로로 이어갑니다. 정상 경로 확정 core의 재추론은 0회여야 합니다.
- [x] 5. 큐 포화는 cursor를 남겨 다운로드 후 drain합니다. 전체 fallback과 구별합니다. 취소는 attempt를 먼저 봉인하고 모든 대기·active·번역·저장을 중단합니다. snapshot은 기존 생성 제외를 유지하고 부모 세션을 reset하지 않습니다.
- [x] 6. 복구 때 원장/OPFS/native 압축 입력 존재를 확인합니다. 현 startup cleanup을 고려해 브라우저 재시작 후 미디어가 없으면 interrupted를 표시합니다. 재개 가능한 척 native result만으로 완료 처리하지 않습니다.
- [ ] 7. 향후 허용 시 텍스트/coverage 비교, 실제 A/V 재생 동기, finish 공통 A/V 끝 clip, fallback 1회만 실행, cancel-after-seal, 재시도 attempt 변경을 확인합니다. 긴 연속 발화의 seam 품질 미달이면 B 활성화를 보류합니다.

**완료 기준:** 정상 입력은 최종 전체 재인식 없이 완성하며, 실패 입력은 누락/중복을 숨기지 않고 제한된 repair 또는 설명 가능한 후처리로 전환합니다.

### 작업 9: B 점진 도입·성능/품질 인수 기록

**Files:** 수정 `native/captions/bootstrap.json`, `README.md`, `extension/lib/caption-runtime-contract.js`, 관련 생성 데이터; 신규 향후 문서 `docs/concurrent-captions-verification-YYYY-MM-DD.md`.

**Interfaces:** A 기본 capability와 B window capability를 별도로 소비합니다. 지원 source/codec/epoch 조건과 진단 결과를 rollout 기준으로 제공합니다.

- [x] 1. A/B를 함께 반영한 소스 패키지를3으로 정했습니다. 별도 A3 배포가 없으므로 B를4로 추가 증가시키지 않습니다. 공통 helper base 버전은 유지합니다. 설치·배포는 하지 않습니다.
- [x] 2. 내부 mode flag로 A만→B 분리 AAC HLS VOD→B TS 결합 오디오 순서로 허용합니다. window capability 없음은 A 또는 postprocess, 지원 밖 입력은 postprocess로 갑니다. 기존 화면에 새 설정 페이지를 임의 추가하지 않습니다.
- [ ] 3. 사용자 지시가 실행 검증을 허용한 후에만 아래 검증 행렬을 수행하고 결과/실패/미검증을 구분해 기록합니다. 승인되지 않았다면 문서상 미검증으로 남기며 테스트를 수행하지 않습니다.
- [ ] 4. 병행 이점이 없거나 품질·취소·자원 상한을 만족하지 못한 범위는 활성화하지 않습니다. 구현 존재·unit pass·패키지 생성만으로 제품 인수를 선언하지 않습니다.

**완료 기준:** 실제 확인한 입력 범위만 지원으로 표시하고 A/B/C·소스 검토·파일 생성·설치·실제 인식·저장 인수를 구분한 기록이 있습니다.

## 4. 향후 검증 행렬 — 모두 현재 미실행

아래 명령은 참고용이며 실행 허가가 아닙니다. 현재 사용자의 테스트 금지 지시가 유지되는 동안 실행하지 않습니다. 테스트 파일도 이번 작업에서 만들지 않았습니다.

| 검증 묶음 | 후보 파일/방법 | 확인할 결과 |
| --- | --- | --- |
| 순수 계약·시각·창·병합 | 향후 `tests/concurrent-captions-contract.test.mjs`, `caption-window-source.test.mjs`, `caption-window-merge.test.mjs` | 잘못된 attempt/sample 범위 거절, 역순/init, 무음 coverage, 반복 문장 보존, repair 상한. |
| 서비스·최종 출력·UI 회귀 | 기존 `tests/local-captions-service.test.mjs`, `local-captions.test.mjs`, `row-presentation.test.mjs`에 필요한 사례 추가 | mediaReady gate, 같은 phase 진도 갱신, 기존 오류 병합·generated+trackIds, 저장 receipt 멱등. |
| native 유한 입력·프로세스 | 기존 `native/captions/test_host.py`에 fake inference/process 사례 추가 | ACK 멱등, 큐·크기 상한, 모델1회/세션, 취소·lease·late-event. |
| 실제 입력/코덱 | 고정 로컬 TS/fMP4/ADTS·A/V offset·무음·긴 발화 fixture, Windows Faster-Whisper/whisper.cpp와 macOS whisper.cpp 별도 | 원본/후처리/병행 결과의 시각·텍스트 경계 비교. installed FFmpeg/CLI/binding/model/GPU 버전을 함께 기록. |
| 저장·실패 | 직접 선택 폴더/Chrome 다운로드 각각, 디스크 부족·권한 철회·번역 실패·두 번째 sidecar 실패 | 완성 final만 저장, raw 중복0, media receipt 있으면 재저장0, 일부 저장 상태 명시. |
| lifecycle | 각 단계 cancel, 중지 후 저장, snapshot 병행, native port 종료·offscreen 재생성·브라우저 재시작 | 다른 작업 보존, 소유 자식만 종료, 없는 입력의 가짜 재개 없음, 자막 생성 제외 snapshot 유지. |
| 성능/역압 | 같은 입력·같은 장치·같은 설정으로 postprocess/A/B 비교, 네트워크 느림/빠름·추론 느림·멀티 job | peak RAM/VRAM/PCM/큐·모델 로드 수·수신 처리량·총 완료시간·disk I/O 기록. |

향후 허용 시 선택 실행 예시는 `node --test tests/concurrent-captions-contract.test.mjs tests/caption-window-source.test.mjs tests/caption-window-merge.test.mjs` 및 `python -m unittest discover -s native/captions -p test_host.py`입니다. 파일·명령이 구현 시점과 맞는지 먼저 확인합니다. 광범위 `npm test`·`npm run check`·브라우저/설치 probe는 명시적으로 허용된 필요 검증에만 사용합니다.

성능 목표 제안은 3회 중앙값 기준 수신 처리량 저하 10% 이내·총 완료시간 악화 없음이며, 현재 검증 결과가 아닙니다. P0 기준은 시각 mapping·문장 경계·취소·최종 저장 일관성입니다. 성능 향상이 있어도 P0 실패면 인수하지 않습니다.

## 5. 후속 범위 C와 남기는 결정

- YouTube SABR 구간: 현재 네트워크 청크 store에서 완전 box/샘플 경계를 추가 판별해야 합니다. 기존 `YoutubePrefixReady`는 재생 가능 prefix의 신호이며 모든 새 오디오 창의 안전성을 보장하지 않습니다.
- 일반 MP4/WebM: moov/EBML/Cluster/sample-index·범위 읽기 전략을 별도 설계합니다. 초기 A/B에는 불완전 파일 ffmpeg 투입이나 새 range fetch를 추가하지 않습니다.
- 라이브/DVR/녹화: epoch/discontinuity sequence·PTS wrap·오디오/영상 원점·120초 lag 후처리 전환·무한 길이 진도를 별도 인수합니다. MediaRecorder 조각 독립성은 실제 포맷 계약을 확인하기 전 가정하지 않습니다.
- 병행 번역·화면 실시간 자막·작업 간 모델 공유 cache·외부 VAD 모델 추가는 이번 권장 범위 밖입니다. 기존 번역/provider와 두 엔진의 사용자 설정을 유지합니다.
- 브라우저 재시작을 넘어서는 입력 보존·복구는 현재 OPFS startup cleanup을 바꾸는 별도 수명 정책입니다. 이번 설계는 현재 세션/남아 있는 native 원장에 근거한 복구까지만 약속합니다.

## 6. 문서 자체 검토와 인계 상태

정적 자기 검토에서 요청의 현재 경로/유형별 가능성/외부 근거/대안/경계·VAD·타임라인/큐·모델/부분 저장/번역·삽입/책임·버전/진행률/검증 계획을 Spec과 작업 1–9에 대응시켰습니다. API 이름은 본 계획 §2와 Spec §6을 기준으로 통일했습니다. 공통 본체의 9파일 제한, 조기 결과 retime, staged retry 제한, job-row 진행 캐시, OPFS 재시작 정리를 구현자가 놓치기 쉬운 실제 소스 제약으로 반영했습니다.

사용자의 후속 구현 지시에 따라 A/B 기능 소스와 패키지3 생성 데이터를 작성했습니다. 구현 전 계획 리뷰, 공통 계약/UI 리뷰, 네이티브 리뷰와 수정, 확장 통합 리뷰, 전체 변경 리뷰와 최종 수정 재리뷰를 마쳤으며 **전체 명세·코드 품질은 소스 정적 검토 기준 Approved**입니다. 마지막 job capability 조회도 저장된 전체 recognition 설정으로 통일하고 설정별 cache 경계를 수정했습니다. 근거와 단계별 상태는 [정적 리뷰 기록](../../concurrent-captions-static-review-2026-11-10.md)에 남겼습니다. 테스트 파일 작성·실행, 구문 검사, 설치·확장 새로고침·실제 다운로드·인식·번역, 커밋·배포는 하지 않았습니다. 실행 검증이 없으므로 사용자 영상의 동작·성능·품질을 확인했다고 보고하지 않습니다. 작업별 실행 인수 조건은 소스 반영 여부와 별개로 계속 미검증입니다.
