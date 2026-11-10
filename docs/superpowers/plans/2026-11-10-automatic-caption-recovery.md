> **CANCELED AND REVERTED — 2026-11-10:** 사용자 지시로 자동 복구와 macOS 작업을 취소했습니다. 제품 소스 9개를 자동 복구 전 보관본으로 복원하고 추가 42개를 제거했습니다. 아래 내용은 과거 기록이며 실행 지시가 아닙니다. 재개하지 마십시오. 앱 재시작은 기존 작업 취소 기준입니다.

# 병행 자막 자동 복구 구현 계획

> For agentic workers: superpowers:subagent-driven-development와 requesting-code-review 적용. 단일 source writer, 독립 read-only gate. 사용자 실행 제한이 스킬의 테스트·commit·worktree 기본 절차보다 우선합니다.

**Goal:** 도우미 연결 유실·새 executor·보존된 원본이 있는 offscreen 재시작 뒤, 이전 실행의 실제 종료를 입증하고 소유 파일·accepted 상태·인식 결과·출력 receipt를 정산하여 실제 작업을 재개합니다. 잠금 유지·안전 중단만으로 완료하지 않습니다.

**Architecture:** 확장의 영속 journal/coordinator와 source inventory가 판단·재개를 소유합니다. native는 범용 resource epoch/lifetime, owned object/operation facts, explicitly controlled file-read ticket만 제공합니다. accepted checkpoint는 immutable native object+IDB accepted pointer이며, 기존 extension-state.json은 compatibility export입니다.

**Spec:** `.superpowers/sdd/concurrent-download-speech-captions/recovery-design-proposal.md`와 round1/round2/round3 addendum. 충돌 시 뒤의 좁은 보완 계약 우선. 사전 gate `recovery-design-round3-review.md`가 통과해야 제품 수정 시작.

## Global Constraints

- 같은 E:/Project/MDownloader / codex/youtube-distribution-probe / HEAD47d6fc9dbb58fce4f2f032c80080c8fc11c756cb와 기존 dirty source 보존. branch/worktree 이동·reset/clean/stash/commit/deploy/reload/install 없음.
- tests/testfiles, syntax/compile/lint/import/product/browser/native probe, 설치·의존성/미디어/모델 다운로드·ASR/번역/API·제품 실행 금지. source/data/diff/hash만 허용. 공식 문서/소스 정적 열람은 제품 실행이 아님.
- 도우미는 명령 실행만. recovery/JSON 의미/모델·언어·옵션/병합/선택/파일명/재시도/보존 정책은 JS. native에는 OS·파일·소유권·계산·실제 종료 사실만 둠.
- native feature variable manifest는 native 안전성/개별 실행/설치 소스와 관련 metadata만. app JS 복사·실행 금지. common Windows9.1/macOS9 body/version/protocol1 변경 금지.
- feature package6 / executionProtocol3 / resourceRecoveryVersion1 / ownedFileVersion1 / readTicketVersion1 / sourceMirrorVersion1. 실제 source구현이 해당 계약을 연결한 후에만 app capability를 광고.
- 같은 accepted ASR/attempt/resultRevision/mapping/output receipt를 보존. 불명확 부작용을 무조건 재실행하거나 타이머/refresh로 잠금을 해제하지 않음. 실제 proof 뒤에만 정산·재개.
- 현재 지원 Windows/macOS FFmpeg/CLI/binding 경로를 복구 미지원으로 제외하지 않음. 원본 실행 파일·모델·설정·사용자 파일·다른 jobs/origins 보존. derived safety copies는 원본 provenance/hash와 구분.

## Review Focus

- host와 supervisor가 동시에 사라지고 자식이 늦게 시작해도 실제 zero-writer 이전 새 epoch 금지.
- callback/receipt 전후 모든 crash 지점에서 old/new accepted 상태와 completed ASR를 정확히 재사용.
- ID 저장 전 늦게 생성된 browser download는 headers-only ticket 취소로 positive body 완료 불가.
- 살아 있는 offscreen과 새 coordinator가 같은 continuation을 중복 실행하지 않음; 취소 revision 우선.
- OPFS pins·partial native mirrors·ACK cleanup·expiry가 소유권을 건너뛰지 않음.

## Task 1 — Native 개별 실행 안전성·소유 파일·티켓

