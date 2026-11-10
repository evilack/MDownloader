# 다운로드·라이브·녹화 중 음성 인식 구현 계약

2026-11-10. 현재 전체 C 소스의 계약을 정리한 문서입니다. 단계별 판정은 [구현 계획](../plans/2026-11-10-complete-concurrent-speech-inputs.md)과 최종 검토 기록에 따릅니다. 소스·정적 리뷰·패키지 데이터 일치와 실제 설치·사용 인수를 구별합니다.

## 범위와 실행 제한

사용자가 승인한 범위는 계획 구체화 → 리뷰·수정 → 전체 구현입니다. 이전 작성자의 C 제외는 사용자 승인이 아니었으며 철회했습니다. HLS Live/DVR, 현재 해석 가능한 MPD/VOD, YouTube SABR 수신 중, 일반 파일, 기존 두 녹화 경로를 포함합니다. 정상 입력을 범주 이름만으로 제외하지 않습니다.

테스트·test 파일, 구문·compile/lint·제품 import 검사, 브라우저·native probe, 설치, 미디어·모델 다운로드, ASR·번역·API·제품 흐름 실행을 하지 않습니다. 소스 편집·정적 리뷰·소스 패키지 데이터와 해시 확인만 허용합니다. 커밋·배포·리로드·설치본 변경도 하지 않습니다.

## 앱과 도우미의 책임

확장은 입력·메타데이터·MIME 선택, URL·쿠키·접근 문맥, 창·clock·epoch, admission·repair, 모델·언어·옵션, 자막 병합, 출력 이름·최종화·재시도·보존을 소유합니다. 도우미는 인증과 명령·경로·자원 검증 후 지정된 개별 명령만 실행하고 사실·오류를 반환합니다. 프로세스 소유권, 취소 전달, 실제 종료 확인은 실행 안전성 책임입니다. 앱 코드를 Python으로 옮겨 workflow를 실행하지 않습니다.

범용 native AVIO 명령은 `avDecodeOpen/Poll/Supply/Ack/Close` 다섯 개입니다. 확장 `CaptionStage`의 `decoderOpen/Poll/Supply/Ack/Close`가 trusted job·attempt·controlRevision과 native handle을 관리합니다. 실행기는 URL을 가져오거나 인식·병합·재시도를 선택하지 않습니다. bounded input 요청과 PCM의 실제 bytes·samples·PTS·timebase·해시·종료 사실을 반환합니다.

소스 speech package는 **5**, Windows common helper는 **9.1**, macOS common helper는 **9**, common protocol은 **1**, execution protocol은 **2**입니다. 새 decoder 두 모듈과 `av==15.1.0`은 speech package의 가변 파일 매니페스트에 포함됩니다. 이 기능 때문에 common helper 본체를 재설치하지 않습니다. 현재 설치 common9.1/speech4/execution2는 별도 검증 담당자가 나중에 갱신·확인할 대상입니다.

## 닫힌 원본 바이트와 초기화 소유권

`committed-media-source.js`는 실제 `write → close → getFile` 뒤의 immutable Blob/File만 게시합니다. offset은 연속, sequence는 +1이며 원본 bytes를 변형하지 않습니다. read는 아직 오지 않은 바이트를 기다리고 임시 빈 prefix를 EOF로 답하지 않습니다. producer drain 뒤 실제 frontier로 `eof/finish/source-lost`를 seal하며 실패·취소는 정상 EOF와 구별합니다. frozen selection과 lease는 부모 snapshot·인식 수명을 분리합니다.

`caption-committed-input.js`의 `StartCommittedCaptions(Job, Journal, Workspace, Signal, Metadata)`는 metadata/decoder 초기화를 기다리기 전에 pending owner를 `CaptionOutputSession.captionSources`에 등록합니다. `CreateCaptionPcmSource`와 `ConcurrentCaptions.windowed`를 연결하며 trusted attempt/openConcurrent 뒤 `WindowLoop`가 source.next를 구동합니다. 다운로드 write·ACK callback은 초기 metadata 대기·demux·ASR을 await하지 않습니다. 비동기 startup의 최종 오류는 복사된 출력 Job도 공유하는 captionSession transport에 보관합니다.

기본 access는 unknown-size nonseekable입니다. seekable read에는 journal retain만으로 충분하지 않으므로 journal OWNER admission도 실제 source close까지 유지합니다. owner.release는 초기화 중단·정착과 Source.release를 기다린 뒤 journal owner를 반환합니다. close가 실패·불명확하면 source와 workspace lease를 남깁니다.

## 실제 PCM과 창·시간 계약

