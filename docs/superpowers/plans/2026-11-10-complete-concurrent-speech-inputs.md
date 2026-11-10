# 다운로드·라이브·녹화 중 음성 인식 구현 계획과 상태

2026-11-10. [현재 구현 계약](../specs/2026-11-10-complete-concurrent-speech-inputs-design.md)이 규범입니다. 사용자 원래 권한으로 전체 입력을 구현하며 C 제외는 철회했습니다. 같은 `E:/Project/MDownloader` checkout, `codex/youtube-distribution-probe`, 시작 HEAD `47d6fc9dbb58fce4f2f032c80080c8fc11c756cb`와 기존 미커밋 변경을 유지합니다.

**현재 상태: 모든 입력의 소스 연결과 지적 수정을 마쳤으며, 전체 C의 명세·품질·도우미 책임 경계가 독립 정적 리뷰 기준 Approved입니다. 실제 설치·실행 인수는 수행하지 않았습니다.**

## 실행 범위

소스 편집·정적 리뷰·소스 패키지 데이터/해시 확인만 수행합니다. 테스트/test 파일, 구문·compile/lint·제품 import 검사, 브라우저/native probe, 설치, 미디어/모델 다운로드, ASR/번역/API·제품 흐름 실행은 하지 않습니다. 커밋·배포·리로드·설치본 변경도 하지 않습니다. source writer는 한 명이며 read-only 리뷰만 병행합니다. 스킬의 테스트·worktree·commit·정리 기본 절차보다 이 사용자 제한이 우선합니다.

확장은 모든 처리 순서·입력·metadata·MIME·모델/언어/옵션·창/clock/epoch·repair·출력/재시도·보존 정책을 소유합니다. 네이티브는 인증된 개별 명령 실행과 실행 안전성만 담당합니다. 리뷰 전후 모두 **도우미는 명령 실행만**을 판정합니다.

## 구현 순서와 gate

| 단계 | 소스 결과 | 독립 소스 판정/증거 |
| --- | --- | --- |
| 1. 원본 journal | immutable closed File, 연속 offset/sequence, 실제 EOF, frozen/lease | `c-journal-fix-review.md` Approved |
| 2. 범용 AVIO/PCM 명령 | avDecodeOpen/Poll/Supply/Ack/Close, actual PTS/count/hash, bounded queue, 실제 close/parent 수명 | `c-native-stream-fix2-review.md` Approved |
| 3. 확장 PCM/타임라인/실행/merger/output | trusted Stage, 실제 WAV 창, rational sourceOrigin, epoch spans/ACK, 같은 receipt/revision 복구 | `c-pcm-integration-fix2-review.md` Approved |
| 4. HLS Live/DVR·현재 MPD/VOD | 공유 packet clock, 실제 AAC N, snapshot/Finish 같은 ID, actual mux spans, ordinary+global repair 예약 | `c-hls-fix1-independent-review.md` Approved |
| 5. YouTube/direct/두 recorder | 닫힌 writer/store commit → journal → PCM, strict metadata wait, pending owner, 실제 MIME/spans, raw retention | `c-producer-fix1-independent-review.md` Approved; 원래 비동기 Job-copy P2 해결 |
| 6. 전체 C source/call-path | 39개 변경/신규 소스의 earliest per-file C baseline 대비 통합 검토 | `c-whole-source-review.md` + `c-whole-fix-independent-review.md`: Approved |
| 7. package/docs/검증 인계 | speech5 데이터/해시 재확인, 최종 API/입력/수명/미검증 문서 | package 최종 해시 재대조·문서·검증 인계 확정 |

위 Approved는 각 소스 gate에 한정됩니다. 실행·구문·브라우저·설치 인수를 뜻하지 않습니다. 개별 gate나 이전 A/B 정적 승인을 전체 요청 완료 근거로 사용하지 않습니다.

## 입력별 제출 경로

| 입력 | 수신 종료 전 창으로 이어지는 연결 | 실제 종료/최종화 |
| --- | --- | --- |
| HLS Live/DVR·MPD/VOD | close/getFile → capture.commit → 공유 mapped packets → guarded AAC 실제 decode → finite window | workers drain → mapped selection IDs → seal → 같은 frozen reader/mux spans |
| YouTube VOD/Live/DVR | audio writer close/getFile → audio journal → StartCommittedCaptions → PCM source.next → finite WAV | receiver/copy/writer drain 뒤 seal; trackReady EOF의 경쟁 whole-audio 준비 제거 |
| Direct streaming/faststart | 같은 main GET → closed original chunks → metadata readiness → 공통 PCM | 실제 EOF seal; raw는 같은 원본 File 목록을 그대로 합성 |
| Direct classic tail-moov | strong identity Range의 원래 위치 metadata overlay + main journal; 불가하면 metadata-waiting | Range 불가 시 실제 원본 EOF 뒤 full owned journal을 seekable로 open; 두 번째 전체 GET·가짜 EOF 없음 |
| Page recorder | 인증/sequence → 공통 sink/store disk commit → journal → PCM | ACK는 disk 뒤, queued final data/sink drain 뒤 finish/source-lost seal |
| Background recorder | 같은 Entry.job/controller와 같은 store commit → journal → PCM | 실제 MIME·공통 preference·같은 cancel signal, recorder Tail/sink drain 뒤 seal |

