const $=Id=>document.getElementById(Id);
let Saved={enabled:true,engine:'faster-whisper',model:'base',language:'auto',formats:['srt']}, Timer;
function Current(){return {enabled:$('enabled').checked,engine:$('engine').value,model:$('model').value,language:$('language').value,formats:[...document.querySelectorAll('.format-choices input:checked')].map(X=>X.name)};}
function Effective(){return $('override').value==='inherit'?Saved.enabled:$('override').value==='on';}
function Render(){
 const Mac=$('platform').value==='mac';$('engine').options[0].disabled=Mac;if(Mac)$('engine').value='whisper.cpp';
 $('engine-help').textContent=Mac?'macOS에서는 whisper.cpp를 사용합니다.':'Windows에서 두 엔진 중 선택할 수 있습니다.';
 const State=$('fixture').value;$('connection').textContent=State==='ready'?'연결됨 · 선택한 모델 사용 가능':State==='model'?'연결됨 · 선택한 모델 준비 필요':'연결되지 않음 · 보조 프로그램을 설치하고 연결해 주세요.';
 $('connection').classList.toggle('error',State!=='ready');$('prepare').disabled=State==='missing';
 $('effective').textContent=$('override').value==='inherit'?`기본값: ${Saved.enabled?'켜짐':'꺼짐'} · ${Effective()?'영상 저장 후 자막을 생성합니다.':'이번에는 자막을 생성하지 않습니다.'}`:Effective()?'기본값과 관계없이 이번 영상의 자막을 생성합니다.':'이번 영상의 자동 자막만 끕니다.';
 $('download-config').textContent=`${Mac?'whisper.cpp':Saved.engine} · ${Saved.model} · ${Saved.language==='auto'?'언어 자동 감지':Saved.language} · ${Saved.formats.join(' + ').toUpperCase()}`;
}
for(const Id of ['platform','fixture','override','engine'])$(Id).addEventListener('change',Render);
$('defaults').addEventListener('submit',E=>{E.preventDefault();const Next=Current();if(!Next.formats.length){$('saved').textContent='SRT 또는 VTT를 하나 이상 선택해 주세요.';return;}Saved=Next;$('saved').textContent='기본값을 적용했습니다. 기존 다운로드는 유지됩니다.';Render();});
$('guide').addEventListener('click',()=>{const Open=$('instructions').hidden;$('instructions').hidden=!Open;$('guide').setAttribute('aria-expanded',String(Open));});
$('check').addEventListener('click',Render);$('prepare').addEventListener('click',()=>{$('fixture').value='ready';Render();$('connection').textContent='프리뷰 · 모델 준비 완료 상태입니다. 실제 다운로드는 하지 않았습니다.';});
function Stop(){clearInterval(Timer);$('cancel').hidden=true;}
function Run(){Stop();$('retry').hidden=true;$('output').textContent='';$('progress').hidden=true;
 $('video-state').textContent='영상 · 다운로드 중';$('caption-state').textContent=Effective()?$('source').value==='split'?'자동 자막 · 다운로드 중 오디오 준비':'자동 자막 · 영상 저장 후 오디오 준비':'자동 자막 · 이번 작업에서 꺼짐';
 let Step=0;Timer=setInterval(()=>{Step++;if(Step===2){$('video-state').textContent='영상 · 저장 완료';if(!Effective()){Stop();return;}if($('fixture').value!=='ready'){Failure();return;}$('caption-state').textContent='자동 자막 · 음성 인식 중';$('progress').hidden=false;$('cancel').hidden=false;}
 if(Step>=2){$('progress').value=Math.min(100,(Step-2)*20);if(Step===7){Stop();$('caption-state').textContent='자동 자막 · 생성 완료';$('output').textContent=Saved.formats.map(F=>'여름 여행.generated.'+F).join(' / ');}}},700);
}
function Failure(){Stop();$('video-state').textContent='영상 · 저장 완료';$('caption-state').textContent=$('fixture').value==='missing'?'자동 자막 · 보조 프로그램 연결 필요':$('fixture').value==='model'?'자동 자막 · 모델 준비 필요':'자동 자막 · 생성 실패 · 영상은 저장되었습니다.';$('progress').hidden=true;$('retry').hidden=false;$('output').textContent='준비 상태를 확인한 후 자막만 다시 시도할 수 있습니다.';}
$('download').addEventListener('submit',E=>{E.preventDefault();Run();});$('fail').addEventListener('click',Failure);$('retry').addEventListener('click',Run);$('cancel').addEventListener('click',()=>{Stop();$('caption-state').textContent='자동 자막 · 취소됨 · 영상은 저장되었습니다.';$('retry').hidden=false;$('progress').hidden=true;});Render();
