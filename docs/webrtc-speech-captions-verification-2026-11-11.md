# WebRTC 음성 자막 실패 수정과 검증 — 2026-11-11

> 이 문서는 패키지 9 검증 당시의 기록이다. 후속 사용자 지시에 따른 겹침 자동 보정·경고 처리, 패키지 10, 재처리 없는 86.36초/4구간 저장 검증은 [자막 시간 보정 검증](caption-timing-warning-verification-2026-11-11.md)에 기록했다. 아래의 구간 병합 실패 한계는 후속 수정 전 상태다.

## 요청과 실제 원인

사용자는 WebRTC 녹화에서 음성 자막이 실패하며 화면에 ‘처리 또는 저장 실패’만 표시되는 문제를 보고했다. 최초 재현 페이지는 `https://ko.stripchat.com/StarGirlGroup`이며, 최종 검증 대상은 사용자의 후속 지시에 따라 `https://ko.stripchat.com/Dolls_primium1`로 변경했다. 실제 로그인 브라우저의 공개 재생 입력과 설치된 인식 엔진으로 확인했다. 인증 토큰/쿠키/원문 응답은 진단 결과에 기록하지 않았다.

실패 원인은 두 단계로 확인했다.

1. **첫 오디오 디코딩 전 PyAV 호환성 오류.** 최초 실제 작업에서 약 5.229초에 `caption_av_decode_failed`가 발생했다. 같은 VP8+Opus WebM 바이트를 설치된 worker의 `decode()`에 전달하자 `other.discard='all'`에서 `AttributeError`가 재현됐다. 설치/요구 버전은 PyAV 15.1.0이며 이 속성을 지원하지 않는다. 이미 `container.demux(selected_audio_stream)`으로 오디오만 선택하므로 불필요한 discard 호출을 제거했다. 재현 테스트는 실제 PyAV로 비디오+Opus 다중 스트림을 생성하여 수정 전 실패와 수정 후 PCM/flush 결과를 확인한다.
2. **MediaRecorder의 오디오 PTS jitter.** 위 호환성 오류를 고친 설치본의 다음 실행은 `caption_window_clock`으로 실패했다. 실제 Opus 입력 PTS는 44 → 105 → 164ms였고 각 입력은 2880 samples @48kHz였다. 기본 resampler 출력은 start/end 704/1648, 1664/2624, 2608/3568 samples @16kHz여서 1ms 간격과 겹침이 번갈아 나타났다. 100개 출력 프레임 중 24개 경계가 달랐다. 이 경로를 기존 TS/AAC의 한 샘플 정밀도 예외로 처리하거나, JS에서 PTS/샘플 수를 덮어쓰지 않았다.

## 처리 변경과 책임 경계

확장의 녹화 어댑터가 `resample: {async: 1}`을 명시적으로 요청한다. 네이티브는 이 검증된 숫자 옵션으로 FFmpeg `aresample` 및 mono/s16 변환을 실행하고, 실제 출력의 PTS/time base/샘플 수를 반환한다. 초기 시간을 0으로 강제하는 `first_pts`는 지정하지 않았다. `async`는 실제 fill/trim DSP이며 원시 타임스탬프 검사 허용오차가 아니다. 원본 녹화 바이트는 변경하지 않는다.

- 앱: 녹화 출처에 대한 변환 옵션 선택, decoder identity, capability 확인, 구간 인식·병합, 실패 분류, 최종 AV 재처리 여부, 출력 이름과 완료 판단.
- 네이티브: 지정된 단일 decode/resample 계산, 옵션/경로/자원 검증, bounded output, 취소와 실제 프로세스 종료.
- 기본 옵션 `async: 0` 또는 옵션 없는 입력은 기존 `AudioResampler` 경로를 유지한다.
- decoder 재사용 식별자에 정규화한 변환 옵션을 포함한다. 미지원 설치본이 옵션을 조용히 무시하지 않도록 `avDecodeStreamVersion >= 2`를 확인한다.
- 큰 입력 PTS 점프를 큐 예산에 대응하는 계산 한도로 제한하고, graph pull마다 취소·프레임 수·개별/누적 PCM 바이트를 검사한다. 기존 ACK/backpressure와 close 확인도 유지한다.

PyAV, 모델, 공통 도우미 본체는 변경하지 않았다. 기능 패키지를 9로 갱신하고 번들을 다시 만들었다. 기존 설치기의 `--skip-dependencies --no-register`로 기능 소스를 반영하여 의존성 설치/모델 다운로드/브라우저 등록 변경을 하지 않았다. 설치 후 핵심 파일과 번들 SHA256 일치를 확인했다. 패키지 잠금을 유지했으며 활성 작업이 없는 것을 확인한 시점에만 확장 실행 코드를 다시 불러왔다.

## 실패 표시와 기록

`extension/lib/caption-failure.js`가 안전한 오류 코드, 단계별 지역화 설명, 제한된 진단 사실과 `lastFailure` 병합을 담당한다. 디코더가 반환하는 현재 계산 단계·exception class·errno와 필요한 수치 사실만 허용한다. 원시 예외 문구·스택·주소·경로·PCM은 화면이나 이 진단 레코드에 전달하지 않는다.

예:

