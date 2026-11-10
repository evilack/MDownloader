> **2026-11-10 최신 상태:** 짧은 구간 중간 인식 출력(f4adf1e)과 라이브 VTT 파일 지속 갱신(960b39d)을 별도 구현·커밋하고 각각 독립 소스 리뷰를 통과했습니다. 승인된 기존 내부 소스 기준 커밋은781f9d0입니다. 최신 범위와 한계는 `.superpowers/sdd/concurrent-download-speech-captions/short-latency-live-file-final-verification.json`, `low-latency-independent-review.md`, `live-file-independent-review.md`, `short-latency-live-file-combined-review.md`를 따릅니다. 설치·테스트·제품·실제 라이브 실행은 하지 않았습니다. 자동 복구·macOS는 취소·원복 상태이며 재개하지 않습니다. 아래는 이전 구현 기록입니다.

# 전체 입력 병행 음성 자막 소스 구현·정적 리뷰 기록

작성일: 2026-11-10, 한국 시간.

**현재 상태: 전체 입력의 소스 구현과 지적 수정을 마쳤으며, 전체 C의 명세·품질·도우미 책임 경계가 독립 정적 리뷰 기준 Approved입니다. 실제 설치·실행 인수는 수행하지 않았습니다.**

이 기록은 이전 A/B 부분 정적 승인과 구별되는 전체 C 소스 기록입니다. 사용자가 C 제외를 승인한 적은 없으며, 원래 요청의 HLS Live/DVR·현재 MPD/VOD·YouTube 수신 중·일반 파일·두 recorder를 포함합니다. [현재 계약](superpowers/specs/2026-11-10-complete-concurrent-speech-inputs-design.md)과 [구현 계획·gate 상태](superpowers/plans/2026-11-10-complete-concurrent-speech-inputs.md)가 대응 문서입니다.

## 작업과 검증의 경계

기존 `E:/Project/MDownloader`, `codex/youtube-distribution-probe`, 시작 HEAD `47d6fc9dbb58fce4f2f032c80080c8fc11c756cb`와 대규모 기존 미커밋 변경을 보존했습니다. checkout 전체 HEAD diff를 이번 구현으로 간주하지 않았습니다. C의 earliest per-file baseline과 현재 소스를 비교한 39개 변경/신규 파일(신규12개)의 manifest·diff를 분리했습니다.

source writer는 한 명씩 순차 소유했으며 독립 리뷰는 제품 소스를 수정하지 않았습니다. root는 문서·패키지 데이터만 담당했습니다. 새 worktree/branch, reset/clean/stash·원본 복구·커밋·배포·리로드·설치본 변경은 수행하지 않았습니다. 전후 snapshot과 과거 보고서를 삭제하지 않았습니다.

사용자 제한에 따라 테스트/test 파일, 구문·compile/lint·제품 import 검사, 브라우저/native probe, 설치, 실제 미디어/모델·의존성 다운로드, ASR/번역/API·제품 흐름 실행을 하지 않았습니다. 소스 작성, 정적 호출 경로·diff·문서 검토, 패키지 데이터/해시만 확인했습니다. 실제 first-window 동작·품질·동기·성능을 통과했다고 주장하지 않습니다.

## 입력별 소스 결과

| 입력 | 실제 소스 연결 | 독립 정적 판정 | 실제 사용 |
| --- | --- | --- | --- |
| HLS Live/DVR·현재 MPD/VOD | 닫힌 segment → shared capture/clock → 실제 AAC 준비 → 유한 창; snapshot/Finish/final mux 같은 selected IDs | HLS fix1 Approved | 미실행 |
| YouTube SABR VOD/Live/DVR | audio writer close/getFile → audio journal → 공통 PCM; EOF는 seal만 수행, trackReady 경쟁 준비 제거 | Producer fix1 Approved | 미실행 |
| 일반 streaming/faststart 파일 | 같은 main GET의 닫힌 원본 chunks → metadata readiness → 공통 PCM; raw는 같은 File 목록 | Producer fix1 Approved | 미실행 |
| classic tail-moov | strong identity metadata Range overlay; 불가하면 metadata-waiting → 원본 EOF 뒤 full owned journal seekable | Producer fix1 Approved | 미실행 |
| 페이지 recorder relay | 인증/sequence → shared sink/store disk commit → journal → PCM; disk 뒤 ACK | Producer fix1 Approved | 미실행 |
| background WebRTC recorder | 같은 Entry.job/controller, 같은 store commit → PCM; actual MIME/공통 preference/cancel signal | Producer fix1 Approved | 미실행 |