`CreateCaptionPcmSource({job, stage, bytes, metadata?, workspace, signal})`는 bounded AVIO 요청에 원본 바이트를 공급하고 실제 PCM count·hash·PTS를 검증합니다. 16kHz mono s16의 유효 바이트는 정확히 samples*2이며 plane padding을 내보내지 않습니다. container delay/discard는 연속 decoder가 처리하며 앱에서 다시 중복 제거하지 않습니다.

sourceOrigin은 min(0, 첫 실제 PCM PTS)를 정확한 rational로 한 번 고정합니다. 전역 sample 시작은 그 원점과 실제 PTS의 차이를 한 번 양자화하고 끝은 시작+실제 sample 수입니다. 양의 첫 오디오 지연은 보존합니다. forward gap은 같은 grid의 새 epoch와 빈 구간으로 남기며 silence를 채우지 않습니다. 근거 없는 backward/reset PTS에는 임의 누적 시각을 만들지 않습니다.

닫힌 유한 WAV 창은 기존 beginWindow/upload/sealWindow/inference를 재사용합니다. 인식 credit이 source.next를 제한하므로 무제한 독립 pump가 없습니다. PCM 복사 뒤 decoder ACK, durable 결과와 원본 core 증명 뒤 window ACK, 같은 epoch의 seam 확정 뒤 ring 해제 순서를 지킵니다. repair lineage는 새 원본 coverage로 세지 않으며 epoch 사이 텍스트를 합치지 않습니다. gap을 전체 길이나 인정된 coverage에 넣지 않습니다.

## HLS·DASH의 공유 capture와 AAC

`hls-capture-source.js`는 descriptor, init/range identity, absolute discontinuity, PDT와 실제 닫힌 commit을 보관합니다. public SDK per-segment Input/EncodedPacketSink에서 읽은 packet을 caption 창과 최종 remux가 공유합니다. reference video와 같은 discontinuity의 raw PTS·packed AAC ID3·wrap 근거를 `hls-capture-clock.js`에서 한 번 계산합니다. PTS가 PTO와 같다고 가정하지 않습니다.

`hls-capture-selection.js`는 실제 mapped packet 시작/끝과 명시 track shift 한 번으로 snapshot/Finish의 공통 prefix를 선택합니다. 측정되지 않거나 닫히지 않은 descriptor를 건너뛰지 않습니다. snapshot·Finish·frozen reader·출력 재시도는 같은 selectedByTrack ID를 소비합니다. commit은 측정·ASR을 await하지 않으며 readiness observer가 첫 partial-save 가능 상태를 알립니다.

HLS AAC의 44.1k→16k 변환은 국소 round와 절대 endpoint 차이가 같다고 가정하지 않습니다. guard를 포함한 후보 M4A를 앱 준비 컴포넌트가 기존 범용 decode(trim 없음)로 계산해 실제 WAV frame 수를 관찰한 뒤 최종 immutable descriptor를 확정합니다. bounded read/write로 정확한 PCM slice를 재사용하며 일반 core를 줄이거나 ceil·1sample 허용으로 맞추지 않습니다. terminal support도 descriptor/ACK 전에 실제 결과로 확정합니다.

SDK MP4 writer가 표현하지 못하는 effective codec/config 변경은 변경 packet을 쓰기 전에 명시 오류로 남깁니다. stable Live/discontinuity/wrap을 그 사유로 제외하지 않습니다. 공유 PCM admission은 실제 persistent decoder·finite ordinary owner와 finite job의 ordinary 예약, 전역 repair 한 자리를 함께 계산합니다. 정책 상한을 늘리거나 모델을 source 대기용으로 점유하지 않습니다. known backpressure만 같은 attempt에서 기다리며 unknown open을 재실행하지 않습니다.

## 입력별 실제 연결

| 입력 | commit부터 창까지 | 종료·출력 |
| --- | --- | --- |
| HLS Live/DVR·현재 MPD/VOD | 닫힌 segment → 공유 capture reader → 실제 AAC 준비 → 창 | worker drain → mapped prefix 선택·seal → 같은 ID로 mux |
| YouTube SABR VOD/Live/DVR | audio writer close/getFile → audio journal → PCM source | receiver와 writer drain 뒤 seal; audio EOF는 시작 조건이 아님 |
| 일반 owned GET | 같은 main GET의 닫힌 chunk → journal → metadata readiness → PCM | 같은 원본 File 목록을 합친 raw Blob; decoder 목적 remux·두 번째 전체 GET 없음 |
| 페이지 MediaRecorder relay | 인증·sequence 확인 → 공통 recording sink/store disk commit → journal | disk 뒤 ACK, final data와 sink drain 뒤 finish/source-lost seal |
| 백그라운드 WebRTC recorder | 동일 Entry.job/controller와 같은 recording store → journal | 실제 Recorder.mimeType·같은 취소 신호, data Tail/sink drain 뒤 seal |