Files: native/captions의 generic resource/object/operation/ticket modules, safety Windows PowerShell/C#·Python entry, macOS C launcher/dylib/signal/spawn-shadow·Mach-O preparation/build source; host.py/engine.py/AV/CPP worker/feature bootstrap/install/requirements/metadata. common/vendor/tests는 read-only.

Consumes: 검토 승인된 네 addendum의 정확한 OS admission/lock/ownership/stdio/manifest 계약.
Produces: resourceAcquire/Observe/Stop/Release; ownedCreate/Inspect/Write/Seal/Move/Remove; operationInspect/Settle/Acknowledge; readTicketOpen/Authorize/Inspect/Revoke. mutation은 immutable operationId/requestSha256/current connection-bound epoch. control stop/revoke는 data lease 뒤에서 대기하지 않음.

- [ ] CURRENT touched-source baseline을 recovery-native-baseline/에 복사.
- [ ] 실제 catalog·epoch·lock과 short/partial write/unknown operation 정산을 구현. app checkpoint 해석 없음.
- [ ] Windows pre-start Job Object와 실제 zero-process close, binary stdio bootstrap을 구현.
- [ ] macOS dependency-first lifetime guard, early safe primitive, fork signal observer, spawn shadow와 source build/private-copy provenance를 구현. 미제공 upstream patch나 unsupported fallback 없음.
- [ ] feature bootstrap이 common setup stage에서 live 변경 전에 package safety를 확보하도록 연결. mutable imports 이전 보호, model ancestor leases와 source/generation 확인.
- [ ] headers-only explicit file ticket의 authorize/revoke/tombstone/actual stream close를 구현.
- [ ] source-only self-review, 실제 path/fields/version·미검증 보고, final snapshot/diff/path JSON과 ownership 반환.
- [ ] 독립 native source/spec/helper gate와 실제 지적 수정·scoped re-review.

## Task 2 — 확장 영속 journal·checkpoint·trusted execution 연결

Files: caption-checkpoint-store.js / caption-recovery.js 기반과 bounded digest/source inventory helpers; caption-execution.js, local-captions-native/service 및 runtime contracts. native/common 수정은 Task1 소유권 반환 뒤 별도 좁은 승인으로만.

Consumes: Task1의 최종 실제 API/report. Produces: job Web Lock+IDB generation CAS, prepared→accepted→continued intent, immutable checkpoint authority, exact quiescence/owned cleanup/reopen와 old offscreen handoff.

- [ ] CURRENT baseline 복사, typed API/기존 stage caller 대조.
- [ ] candidate bytes와 previous object identity/continuation을 IDB commit 뒤에 native mutation. lost create/chunk/accept/cleanup을 실제 facts로 정산.
- [ ] State/Job/status/result read/prune/reset 전체를 새 authority에 연결, 기존 legacy import와 service restart를 보존.
- [ ] transport loss를 user cancel과 분리, proof 기반 resource takeover와 stale control revision 차단.
- [ ] 실제 Source/session/decoder ownership을 proof 이후에만 이전. unknown close를 DecoderMissing으로 성공 처리하지 않음.
- [ ] 독립 source gate와 수정·재리뷰. caller가 아직 연결되지 않은 경로를 완료로 광고하지 않음.

## Task 3 — Source·merger·ACK·출력의 실제 자동 continuation

Files: concurrent runner/merger/window/PCM sources, output-session/pipeline, stream-workspaces 및 producer stores, hls-runner.js, jobs.js, browser-download.js, service startup/reconnect/retry, caption-output-transfer.js와 status text.

Consumes: Task2 journal/recovery authority와 Task1 generic facts. Produces: 기존 producer·source·output flow가 실제 resume되는 call chain.

