export const CaptionPresetKey='localCaptionPresets';
export const CaptionEngineFields=Object.freeze({
 cpuThreads:{type:'number',min:1,max:32,step:1,default:8,ko:'CPU 스레드 수',en:'CPU threads'},
 beamSize:{type:'number',min:1,max:10,step:1,default:5,ko:'탐색 수 (Beam size)',en:'Beam size'},
 bestOf:{type:'number',min:1,max:10,step:1,default:5,ko:'후보 수 (Best of)',en:'Best of'},
 temperature:{type:'number',min:0,max:1,step:0.1,default:0,ko:'온도',en:'Temperature'},
 conditionOnPreviousText:{type:'boolean',default:false,ko:'같은 오디오 구간의 이전 문장 참고',en:'Use previous text within each audio chunk'},
 device:{type:'select',values:['cpu','cuda','auto'],default:'cpu',engines:['faster-whisper'],ko:'처리 장치',en:'Device'},
 computeType:{type:'select',values:['int8','float32','float16','int8_float16','auto','default'],default:'int8',engines:['faster-whisper'],ko:'연산 정밀도',en:'Compute type'},
 vadFilter:{type:'boolean',default:true,engines:['faster-whisper'],ko:'음성 구간 감지 (vad_filter)',en:'Voice activity detection (vad_filter)'},
 useGpu:{type:'boolean',default:true,engines:['whisper.cpp'],ko:'GPU 가속 사용',en:'Use GPU acceleration'}
});
export function EngineOptionFields(Engine){return Object.entries(CaptionEngineFields).filter(([,Field])=>!Field.engines||Field.engines.includes(Engine)).map(([Id,Field])=>[Id,{...Field,max:Engine==='whisper.cpp'&&['beamSize','bestOf'].includes(Id)?8:Field.max}]);}
export function NormalizeRecognitionOptions(Value={},Engine='faster-whisper',{strict=false}={}){
 if(!Value||typeof Value!=='object'||Array.isArray(Value)){if(strict)throw Error('caption_invalid');Value={};}
 const Result={};
 for(const [Id,Field]of EngineOptionFields(Engine)){
  let Next=Value[Id]??Field.default;
  const Valid=Field.type==='boolean'?typeof Next==='boolean':Field.type==='select'?Field.values.includes(Next):typeof Next==='number'&&Number.isFinite(Next)&&Next>=Field.min&&Next<=Field.max&&(Field.step!==1||Number.isInteger(Next));
  if(!Valid){if(strict)throw Error('caption_invalid');Next=Field.default;}Result[Id]=Next;
 }
 if(Engine==='faster-whisper'&&Result.device==='cpu'&&['float16','int8_float16'].includes(Result.computeType)){if(strict)throw Error('caption_cpu_precision_invalid');Result.computeType='int8';}
 return Result;
}
export function BuiltinCaptionPresets(Engine){return [
 {id:'fast',ko:'빠르게',en:'Fast',recognition:{beamSize:1,bestOf:1}},
 {id:'balanced',ko:'균형',en:'Balanced',recognition:{}},
 {id:'accuracy',ko:'정확도 우선',en:'Accuracy',recognition:{beamSize:8,bestOf:5,conditionOnPreviousText:true,...(Engine==='faster-whisper'?{computeType:'float32'}:{})}}
 ].map(P=>({...P,engine:Engine,recognition:NormalizeRecognitionOptions(P.recognition,Engine)}));}
export function NormalizeCustomCaptionPresets(Value){
 if(!Array.isArray(Value))return [];
 return Value.slice(0,100).flatMap(P=>{
  if(!P||typeof P.id!=='string'||!/^custom-[a-f\d-]{36}$/i.test(P.id)||typeof P.name!=='string'||!P.name.trim()||P.name.length>60||!['faster-whisper','whisper.cpp'].includes(P.engine))return [];
  try{return [{id:P.id,name:P.name.trim(),engine:P.engine,recognition:NormalizeRecognitionOptions(P.recognition,P.engine,{strict:true})}];}catch{return [];}
 });
}
