/** Fixed mono signed-16-bit PCM interchange used by caption windows.
 * Decoder output with arbitrary RIFF chunks has a separate parser. */
export function CreateCaptionWavHeader(Frames,SampleRate){
 const Bytes=new Uint8Array(44),View=new DataView(Bytes.buffer);
 const Text=(Offset,Value)=>{for(let I=0;I<Value.length;I++)Bytes[Offset+I]=Value.charCodeAt(I);};
 Text(0,'RIFF');View.setUint32(4,36+Frames*2,true);Text(8,'WAVEfmt ');
 View.setUint32(16,16,true);View.setUint16(20,1,true);View.setUint16(22,1,true);
 View.setUint32(24,SampleRate,true);View.setUint32(28,SampleRate*2,true);
 View.setUint16(32,2,true);View.setUint16(34,16,true);Text(36,'data');View.setUint32(40,Frames*2,true);
 return Bytes;
}

export function ValidateCaptionPcmWav(Bytes,SampleRate){
 if(Bytes.length<44)throw Error('caption_window_clock');
 const View=new DataView(Bytes.buffer,Bytes.byteOffset,Bytes.byteLength),Tag=(A,B)=>String.fromCharCode(...Bytes.subarray(A,B));
 if(Tag(0,4)!=='RIFF'||View.getUint32(4,true)!==Bytes.length-8||Tag(8,12)!=='WAVE'||Tag(12,16)!=='fmt '||View.getUint32(16,true)!==16||View.getUint16(20,true)!==1||View.getUint16(22,true)!==1||View.getUint32(24,true)!==SampleRate||View.getUint32(28,true)!==SampleRate*2||View.getUint16(32,true)!==2||View.getUint16(34,true)!==16||Tag(36,40)!=='data'||View.getUint32(40,true)!==Bytes.length-44)throw Error('caption_window_clock');
}
