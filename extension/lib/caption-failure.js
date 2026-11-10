/** Product error descriptions and bounded diagnostics belong to the extension. */
export const CaptionFailureCode=Value=>typeof Value==='string'&&/^(?:caption|stream)_[a-z_]{1,80}$/.test(Value)?Value:null;
const Operations=new Set(['import','open','select-audio','demux','decode','resample','flush']);
export function CaptionFailureDetails(Value){
 const Result={};if(!Value||typeof Value!=='object')return Result;
 if(Operations.has(Value.operation))Result.operation=Value.operation;
 if(typeof Value.exceptionType==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(Value.exceptionType))Result.exceptionType=Value.exceptionType;
 for(const Key of ['errno','sequence','pts','timeBaseNum','timeBaseDen','samples','startSample','endSample','previousEndSample'])if(Number.isSafeInteger(Value[Key]))Result[Key]=Value[Key];
 return Result;
}
export function CaptionDecoderError(Event){
 const Failure=Error(CaptionFailureCode(Event.error)||'caption_av_decode_failed');Failure.captionDetails=CaptionFailureDetails(Event);return Failure;
}
export function MergeCaptionStatus(Previous={},Fields={}){
 const Next={...Previous,...Fields},Code=CaptionFailureCode(Fields.error);
 if(Code){
  const Same=Previous.lastFailure?.code===Code&&Previous.lastFailure?.attempt===Next.attempt;
  const Details=CaptionFailureDetails(Fields.errorDetails??(Same?Previous.lastFailure.details:undefined));
  Next.errorDetails=Details;
  Next.lastFailure={code:Code,attempt:Next.attempt??null,at:Same?Previous.lastFailure.at:Date.now(),phase:Previous.phase||'waiting',details:Details};
 }
 return Next;
}
const Decode=['오디오 디코딩 실패','Audio decoding failed'],Prepare=['오디오 준비 실패','Audio preparation failed'],Recognize=['음성 인식 실패','Speech recognition failed'],Save=['자막 저장 실패','Caption save failed'],Input=['음성 입력 처리 실패','Audio input failed'];
const Catalog={
 caption_av_decode_failed:[Decode,['녹화 데이터의 오디오를 디코딩하지 못했습니다.','Could not decode audio from the recording.']],
 caption_audio_stream_missing:[Decode,['입력 파일에 선택한 오디오 스트림이 없습니다.','The selected audio stream is missing from the input.']],
 caption_no_audio:[Input,['인식할 오디오가 없습니다.','There is no audio to recognize.']],
 caption_input_format_changed:[Decode,['처리 중 오디오 형식·채널 또는 샘플레이트가 변경됐습니다.','The audio format, channels or sample rate changed during decoding.']],
 caption_window_clock:[Input,['음성 구간의 시간 정보가 겹치거나 유효하지 않습니다.','Audio segment timestamps overlap or are invalid.']],
 stream_capture_clock_overlap:[Input,['수신한 오디오 구간의 시간이 겹칩니다.','Received audio segment timestamps overlap.']],
 caption_window_guard:[Input,['실제 오디오가 인식 구간에 필요한 범위를 채우지 못했습니다.','Decoded audio does not cover the required recognition window.']],
 caption_seam_unresolved:[Input,['인접한 음성 인식 구간의 결과를 연결하지 못했습니다.','Could not reconcile adjacent recognition windows.']],
 caption_source_missing:[Input,['원본 파일 또는 임시 음성 입력을 찾지 못했습니다.','The original file or temporary audio input is missing.']],
 caption_source_short_read:[Input,['요청한 범위의 오디오 입력을 전부 읽지 못했습니다.','Could not read the requested input byte range in full.']],
 caption_source_range:[Input,['디코더가 요청한 입력 범위가 제공된 데이터와 다릅니다.','The requested input range does not match the supplied data.']],
 caption_worker_protocol:[['처리 응답 검증 실패','Processing response validation failed'],['처리 구성요소의 응답 순서 또는 형식이 올바르지 않습니다.','A processing component returned an invalid response order or format.']],
 caption_inference_result:[Recognize,['인식 엔진이 올바르지 않은 결과 형식을 반환했습니다.','The recognition engine returned an invalid result format.']],
 caption_result_timestamp:[Recognize,['인식 결과의 시간이 입력 오디오 범위를 벗어나거나 역순입니다.','Recognition timestamps fall outside the input audio or are reversed.']],
 caption_alignment_missing:[Recognize,['인식 결과에 필요한 단어별 시간 정보를 확보하지 못했습니다.','Required word timing could not be obtained for the recognition result.']],
 caption_alignment_unsupported:[Recognize,['설치된 인식 엔진이 단어별 시간 정보를 지원하지 않습니다.','The installed engine does not support word timing.']],
 caption_worker_exited:[Decode,['오디오 디코더 프로세스가 처리 중 종료됐습니다.','The audio decoder process exited during processing.']],
 caption_decode_failed:[Decode,['오디오 변환 작업을 완료하지 못했습니다.','The audio conversion could not be completed.']],
 caption_resample_output_limit:[Decode,['오디오 시간 보정에 필요한 출력이 안전한 처리 한도를 초과했습니다.','Timestamp resampling exceeded the safe output budget.']],
 caption_prepare_failed:[Prepare,['인식용 오디오 입력을 준비하지 못했습니다.','Could not prepare audio input for recognition.']],
 caption_recognition_failed:[Recognize,['선택한 모델이 음성 인식을 완료하지 못했습니다.','The selected model could not finish speech recognition.']],
 caption_engine_options_unsupported:[Recognize,['설치된 엔진이 선택한 인식 옵션을 지원하지 않습니다.','The installed engine does not support the selected recognition options.']],
 caption_model_missing:[Recognize,['선택한 음성 인식 모델이 설치되어 있지 않습니다.','The selected speech recognition model is not installed.']],
 caption_engine_missing:[Recognize,['선택한 음성 인식 엔진이 설치되어 있지 않습니다.','The selected speech recognition engine is not installed.']],
 caption_helper_missing:[Prepare,['음성 인식 도우미에 연결할 수 없습니다.','The speech recognition helper connection is unavailable.']],
 caption_helper_update_required:[Prepare,['설치된 음성 인식 기능 패키지가 이 작업을 지원하지 않습니다.','The installed speech feature package does not support this operation.']],
 caption_concurrency_unsupported:[Prepare,['설치된 음성 인식 기능이 다운로드 중 인식을 지원하지 않습니다.','The installed speech feature does not support recognition during download.']],
 caption_converter_missing:[Prepare,['오디오 변환 도구를 찾지 못했습니다.','The audio conversion tool is missing.']],
 caption_disk_full:[Save,['음성 자막 처리에 필요한 임시 저장 공간이 부족합니다.','There is insufficient temporary disk space for captions.']],
 caption_output_failed:[Save,['선택한 최종 자막 출력을 만들지 못했습니다.','Could not create the selected final caption output.']],
 caption_save_failed:[Save,['생성된 자막 파일을 저장하지 못했습니다.','Could not save the generated caption files.']],
 caption_output_exists:[Save,['같은 이름의 출력 파일이 이미 있습니다.','An output file with the same name already exists.']],
 caption_translation_failed:[['음성 자막 번역 실패','Speech caption translation failed'],['생성한 음성 자막의 번역을 완료하지 못했습니다.','Could not finish translating the generated speech captions.']],
 caption_interrupted:[Recognize,['음성 인식 실행이 중단됐습니다.','Speech recognition execution was interrupted.']],
};
export function CaptionFailurePresentation(Value,Details){
 const Code=CaptionFailureCode(Value)||'caption_unknown_failure';
 let [Label,Reason]=Catalog[Code]||[['음성 자막 처리 실패','Speech caption processing failed'],['아래 오류 코드에 해당하는 작업이 실패했습니다.','The operation identified by the error code below failed.']];
 if(Code==='caption_av_decode_failed'&&Details?.exceptionType==='AttributeError')Reason=['오디오 디코더의 라이브러리 호환성 오류가 발생했습니다.','The audio decoder encountered a library compatibility error.'];
 if(Details?.exceptionType==='MemoryError')Reason=['음성 자막 처리 중 메모리 할당에 실패했습니다.','Memory allocation failed during speech caption processing.'];
 return {code:Code,label:Label,reason:Reason};
}
