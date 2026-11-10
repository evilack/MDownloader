> 전체 C의 현재 계약과 소스 gate 상태는 [전체 입력 구현·정적 리뷰 기록](concurrent-captions-complete-inputs-source-review-2026-11-10.md)을 참조하십시오. 아래 A/B·package3 기록은 당시 부분 검토의 역사적 증거이며 현재 전체 완료·speech5 설치/실행 증거가 아닙니다.

# 다운로드·음성 자막 병행 처리 소스 구현 및 정적 리뷰 기록

> **사용자 재지적에 따른 정정:** 아래 최종 승인·완료 기록은 A/B로 축소한 구현 부분의 정적 검토 기록입니다. 사용자는 C 제외를 승인하지 않았으므로 이를 전체 요청 완료 근거로 사용할 수 없습니다. 누락한 HLS Live·DVR, YouTube 수신 구간 등 전체 범위를 다시 대조하여 구현을 이어가며, 이후 상태는 추가 계획/리뷰 기록으로 갱신합니다.

작성일: 2026-11-10(한국 시간). **실행 검증 기록이 아닙니다.**

최종 상태: **A/B 소스 구현·지적 수정 반영, 전체 변경 명세 및 코드 품질 Approved(독립 소스 정적 리뷰 기준). 실제 설치·실행·품질·성능 인수는 미실행입니다.**

관련 문서: [구체화한 구현 계획](superpowers/plans/2026-11-10-concurrent-download-speech-captions.md), [가능성·설계와 외부 근거](superpowers/specs/2026-11-10-concurrent-download-speech-captions-design.md).

## 작업 조건과 변경 보존

사용자가 기존 계획을 구체화·리뷰·수정한 뒤 구현하도록 요청했습니다. 이전 테스트 금지는 유지되어 테스트, 구문·컴파일 검사, 브라우저, 네이티브 프로브, 설치 프로그램, 미디어/모델 다운로드, 음성 인식, 번역 API 실행을 하지 않았습니다. 커밋·배포·설치·확장 새로고침도 하지 않습니다.

기존 `codex/youtube-distribution-probe` 체크아웃에서 작업했으며 시작 HEAD는 `47d6fc9dbb58fce4f2f032c80080c8fc11c756cb`입니다. 이미 매우 많은 미커밋/미추적 변경이 있어 HEAD 전체 차이를 이번 구현으로 간주하지 않았습니다. 이번 작업이 다루는 파일의 편집 전 사본과 단계별 리뷰 자료는 `.superpowers/sdd/concurrent-download-speech-captions/`에 분리했습니다. 기존 작업을 되돌리거나 다른 작업트리로 이동하지 않았습니다.

기존 생성기 `node tools/build/build-caption-installer.mjs`는 소스 패키지 JSON/메타데이터 작성 목적으로 사용했습니다. 이 생성기는 설치·모델·인식·브라우저를 실행하지 않습니다. 생성 성공은 실제 설치·엔진 동작 성공의 근거가 아닙니다. 추가 네이티브 수정이 발생하면 최종 소스 상태로 다시 동기화합니다.

## 구현 전 계획 리뷰에서 수정한 계약

| 발견 | 반영한 결정 |
| --- | --- |
| tail HLS playlist를 창마다 새로 열면 타임라인 정규화 원점이 바뀜 | 최종 remux와 같은 전체 유한 manifest/Input 한 개와 한 번의 패킷 순회를 사용 |
| 현재 remux는 start만 반환 | 실제 복사한 audioStart/audioEnd/outputEnd도 반환하여 최종 clip에 사용 |
| B의 normalized packet clock에는 AudioShift가 미적용 | B final mapping에서 trackShift를 한 번 적용; A aligned remux와 구별 |
| 선행 AAC/priming이 음수 normalized timestamp를 가질 수 있음 | Input당 최초 packet에서 고정 epochOrigin을 잡아 비음수 sample 좌표로 처리하고 final mapping에서 복원. 이후 창마다 재정규화하지 않음 |
| 오디오가 영상보다 앞서 처리된 finish의 출력 범위 축소 | producer seal extent와 최종 coverage 부분집합을 분리, 이미 인식한 초과 구간은 clip |
| PCM admission과 seam 보존을 같은 ACK에 묶으면 repair 교착 | 추론 완료 PCM은 해제하고 압축 창/패킷/raw 가설에 별도 lease |
| 이전 worker의 최상위 pywhispercpp import | 선택 엔진의 import만 자식에서 수행 |
| host 내부 잠금만으로 installer 교체를 막을 수 없음 | bootstrap uv/pip/venv 변경부터 소스 교체까지 같은 OS lease 사용 |
| 공통 도우미 9파일 목록 외 macOS 개별 크기 제한 누락 | 기존 파일만 확장, base64 파일별262144/전체1MiB 제한을 생성기에서도 검사 |
| 기존 output-only retry에도 새 attempt를 만들면 결과 삭제 | 출력 재시도는 같은 attempt/resultRevision/저장 receipt 재사용 |
| 초안의 sample 변경 시 row 전체 재생성 제안 | 기존 UpdateJobRowMetrics가 갱신하므로 metric은 재생성하지 않고 retry 버튼 변화만 signature에 추가 |