- [ ] source create/seal/pin/adopt/collect inventory를 모든 해당 namespace에 연결. Root의 무조건 폴더 삭제 제거, collecting intent와 adoption race 정산.
- [ ] source-window/hypothesis/page/merge-event/ACK cleanup/final-mapping/output payload를 정확한 hash/ordinal/attempt/revision으로 저장. merger replay는 native ACK/ASR side effect 없이 복원.
- [ ] accepted 가설·최종 결과는 재인식하지 않음. conclusively unfinished만 exact retained input/옵션으로 새 연산 결정. ACK 후 정리 의무를 phase만으로 반환하지 않음.
- [ ] native transport-only/background-only/fresh-offscreen retained-raw 복원과 attach/pause/continue를 actual service recover·captionPipelineResume·SaveMediaFile에 연결. source가 실제로 없는 미래 바이트는 지어내지 않고 captured prefix/accepted 결과와 구분.
- [ ] 정확한 finalFile의 bounded streaming SHA→durable native mirror→seal→ticket→trusted saveOwnedArtifact→durable exact browserID→authorize를 구현. picked-folder와 sidecars도 durable identity/receipt 유지.
- [ ] created/filename/startup listener가 같은 outputIntent를 정산. late unknown-ID ticket은 zero-body revoke 뒤 새 dispatch. no-match search를 fence로 사용하지 않음.
- [ ] cancel/control revision·retry/expiry·resource contention·다른 job 보존·번역의 모호한 외부요청 미재실행을 연결.
- [ ] 구현자 self-review와 독립 전체 app-call-path gate, 지적 수정·재리뷰.

## Task 4 — 전체 독립 리뷰·source bundle·문서 인계

- [ ] 가장 높은 판단 역량의 새 reviewer가 native↔app↔producer↔source↔browser/파일 output 전체 변경을 source-only 독립 검토.
- [ ] 실제 발견을 한 수정 wave로 수정하고 scoped 재리뷰. 안전 중단을 자동 복구 완료로 바꾸지 않음.
- [ ] 허용된 source-package 데이터 generator로 package6/native manifest·별도 extension metadata만 생성. source/payload/bundle SHA/bytes/한도 확인; compiled artifact·설치·runtime 증거와 구분.
- [ ] 원본/파생 실행 파일·컴파일/서명 metadata와 설치 갱신 대상을 명확히 기록. 여기서 compiler·설치·모델·ASR/browser 사용 안 함.
- [ ] public 계약/계획/최종 source report와 후속 검증 handoff를 갱신. active sourcewriter 없음과 exact source paths/SHA/capabilities/실행 미검증 기록.

## 현재 상태

설계 round3 scoped gate 뒤 generic Task1A 소스 인계와11개 해시 대조를 마쳤고, 현재 Mac provider/guard 단일 writer가 구현 중입니다. Windows/provider/세대 설치를 순차 구현한 뒤 Task1 전체 독립 source gate를 진행합니다. 확장 Task2/Task3는 준비 문서만 있으며 소스 소유권을 아직 넘기지 않았습니다. 이전 whole-C source 승인과 이번 자동 복구 요청 완료는 구별합니다.


## 구현 중 확인된 좁은 계약 교정

- W0: recovery-native-os-audit.md 및 recovery-native-w0-debug-admission-addendum.md(W0-D 포함). 이름이 없어진 Job을 실제0으로 해석하지 않습니다. DEBUG_PROCESS의 실행 전 영속 참여 기록, 정확한 admitted PID 종료와 writerQuiescent를 전체 kernelprocess closed/0과 분리합니다. 실행기에 노출되지 않은 host-only 소유 데이터는 명시된 identity/hash/노출/retirement 검증 후 같은 물리 파일을 재개할 수 있어 대형 mirror 복사로 디스크 한도를 넘기지 않습니다.
- M2: recovery-native-macos-observer-feasibility.md는 round3 R2-A.2의 SIGALRM/타이머 multiplexer만 raw Mach observer로 교체합니다. prefork 저장소·신호 mask 차단, SDK별 raw RPC/ABI, TLS·heap·pthread 없는 bootstrap/관찰, 실제 종료 증명은 해당 사전 검토 계약을 따릅니다. 앱의 신호·타이머 API를 변경하지 않습니다.
- 요청 무결성: recovery-request-canonical-ruling.md. Python/JS 숫자 직렬화 차이를 피하도록 정확한 requestCanonical 바이트와 실제 명령의 엄격한 일치를 검증합니다. 영속 metadata에 payload 원본을 중복 저장하지 않습니다.

위 교정은 변경 전 검토/근거에 따른 구현 계약이며 실제 소스 독립 승인·빌드·설치·런타임 증거가 아닙니다. 해당 구현과 caller 전체를 최종 native/app source gate에서 검토합니다.