이 표의 연결은 정적 call graph로 확인한 것입니다. 실제 demuxer/codec별 지원이나 모든 서버·브라우저에서의 동작 인수를 뜻하지 않습니다. DRM·기존 downloader가 해석하지 못하는 입력을 새로 지원한다고 표시하지 않습니다. 실제 metadata가 없거나 output writer가 표현하지 못하는 config 전환은 구체 상태·오류로 남기며 정상 입력 범주 전체를 제외하지 않습니다.

## 공통 컴포넌트와 출력 수명

- `committed-media-source.js`: immutable closed File journal, 실제 frontier/EOF, revision/frozen view·lease. producer callback은 ASR을 기다리지 않습니다.
- `caption-committed-input.js`: metadata await 이전 pending owner 등록, shared startup outcome, journal owner를 actual source close까지 유지. source 오류가 원본 download를 abort하지 않습니다.
- `media-range-source.js`와 ReadMp4Metadata strict 옵션: 같은 URL·total·strong ETag·access context, exact206/range/bytes, 원래 위치 scanner headers/moov overlay. 두 번째 전체 다운로드·가짜 EOF·raw remux를 하지 않습니다. legacy snapshot 기본 의미는 보존합니다.
- `caption-pcm-source.js`와 `caption-timeline.js`: actual PCM bytes/count/hash/PTS, rational sourceOrigin, 양의 첫 지연·epoch gap, bounded WAV/ring, 실제 copied-span 최종 mapping.
- `hls-capture-clock/source/selection`과 `caption-audio-preparation.js`: caption/final 공유 clock·descriptor ID, 명시 track shift 한 번, 실제 no-trim decode count 관찰 뒤 immutable AAC window와 exact slice.
- `caption-execution.js`와 runner/merger/output session: trusted attempt/Stage, actual decoder close, original core ACK·repair lineage, shared ordinary/global repair admission, bounded durable ledger/pages, exact mapping/result revision·output receipt 재사용.
- `recording-format.js`와 두 recorder: 공통 supported WebM/Opus preference가 page probe/reserve/start와 background receiver로 전달되고 실제 Recorder.mimeType이 job/확장자를 결정합니다. timeslice는 연속 원본의 일부입니다.

unchanged direct/recording은 composition0과 실제 PCM spans를 사용하며 가짜 video duration이나 first-audio-relative offset을 만들지 않습니다. HLS/YouTube는 packet add 성공 뒤의 copiedAudioSpans와 실제 mux timing을 사용합니다. gap을 min/max coverage로 채우지 않습니다.

Job과 CaptionOutputSession이 exact raw/mux 파일·mapping receipt/digest/result revision과 source/workspace lease를 보존합니다. 녹화는 rawFile 할당 전부터 producer/caption/snapshot owner를 분리합니다. pending initialization 중 취소도 초기화와 실제 decoder close를 확인한 뒤 journal/workspace를 반환합니다. close 불명확·실패는 owner를 유지합니다. snapshot은 부모 attempt/source를 reset하지 않습니다. 출력 실패만의 retry는 완료된 recognition과 같은 revision/receipt를 재사용하며, 실제 recognition 실패·명시 옵션 변경은 기존 명시적 retry 경로로 구별합니다.

## 독립 리뷰와 수정

| gate | 최종 원문 | 소스 판정 |
| --- | --- | --- |
| Journal | `c-journal-fix-review.md` | Approved |
| Native stream | `c-native-stream-fix2-review.md` | Approved |
| PCM/receipt recovery | `c-pcm-integration-fix2-review.md` | Approved |
| HLS + shared PCM reservation | `c-hls-fix1-independent-review.md` | Approved |
| Producer + async startup handoff | `c-producer-fix1-independent-review.md` | Approved |
| Whole C | `c-whole-source-review.md` + `c-whole-fix-independent-review.md` | Approved, P1-CW1 ADDRESSED·새 회귀 없음 |

주요 수정은 native 전송 크기/실제 cleanup 수명, TextDecoder binding, metadata await lost wake, 완료된 recognition/receipt 복구 전 새 attempt, stale preparation barrier, 취소된 scope의 파일 삭제, 옛 PTO/duration 좌표로 partial/Finish 선택, queued decoder의 resident repair capacity 선점, YouTube Job 복사 뒤 늦은 startup 오류 전달입니다. 원문은 실제 실패 경로·source line과 fix disposition을 보존합니다.