## 공통 계약·표시 정적 리뷰

| 지적 | 수정과 정적 재리뷰 |
| --- | --- |
| 최종 길이를 모르는 windowed 진행률이 레거시 청크 개수를 사용 | sample 쌍이 없으면 phase와 관계없이 미정 값, mediaReady 전에는 수신 바 유지. ADDRESSED |
| processing 정책 누락/0/잘못된 타입이 패키지 생성 통과 | 빌드와 확장의 공통 순수 validator에서 native 필수 키·정수·범위 관계 검사. ADDRESSED |
| native보다 큰 trim을 JS 창 검증이 허용 | 같은 processing의 context/입력/trim 상한 검사. ADDRESSED |

구패키지 2의 기본 staged 준비 조건과 최신 음성 패키지 업데이트 조건을 분리했습니다. 기존 패키지의 후처리를 막지 않으며, 명시 업데이트 버튼은 최신 버전을 요구합니다. 공통 도우미 본체 버전은 바꾸지 않습니다.

## 네이티브 정적 리뷰

| 지적 | 수정과 정적 재리뷰 |
| --- | --- |
| A의 기존 FFmpeg 청크가 허용하던 짧은 packet tail을 새 worker가 거절 | 기존550000-frame 물리 허용 범위를 보존하고 모든 샘플로 시간을 누적. B는 별도 exact sample/30초 제한 유지. ADDRESSED |
| A finalize 후 길이 counter가 원본 절대 extent를 덮어 동일 요청 재시도 실패 | immutable rawSourceStartSample/rawSourceEndSample과 결과 길이를 분리. ADDRESSED |
| B timeout 후 자식이 살아 있는데 FIFO 추론 gate 반환 | 소유 자식 종료 확인 전 gate 반환 금지, 종료 재시도 동안 세션/권한 보존. ADDRESSED |
| A/legacy append가 B의 window/가설 저장량을 무시 | 전체 작업 트리 공통 admission과 같은 writer lock으로 집계. ADDRESSED |

별도 정적 재리뷰에서 위 네 건의 수정과 명세/코드 품질을 승인했습니다. 이 판정은 실행 테스트 통과가 아닙니다.

