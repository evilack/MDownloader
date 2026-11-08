import {createHash} from 'node:crypto';
/** Independent ISO BMFF reader for native evidence; no production muxer or Mediabunny parsing. */
export function InspectMp4Subtitles(Bytes)
{
	function Boxes(Start=0,End=Bytes.length){const Out=[];for(let P=Start;P<End;){if(P+8>End)throw Error('mp4-box-header');let Size=Bytes.readUInt32BE(P),H=8;if(Size===1){if(P+16>End)throw Error('mp4-box-extended');Size=Number(Bytes.readBigUInt64BE(P+8));H=16;}if(!Size)Size=End-P;if(!Number.isSafeInteger(Size)||Size<H||P+Size>End)throw Error('mp4-box-bounds');Out.push({type:Bytes.toString('ascii',P+4,P+8),start:P+H,end:P+Size});P+=Size;}return Out;}
	const Child=(B,T)=>Boxes(B.start,B.end).find(C=>C.type===T);
	const Moov=Boxes().find(B=>B.type==='moov');if(!Moov)throw Error('mp4-moov');
	return Boxes(Moov.start,Moov.end).filter(B=>B.type==='trak').flatMap(Trak=>{
		const Mdia=Child(Trak,'mdia'),Hdlr=Child(Mdia,'hdlr');const Handler=Bytes.toString('ascii',Hdlr.start+8,Hdlr.start+12);if(!['text','sbtl','subt'].includes(Handler))return[];
		const Mdhd=Child(Mdia,'mdhd'),V=Bytes[Mdhd.start],Scale=Bytes.readUInt32BE(Mdhd.start+(V===1?20:12)),Packed=Bytes.readUInt16BE(Mdhd.start+(V===1?32:20));if(!Scale)throw Error('mp4-text-timescale');
		const Language=[10,5,0].map(S=>String.fromCharCode(96+((Packed>>S)&31))).join('');
		const Stbl=Child(Child(Mdia,'minf'),'stbl'),Stsd=Child(Stbl,'stsd'),Codec=Bytes.toString('ascii',Stsd.start+12,Stsd.start+16);if(Codec!=='tx3g')throw Error('mp4-text-codec');
		const Stsz=Child(Stbl,'stsz'),Count=Bytes.readUInt32BE(Stsz.start+8),Fixed=Bytes.readUInt32BE(Stsz.start+4);if(Count>1000000)throw Error('mp4-text-count');
		const Sizes=Array.from({length:Count},(_,I)=>Fixed||Bytes.readUInt32BE(Stsz.start+12+I*4));
		const Stts=Child(Stbl,'stts'),Deltas=[];for(let I=0,N=Bytes.readUInt32BE(Stts.start+4);I<N;I++){const P=Stts.start+8+I*8,C=Bytes.readUInt32BE(P),D=Bytes.readUInt32BE(P+4);if(Deltas.length+C>Count)throw Error('mp4-text-stts');for(let J=0;J<C;J++)Deltas.push(D);}if(Deltas.length!==Count)throw Error('mp4-text-durations');
		const Off=Child(Stbl,'stco')??Child(Stbl,'co64');if(!Off)throw Error('mp4-text-offsets');const Width=Off.type==='co64'?8:4;
		const Offsets=Array.from({length:Bytes.readUInt32BE(Off.start+4)},(_,I)=>Width===8?Number(Bytes.readBigUInt64BE(Off.start+8+I*8)):Bytes.readUInt32BE(Off.start+8+I*4));
		const Stsc=Child(Stbl,'stsc'),Chunks=Array.from({length:Bytes.readUInt32BE(Stsc.start+4)},(_,I)=>({first:Bytes.readUInt32BE(Stsc.start+8+I*12),count:Bytes.readUInt32BE(Stsc.start+12+I*12)}));
		let Index=0,Time=0,Nonempty=0,First,Last;const Lines=new Set(),Timeline=[];
		for(let I=0;I<Offsets.length;I++){let P=Offsets[I];const Rule=Chunks.findLast(C=>C.first<=I+1);if(!Rule)throw Error('mp4-text-chunks');for(let J=0;J<Rule.count;J++){
			const Size=Sizes[Index],Delta=Deltas[Index];if(Index>=Count||!Number.isSafeInteger(P)||Size<2||P+Size>Bytes.length)throw Error('mp4-text-sample');const Length=Bytes.readUInt16BE(P);if(Length+2>Size)throw Error('mp4-text-payload');const Text=Bytes.toString('utf8',P+2,P+2+Length);
			if(Text.trim()){Nonempty++;const Start=Math.round(Time*1000/Scale);First??=Start;Last=Math.round((Time+Delta)*1000/Scale);const Payload=Text.split('\n').map(L=>L.trim()).filter(Boolean);for(const Line of Payload)Lines.add(Line);Timeline.push([Start,Last,Payload.join('\n')]);}
			Time+=Delta;P+=Size;Index++;
		}}if(Index!==Count)throw Error('mp4-text-samples-missing');
		return[{handler:Handler,codec:Codec,language:Language,samples:Count,nonemptySamples:Nonempty,firstStartMs:First,lastEndMs:Last,
			timelineHash:createHash('sha256').update(JSON.stringify(Timeline)).digest('hex'),
			linesHash:createHash('sha256').update(JSON.stringify([...Lines].sort())).digest('hex')}];
	});
}
