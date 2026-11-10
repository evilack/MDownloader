/** Closed descriptor prefixes selected in the SAME mapped capture seconds that
 * final mux copies. Bounds come from actual public SDK packets, never EXTINF or
 * an assumption that the first media PTS equals presentationTimeOffset. */
export function SelectCapturedSnapshot(Tracks,Files,Bounds,AudioShift){
 if(!Number.isFinite(AudioShift))throw Error('stream_capture_shift');
 // Only binary64 arithmetic noise at an equal boundary is tolerated. This is
 // not a sample/frame tolerance and cannot bridge a real missing audio span.
 const After=(A,B)=>A-B>Number.EPSILON*Math.max(1,Math.abs(A),Math.abs(B))*4;
 const Ready=Tracks.map(T=>{
  const Prefix=[];for(const D of T.descriptors){
   if(!Files.has(D.path)||D.initPath&&!Files.has(D.initPath)||!Bounds.has(D.id))break;
   Prefix.push(D);
  }return Prefix;
 });
 if(Ready.some(P=>!P.length))return null;
 if(Ready[1]){
  const AudioEnd=Ready[1].reduce((End,D)=>Math.max(End,Bounds.get(D.id).end+AudioShift),-Infinity);
  const Video=[];let VideoEnd=-Infinity;
  for(const D of Ready[0]){const End=Bounds.get(D.id).end;if(After(End,AudioEnd))break;Video.push(D);VideoEnd=Math.max(VideoEnd,End);}
  if(!Video.length)return null;
  const Audio=[];for(const D of Ready[1]){if(!After(VideoEnd,Bounds.get(D.id).start+AudioShift))break;Audio.push(D);}
  if(!Audio.length)return null;Ready[0]=Video;Ready[1]=Audio;
 }
 const Paths=new Set(Ready.flat().flatMap(D=>[D.path,D.initPath].filter(Boolean))),Count=Ready.reduce((N,P)=>N+P.length,0);
 const Selected=Object.freeze(Object.fromEntries(Tracks.map((T,I)=>[T.id,Object.freeze(Ready[I].map(D=>D.id))])));
 return Object.freeze({video:Object.freeze([...Ready[0]]),audio:Ready[1]&&Object.freeze([...Ready[1]]),audioShift:AudioShift,
  selectedByTrack:Selected,selectionClock:'mapped-capture-plus-track-shift-v1',
  progress:Object.freeze({live:false,count:Count,finished:Count,received:[...Paths].reduce((N,P)=>N+Files.get(P),0)})});
}