전체 리뷰는 supplied 39개 현재 SHA256이 manifest와 모두 일치함을 확인했고, P1-CW1 외 확정 P0/P1/P2를 보고하지 않았습니다. P1-CW1은 sole extension-state.json 직접 truncate 쓰기가 다음 저장 중 중단되면 이전 accepted ACK/result/revision까지 손상시킬 수 있다는 문제입니다. 확장 소유 temp에 완전한 snapshot을 쓰고 기존 generic atomic move로 게시하며, 불명확 응답은 exact generation/signature read로 대조하는 수정을 마쳤고 독립 재리뷰가 원 P1-CW1 ADDRESSED·새 확정 회귀 없음으로 승인했습니다. 새 helper workflow나 본체 변경은 필요하지 않습니다. process/connection interruption에 대한 보존과 power-loss/fsync 보장을 구별합니다.

모든 단계의 도우미 책임 경계는 **도우미는 명령 실행만**입니다. 실제 선택·흐름·retry·retention은 JS에 있고 native는 개별 계산/파일 명령과 안전성 사실만 반환합니다. helper에 앱 JSON 해석·병합·최종화 판단을 넣지 않습니다.


최종 checkpoint 수정은 확장 한 파일에 한정됩니다. unique sibling temp의 완전한 쓰기와 기존 generic move replace:true 뒤에만 persistedPublic/event를 승인합니다. 불명확한 move는 같은 generation과 전체 파일 signature로 대조하며 무조건 재실행하지 않습니다. busy/reset/reopen/expiry는 pending 소유권을 보존하고, 새 실행기는 발견한 foreign temp를 삭제하지 않은 채 accepted 상태의 읽기만 허용합니다. 이전 host의 종료를 입증할 수 없는 disconnected write/cleanup 또는 orphan temp는 불확실성 잠금을 남길 수 있습니다. 자동 crash recovery·시간 경과 강제 해제·power-loss/fsync 보장을 주장하지 않습니다.
## 패키지·설치·갱신 대상

| 대상 | 소스 상태 | 실제 설치/사용 상태 |
| --- | --- | --- |
| 확장 | manifest0.2.43, 현재 checkout 소스 | 이 작업에서 리로드하지 않음 |
| common helper | Windows9.1·macOS9 / protocol1 유지 | 기존 Windows 검증 채팅 인계 common9.1; 여기서 재조회/변경 안 함 |
| speech feature package | 5 / executionProtocol2 / 11파일 | 인계 설치 speech4; package5 미설치 |
| AV dependency | requirements의 av==15.1.0 | 이 작업에서 설치·import 안 함 |

speech5 JSON은 141856bytes이고 11파일 모두 실제 source SHA256 = decoded payload SHA256 = bundle의 파일 hash입니다. `c-package-source-integrity-final.json`은 최종 데이터 일치 증거입니다. JSON 전체 SHA256은 `6a594261b0e1ce68c3253d995ca9b535d86decb39ba9a1ab0c669972d652f1a4`, generated metadata SHA256은 `7521663be851e63d458f9b0695175bb5f882b2ad4af5e52f9e8e7d1ffc1350d4`입니다. native 변경이 없으면 이 데이터는 재생성하지 않고 최종 재대조합니다.

후속 검증의 갱신 대상은 최종 확장 소스와 speech5 기능 패키지/PyAV 의존성입니다. 현재 common9.1의 가변 파일 매니페스트 계약을 재사용하므로 기능 때문에 common 본체를 재설치하지 않습니다. 기존 모델·설정·다운로드·미확인 파일·다른 작업을 보존해야 합니다. 전체 source gate 전에는 검증 시작을 요청하거나 설치본을 변경하지 않습니다.

## 남은 실제 인수

실제 첫 창이 EOF/Finish 전에 제출되는 시점, actual AVIO reads/seek/short-read와 partial EOF, 44.1/48k·Opus delay/discard·priming·actual PTS/sample facts, subtitle A/V 동기, Live wrap/discontinuity/config/DVR snapshot, tail-moov identity/noRange, recorder pause/loss/cancel, long-run bounds/model contention, native cancel/close/parent death/disconnect, 같은 attempt/revision/receipt의 output retry, 설치 반영·성능은 미검증입니다.

전체 source gate와 최종 인계가 끝난 뒤 별도 검증 담당자가 이 증거를 채워야 합니다. 이 문서 자체는 여기서 실행을 시작할 허가나 설치 성공 기록이 아닙니다. 원문 baseline·review·manifest·인계 파일은 `.superpowers/sdd/concurrent-download-speech-captions/`에 보존합니다. 이전 A/B public 문서와 pre-final 원문은 역사적 부분 기록이며 현재 전체 완료 증거로 확대하지 않습니다.