- `caption_av_decode_failed`: **오디오 디코딩 실패 · 녹화 데이터의 오디오를 디코딩하지 못했습니다.** `AttributeError` 사실이 있으면 라이브러리 호환성 오류로 설명한다.
- `caption_window_clock`: **음성 입력 처리 실패 · 음성 구간의 시간 정보가 겹치거나 유효하지 않습니다.**
- `caption_seam_unresolved`: **음성 입력 처리 실패 · 인접한 음성 인식 구간의 결과를 연결하지 못했습니다.**

알려진 오류와 미등록된 안전 오류 코드 모두 화면에 `[오류 코드]`를 표시한다. 취소 이벤트가 현재 error를 null로 바꿔도 이전 실패 레코드를 보존한다. UI는 같은 attempt의 취소 전 실패를 별도로 표시하고, 새 attempt의 정상 인식 화면에 이전 오류를 섞지 않는다. 도우미 단절과 출력 만료의 실패 기록도 같은 병합 경로를 사용한다.

설치된 확장 컴포넌트에 검사 상태를 전달해 표시한 캡처: `artifacts/webrtc-caption-20261111/error-message.png`. 이는 오류 메시지 시각 검사이며 실제 작업 화면을 재연한 영상은 아니다.

## Dolls_primium1 실제 결과

사용자의 현재 기본값을 읽어 작업별로 지정했다. Windows/faster-whisper/tiny/언어 auto, CPU 8, int8, beam/best-of 5, VAD 사용이며 최종 영상 내 자막을 선택했다. 사용자 기본값은 저장하거나 변경하지 않았다.

| 실행 | 실제 결과 | 저장 파일 확인 |
| --- | --- | --- |
| 약 19.138초 구간 | `state=complete`, 자막 `phase=complete`, `mode=windowed`, 오류/재처리 전환 없음 | 14,487,646 bytes MP4, VP8 영상·Opus 음성·mov_text 자막, 자막 2패킷 |
| 약 46.907초 구간 | 다운로드 중 약 40.429초 모델 로딩, 41.234초 음성 인식 시작. 이후 구간 병합에서 `caption_seam_unresolved`가 발생해 기존 확장 정책으로 완성 AV를 자동 재처리하고 최종 완료 | 35,615,463 bytes MP4, VP8 영상·Opus 음성·mov_text 자막, 자막 9패킷 |

두 실행 모두 ‘중지 후 저장’ 경로로 실제 Chrome 다운로드 완료와 파일 존재/크기/트랙 및 비어 있지 않은 자막 패킷을 확인했다. 실제 경로와 단계 기록은 다음에 있다.

- `artifacts/webrtc-caption-20261111/dolls-short-output.json`
- `artifacts/webrtc-caption-20261111/dolls-short-media-check.json`
- `artifacts/webrtc-caption-20261111/dolls-final-output.json`
- `artifacts/webrtc-caption-20261111/dolls-media-check.json`

앞선 페이지에서도 약 23.58초 구간은 windowed로 완료했다. 약 82.695초 실행은 seam 실패 뒤 최종 AV 재처리로 완료했고, 22,667,536 bytes MP4와 자막 8패킷을 확인했다. 이 결과는 추가 증거이며 사용자가 지정한 Dolls_primium1 검증을 대신하지 않는다.

## 자동 검사와 독립 리뷰

- 자막 출력·UI 단계·세션·경계·복구 및 기능 패키지 검증 **JavaScript 50개 통과**.
- 서비스의 decoder 오류 보존/단절 후 취소 보존을 대상으로 한 **JavaScript 2개 통과**. 오래된 다른 서비스 fixture까지 전체 통과한 결과는 아니다.
- 실제 pinned PyAV의 다중 스트림 decode, 안전 오류 사실, timestamp jitter/양의 실제 gap/음의 실제 jump/초기 offset, 자원 한도와 취소 **Python 5개 통과**.
- 기존 네이티브 개별 명령 실행기 검사 **Python 23개 통과**.
- 변경 파일의 공백/JS 구문 검사 통과. 홈페이지 프리뷰를 현재 소스로 다시 생성했다(63개 소스 파일).
- 변경 전 리뷰와 수정 후 독립 읽기 전용 리뷰를 수행했다. native의 명령 실행 전용 경계, 옵션 identity, 제한된 출력 수집, 실패 기록 우회 지적을 반영했다. 독립 리뷰는 번들 9의 11개 payload 해시와 소스 일치도 확인했다. 실제 사이트 실행은 본 작업의 별도 증거다.

전체 저장소 검사 통과를 주장하지 않는다. 확대 서비스 검사에는 기존 fixture의 session storage 부재와 대기 문제가 있어 새 회귀 두 건을 분리해 실행했다. 원래 테스트를 삭제하거나 통과하도록 제품 동작을 바꾸지 않았다.

## 검증 한계

긴 실행에서 구간 인식 결과 병합이 항상 성공하는 것은 아니다. 이번 46.9초 사례는 `caption_seam_unresolved` 뒤 자동 최종 AV 처리로 완성됐다. 이 경우를 끝까지 병행 인식만으로 완성됐다고 보고하지 않는다. 모델의 전사 정확도, 장시간 방송, 모든 사이트/포맷, macOS, 재시작 뒤 기존 녹화 복구는 이 검증 범위가 아니다. 원격 배포/게시도 수행하지 않았다.