지속 whisper.cpp worker는 모델 가중치를 재사용하면서 **창 사이 누적 텍스트 prompt**는 초기화하도록 보완했습니다. `no_context=True`로 호출 진입 시 prompt를 비우고, `n_max_text_ctx`의 사용자 설정은 같은 창 안의 후속 디코딩에 계속 반영합니다. [pywhispercpp v1.5.1 모델 호출](https://github.com/absadiki/pywhispercpp/blob/v1.5.1/pywhispercpp/model.py#L374), [whisper.cpp v1.7.6 초기화](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/src/whisper.cpp#L6315), [같은 호출 안 문맥 사용](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/src/whisper.cpp#L6471)을 대조한 추가 정적 리뷰도 승인했습니다. 설치된 모든 바이너리의 동일 동작을 실행 확인했다는 뜻은 아닙니다.

자동 언어 감지는 비공백 인식 텍스트가 나오기 전까지 확정하지 않도록 A/B 공통 함수로 보완했습니다. 무음 창의 추정 언어로 다음 창을 강제하지 않으며, 사용자가 명시한 언어는 그대로 유지합니다. 이 추가 변경도 별도 정적 리뷰에서 승인했습니다. 별도 실제 발화 탐지기를 구현하거나 무음 인식 품질을 실행 검증한 것으로 확대하지 않습니다.

출력·번역 실패가 모델 슬롯을 계속 점유하지 않도록, A 인식 완료/B 최종화 후 모델 세션과 추론 예약을 먼저 해제했습니다. 임시 입력·최종 결과·저장 receipt의 lease는 별도로 유지합니다. B의 늦은 완료 callback이 finalized 상태를 되돌리지 않는 guard도 추가해 정적 리뷰를 받았습니다.

A의 진행률은 모델 로드 시점부터 WAV 헤더의 실제 frame 수 합계를 분모로 사용하고, 청크 결과를 기록한 뒤 실제 완료 frame 수를 올립니다. cue offset도 정수 누적 샘플 수를 기준으로 합니다. 패킷 경계 꼬리와 마지막 짧은 청크를 포함하며, `completed*30초` 추정은 사용하지 않습니다. 이 변경도 정적 리뷰를 받았습니다.

## 통합 상태

확장 A/B source·coordinator·merger·retained output session 소스 통합, 구현자 자기검토, 독립 통합 리뷰 및 수정, 새 리뷰어의 전체 변경 리뷰 및 최종 수정 재리뷰를 마쳤습니다. 전체 변경의 명세·코드 품질은 소스 정적 검토 기준 Approved입니다. 실동작 완료 판정은 하지 않습니다.

| 컴포넌트 | 소스 책임 |
| --- | --- |
| `caption-processing-policy` / `concurrent-captions-contract` | 단일 processing 정책·capability·attempt·창/샘플/상한 검증 |
| `caption-window-source` | 전체 HLS Input 한 개, 닫힌 파일 대기, 유한 AAC 창·고정 clock·repair packet lease |
| `caption-window-merge` | 시각이 겹치는 whole cue anchor·무음 coverage·제한 repair·확정 원장 |
| `concurrent-captions-runner` | A 시작/B admission·독립 창 루프·attempt·최종 timing·명시 fallback |
| `caption-output-session` / `caption-output-pipeline` | 임시 입력/결과·번역/artifact checkpoint·개별 저장 receipt·retry·TTL |
| 기존 transfer/remux/HLS/YouTube runner | commit 알림·조기 준비 완료 훅·실제 복사 범위·소유 workspace retain/release |
| 기존 service/native client/jobs/UI | 저장 job 설정·송신자·attempt 검증, stale 이벤트 차단, 기존 취소·바·상태 영역 |

A 소스 범위는 HLS/DASH와 YouTube VOD에서 기존의 **완전한 별도 오디오 준비가 먼저 끝나는 경로**입니다. B는 stable AAC/init/epoch를 가진 유한 HLS VOD입니다. partial SABR, 일반 MP4/WebM 증가 파일, 라이브/DVR/녹화 병행은 처음 정한 C 후속 범위이며 기존 후처리를 유지합니다. 어떤 실제 입력에서 B의 성공 경로가 성립하는지는 실행 검증하지 않았습니다.

실패한 출력 세션의 유예 기간은 native와 확장의 공통 `processing.retentionMs`에서 읽습니다. 인식 완료 뒤 모델 슬롯은 반환하되 retry에 필요한 파일 lease와 receipt는 별도 보존하고, 같은 attempt/revision의 출력 재시도는 성공한 최종 미디어를 다시 저장하지 않도록 구성했습니다. 이 내용은 소스 구조의 설명이며 저장 실패·TTL·재연결의 실제 경합을 재현한 결과가 아닙니다.

독립 통합 리뷰 1차에서 다음 네 소스 문제를 발견했습니다. 확장 수정분의 scoped 재리뷰는 네 건의 JavaScript 부분 모두 ADDRESSED로 판정했고, 별도 네이티브 복사 취소 gate도 명세·코드 품질 Approved / ADDRESSED로 닫았습니다. 이후 새 리뷰어의 전체 변경 리뷰에서 발견한 추가1건도 수정·재리뷰해 닫았습니다.

| 지적 | 수정 및 정적 재리뷰 |
| --- | --- |
| 브라우저 저장을 시작하면 stored state가 started여서 active만 보는 공통 취소를 벗어남 | 남은 staged 출력의 전체 수명에 기존 취소 적용, 완료 파일 receipt 보존. JS 및 native 복사 취소 gate 모두 ADDRESSED |
| native disconnect가 저장 phase만 실패로 만들고 source/clock 대기를 남김 | 포트의 job/attempt 범위로 실패 전달, source·clock·producer 대기 종료, reconnect의 살아 있는 offscreen 소유권 확인. JS ADDRESSED |
| package2/CLI-only에서 부분 저장 시 전체 준비 오디오를 재사용 | finalizer가 없는 postprocess는 실제 최종 임시 미디어로 새 attempt 준비, A/B 결과와 snapshot 부모 보존. ADDRESSED |
| beginAttempt의 await 뒤 atomic publish가 취소 상태를 재검사하지 않음 | 현재 상태·control token 재검증, 기존 취소 경로 revision 갱신·전후 abort 검사·명시 retry 승인. ADDRESSED |

취소 보완 과정에서 네이티브 `saveResult`가 동기 복사로 입력 루프를 막는 추가 경계도 교정했습니다. ordered-input에서 출력 소유권을 먼저 등록하고 기존 유한 요청 executor에서 복사합니다. 모델/출력 요청은 기존 물리적 admission 상한을 공유하고, 청크 사이·receipt 확정 직전 취소를 확인합니다. 취소 시 직접 만든 미완성 파일만 identity를 확인해 정리하며, 이미 완료한 파일·receipt는 보존합니다. 취소·새 attempt·forget·complete·prune·host 종료의 lease도 출력 종료까지 유지하도록 연결했습니다. 이 추가 변경은 별도 독립 native gate에서 명세·품질 승인을 받았습니다. 실제 파일시스템 I/O가 멈출 때의 취소 시간·플랫폼별 identity 동작은 미검증입니다.

수정된 소스로 생성한 package3 전달 JSON은179871bytes이며 기존9파일을 유지합니다. 각 파일의 실제 소스 SHA256과 JSON payload SHA256을 읽어 package hash와 일치함을 확인했습니다. 가장 큰 개별 base64는82168chars로 기존262144chars 제한 이내입니다. 이 기록은 파일 데이터 일치 확인이며 설치·실동작 검증이 아닙니다.

최종 전체 정적 리뷰에서 추가 Important1건을 발견했습니다. job의 capability probe에 `recognition` 옵션이 빠져 Intel Mac의 pywhispercpp1.2 + `useGpu:false` + 사용 가능한 CLI 조합을 병행 가능으로 잘못 선택할 수 있었습니다. `JobRecognitionOptions`·`ProbeJob`으로 네 probe와 실제 start/open이 같은 신뢰된 전체 설정을 사용하도록 통일했고, capability cache는 현재 선택 설정과 서비스의 trusted snapshot key가 일치할 때만 재사용합니다. 최종 scoped 재리뷰는 ADDRESSED이며 수정 범위의 추가 결함은 확인하지 못했습니다. native의 옵션 검증·사용자 설정·모델·fallback 이유는 그대로 유지합니다.

최종 판정은 앞선 전체 변경 리뷰와 단일 미해결 지적의 재리뷰를 합친 것입니다. 관련 전후 사본·원문 보고서는 `.superpowers/sdd/concurrent-download-speech-captions/`에 보존했습니다. `final-review.md`는 최초 전체 판정과 지적, `final-fix-review.md`는 해당 지적 종료와 최종 전체 source/spec Approved 판정입니다. 기존 미커밋 소스와 이번 작업의 비교 근거이므로 커밋을 만들지 않은 상태에서 삭제하지 않았습니다.

| 단계 | 최종 기록 |
| --- | --- |
| 계획 구체화·사전 리뷰·수정 | 반영 |
| A/B 기능 및 기존 출력·취소·후처리 통합 | 소스 반영 |
| 독립 소스 리뷰·지적 수정·재리뷰 | 전체 명세·코드 품질 Approved, 열린 소스 지적 없음 |
| 소스 패키지 JSON/메타데이터 작성 | package3·9파일·179871bytes, 소스/payload hash 일치 |
| 테스트 파일 작성·테스트·구문/컴파일/lint 검사 | 미실행 |
| 설치·확장 새로고침·실제 다운로드/모델/인식/번역 | 미실행 |
| 실제 품질·성능·소비자 인수 | 미실행 |
| 커밋·배포·게시 | 미실행, 기존 브랜치/미커밋 변경 보존 |

## 실행하지 않은 인수 항목

- 실제 TS/fMP4/ADTS의 AAC priming·리샘플·경계 sample mapping과 A/V 동기.
- 한국어/영어의 긴 발화, 무음, 실제 반복 문장, seam repair의 누락·중복.
- 양 엔진의 모델 로드 재사용·GPU/RAM·다운로드 처리량 및 총 완료 시간.
- Windows/macOS의 bootstrap/Python OS 잠금 호환과 venv 경유 부모 감시·자식 종료 지연.
- 입력별 EOF/finish/cancel/오류·native disconnect·재시작·출력 일부 저장 실패/재시도.
- 구패키지→신패키지 실제 업데이트와 설치된 모델 보존.

이 항목들은 기존 검증 금지가 변경되기 전까지 실행하지 않습니다. 실제 앱 적용과 품질·성능 인수는 소스 작성과 구분합니다.