신규 caption recording은 `recording-format.js`의 공통 목록에서 실제 지원되는 WebM/Opus를 우선합니다. 같은 목록을 serialized page probe/reserve/start와 background receiver에 전달하고 실제 MIME을 job과 확장자에 반영합니다. 이미 실행 중인 녹화는 변경하지 않습니다. timeslice·transport chunk를 독립 미디어로 취급하지 않습니다.

## Direct MP4 metadata readiness

`media-range-source.js`는 실제 committed header로 access를 결정합니다. complete moov가 mdat 앞에 준비되면 incremental nonseekable decode가 가능합니다. classic tail-moov의 조기 Range는 실제 응답의 양의 total, strong ETag, 동일 URL·접근 문맥, decoded Content-Encoding 부재가 확인될 때만 사용합니다. ReadMp4Metadata의 opt-in strict 옵션은 exact 206/Content-Range/total/response bytes와 validator를 대조하며 scanner header·moov를 원래 byte 위치에 보관합니다. 기존 snapshot 호출의 기본 의미는 유지합니다.

overlay는 metadata만 제공합니다. 미래 media read는 main GET commit을 기다립니다. identity mismatch는 명시 source 오류이며 자동 대체·재수신하지 않습니다. 약하거나 없는 validator, 인코딩 응답, 사용할 수 없는 Range는 metadata-waiting으로 표시합니다. main GET은 계속되며 실제 EOF 뒤 보존된 전체 journal을 known-size seekable로 한 번 엽니다. nonseekable decoder가 EOF 뒤 역seek할 수 있다고 가정하지 않습니다. 조기 검증 total도 main GET의 실제 최종 크기와 대조합니다.

## 최종 mapping·저장·재시도

HLS와 YouTube는 실제 packet add 성공 뒤의 copiedAudioSpans, mux start/outputEnd, 명시 trackShift로 v2 mapping을 만듭니다. min/max로 gap을 coverage처럼 채우지 않습니다. unchanged direct/recording은 composition0과 실제 PCM spans/sourceOrigin을 사용하며 가짜 video duration을 만들지 않습니다. 양의 첫 오디오 지연을 0으로 당기지 않습니다.

Job과 CaptionOutputSession은 exact raw/mux artifact, mapping receipt·digest·result revision을 producer finally 이전부터 보존합니다. 출력 재시도는 같은 options/attempt/receipt의 완료된 인식·저장 결과를 재사용합니다. 실제 인식 실패·명시 options 변경과 출력만의 실패를 구별합니다. 불명확한 부작용·decoder open을 자동 재실행하지 않습니다.

녹화 폴더의 producer·caption·snapshot owner는 rawFile 할당 이전부터 분리합니다. source의 실제 종료 확인과 output retention owner 반환 전에는 workspace를 지우지 않습니다. caption 실패가 원본 producer를 abort하지 않습니다. 기존 취소 하나가 source read·owned recorder·native·번역·저장을 정지하며 source-lost 부분 저장과 구별합니다. snapshot은 부모 attempt/source를 reset하지 않습니다.


ACK/result/revision의 durable checkpoint는 앱이 unique sibling temp에 완전히 쓴 뒤 기존 generic move replace:true로 원자적으로 게시합니다. 게시·persisted 상태·이벤트가 같은 queue에서 직렬화되며 불명확한 응답은 exact generation/full-file signature로 대조합니다. 이전 승인 파일을 다음 분할 쓰기로 먼저 자르지 않습니다. pending checkpoint와 cleanup 소유권은 reset/reopen/expiry에도 보존합니다. 새 실행기가 foreign temp를 발견하면 accepted 상태의 읽기는 유지하고 새로운 mutation은 차단합니다. 이전 host의 종료 증명이 없는 경우 잠금이 남을 수 있으며, refresh·시간·추측으로 지우지 않습니다. 이것은 process/connection interruption 보존 계약이며 fsync·전원 손실 인수는 아닙니다.
## 근거와 검증 경계

원문·전후 소스와 독립 리뷰는 `.superpowers/sdd/concurrent-download-speech-captions/`에 보존합니다. `c-pyav-stream-design.md`, `c-live-pcm-integration.md`, `c-hls-aac-grid-decision.md`가 세부 규범이며 최종 public 정리 전 문서는 `c-public-docs-before-final/`에 보존했습니다. 초기 SDK-only progressive·자체 Opus remux·epoch-local 제안은 현재 계약으로 사용하지 않습니다.

정적 연결·패키지 해시는 실제 first-window-before-EOF, PTS/priming·44.1/48k sample 정확도, mux/cue 동기, Live wrap/discontinuity, 녹화 pause/loss, 장시간 자원, 취소·disconnect·retry·설치 동작의 인수 증거가 아닙니다. 그 검증은 전체 소스 gate 이후 별도 담당자가 수행합니다.