원본 callback은 ASR을 await하지 않습니다. source 실패는 download를 abort하지 않으며 exact raw와 retry owner를 보존합니다. pending metadata/decoder 초기화는 await 전에 OutputSession.captionSources에 등록하고 실제 decoder close 전 journal OWNER/workspace를 반환하지 않습니다. snapshot은 부모 attempt/source를 reset하지 않습니다.

## 정적 리뷰 수정 기록

- Journal: 잘못된 null range 입력을 실제 API에서 거절하도록 수정하고 재리뷰했습니다.
- Native: Poll의 실제 전송 JSON 상한, 실패한 sessionOpen 뒤 child/lease 보존, close 재시도 시 owned cleanup 확인을 수정·재리뷰했습니다.
- PCM/output: TextDecoder shadow, metadata await 뒤 lost wake, 완료된 recognition/receipt 재사용 전 새 attempt, confirmed early recovery 뒤 stale preparation barrier를 수정·재리뷰했습니다.
- HLS: 취소된 scope를 재사용한 준비 파일 삭제, PTO/duration 구시계의 partial/Finish 선택을 수정했습니다. finite ordinary 예약과 한 global repair slot을 decoder/prepare admission 양쪽에 적용했습니다. binary64 경계와 readiness 알림까지 독립 재리뷰했습니다.
- Producer: YouTube Job 복사 뒤 늦은 startup failure가 사라져 whole-audio 준비로 들어갈 수 있는 P2를 공유 transport의 settled error로 수정·재리뷰했습니다. 실제 close 실패가 우선하며 명시적 retry 흐름은 유지합니다.

실행 재현을 주장하지 않습니다. 실제 지적과 수정·회귀 근거는 해당 원문 보고서에 있습니다. 전체 리뷰의 유일한 P1-CW1은 앱의 unique temp 작성·generic atomic move 게시·정확한 signature 대조와 pending 소유권 보존으로 수정했으며, 독립 재리뷰는 ADDRESSED/새 회귀 없음으로 승인했습니다. 문서상 제외로 지적을 닫지 않았습니다.

## 소스 패키지와 설치 경계

소스 speech package5는 11파일, JSON141856bytes이며 source/decoded payload/bundle SHA256이 모두 일치합니다. `c-package-source-integrity-final.json`이 최종 데이터 증거입니다. `caption-runtime-metadata.js`도 package5/11파일을 선언합니다. Windowscommon9.1·macOScommon9/protocol1/execution2는 유지합니다. feature 추가 때문에 본체 재설치를 요구하지 않습니다.

현재 실제 설치본은 common9.1/speech4/execution2라는 인계 상태이며 여기서 재조회·변경하지 않았습니다. 후속 검증의 갱신 대상은 최종 확장 소스와 speech5 기능 패키지 및 PyAV 의존성입니다. 기존 모델·설정·다운로드·다른 작업을 보존합니다. 구현·전체 gate가 끝나기 전에 검증 시작을 요청하거나 설치본을 변경하지 않습니다.

## 남은 인수 증거

별도 설치/Chrome 검증 담당자는 최종 인계 후 first-window-before-EOF, 실제 AVIO·44.1/48k·Opus delay/discard와 PTS, gap/epoch/Live wrap/discontinuity/DVR 선택, metadata identity/noRange, recorder pause/source-lost/cancel, actual mux/cue sync, 장시간 자원·contention, physical close·disconnect, 같은 revision/receipt 출력 retry, snapshot 독립성을 확인해야 합니다. 이 목록은 여기서 실행할 허가가 아닙니다.

전후 source baseline, gate 원문, 변경 파일/해시 manifest와 최종 검증 인계는 `.superpowers/sdd/concurrent-download-speech-captions/`에 보존합니다. 최종 public 정리 전 문서는 `c-public-docs-before-final/`에 보존했습니다. 기록·기존 dirty 파일을 삭제하거나 이전 source snapshot으로 제품을 덮어쓰지 않습니다.



