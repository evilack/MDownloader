"""One physical demux/decode/resample computation over caller-owned read-at IO."""
import base64
import hashlib
import io
import json
import os
import re
from pathlib import Path
import sys
import threading
from fractions import Fraction
from engine import DownloadParentMonitor, atomic_json, safe_integer
from av_decode import bounded_json, configuration

MAX_SAFE=9007199254740991


def failure_facts(error,operation):
    """Bounded computation facts, never exception messages, paths or stacks."""
    result={}
    if operation in ('import','open','select-audio','demux','decode','resample','flush'):
        result['operation']=operation
    name=type(error).__name__
    if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}',name):result['exceptionType']=name
    number=getattr(error,'errno',None)
    if type(number) is int and abs(number)<=2147483647:result['errno']=number
    return result


class PhysicalFailure(ValueError):
    def __init__(self,code,facts):
        super().__init__(code);self.facts=facts


def timing(frame):
    pts=frame.pts;clock=frame.time_base
    if pts is not None:safe_integer(pts,-MAX_SAFE,MAX_SAFE)
    num=clock.numerator if clock is not None else None;den=clock.denominator if clock is not None else None
    if num is not None:safe_integer(num,1);safe_integer(den,1)
    return {'pts':pts,'timeBaseNum':num,'timeBaseDen':den}


class AudioResample:
    """Execute the caller's explicit sample-rate/timestamp conversion."""
    def __init__(self,output,asynchronous=0,limits=None,check=lambda:None):
        import av
        self.av=av;self.output=output;self.asynchronous=asynchronous;self.graph=None
        self.limits=limits or {'queuedOutputBytes':2880000,'maxOutputFrameBytes':131072};self.check=check;self.input_end=None
        self.basic=av.AudioResampler(format='s16',layout='mono',rate=output['rate']) if not asynchronous else None

    def resample(self,frame):
        self.check()
        if self.basic is not None:return self.basic.resample(frame)
        if frame is not None:
            if frame.pts is None or frame.time_base is None:raise ValueError('caption_window_clock')
            start=frame.pts*frame.time_base
            if self.input_end is not None and abs(start-self.input_end)>Fraction(self.limits['queuedOutputBytes']//2,self.output['rate']):raise ValueError('caption_resample_output_limit')
            self.input_end=start+Fraction(frame.samples,frame.sample_rate)
        if self.graph is None:
            if frame is None:return []
            graph=self.av.filter.Graph()
            source=graph.add_abuffer(sample_rate=frame.sample_rate,format=frame.format.name,layout=frame.layout.name,time_base=frame.time_base)
            convert=graph.add('aresample',str(self.output['rate'])+':async='+str(self.asynchronous))
            format=graph.add('aformat','sample_fmts=s16:channel_layouts=mono')
            sink=graph.add('abuffersink');source.link_to(convert);convert.link_to(format);format.link_to(sink)
            graph.configure();self.graph=graph
        self.graph.push(frame);result=[];total=0
        while True:
            self.check()
            try:
                value=self.graph.pull();size=value.samples*2;total+=size
                if len(result)>=256 or size>self.limits['maxOutputFrameBytes'] or total>self.limits['queuedOutputBytes']:raise ValueError('caption_resample_output_limit')
                result.append(value)
            except (self.av.error.BlockingIOError,self.av.error.EOFError):return result


class Computation:
    def __init__(self,directory,config):
        self.directory=directory;self.config=config;self.limits=config['limits'];self.stop=threading.Event()
        self.event=0;self.frame=0;self.acked=0;self.ledger={};self.metadata=0
        self.status='opening';self.source_eof=False;self.demux_ended=False;self.decoder_flushed=False;self.resampler_flushed=False
        self.operation='import'
        self.counters={key:0 for key in ('inputRequests','inputBytesSupplied','decodedFrames','resampledFrames','outputSamples','outputBytes','ackedOutputBytes','queuedOutputBytes')}

    def state(self):
        atomic_json(self.directory/'state.json',{'state':self.status,'counters':self.counters})

    def controls(self):
        if self.stop.is_set():raise InterruptedError('caption_canceled')
        value=bounded_json(self.directory/'control.json',4096)
        if value.get('close'):raise InterruptedError('caption_canceled')
        through=safe_integer(value.get('event'),self.acked,self.event);frame=safe_integer(value.get('frame'),0,self.frame)
        changed=through!=self.acked
        for index in range(self.acked+1,through+1):
            item=self.ledger.pop(index)
            if item['frame']>frame:raise ValueError('caption_worker_protocol')
            self.counters['queuedOutputBytes']-=item['bytes'];self.counters['ackedOutputBytes']+=item['bytes'];self.metadata-=item['metadata']
            (self.directory/('event-%016d.json'%index)).unlink()
        self.acked=through
        if changed:self.state()

    def wait(self):
        self.stop.wait(self.limits['pollIntervalMs']/1000);self.controls()

    def room(self,byte_count=0,metadata=1024,control=False,terminal=False):
        if byte_count>self.limits['maxOutputFrameBytes'] or byte_count>self.limits['queuedOutputBytes']:raise ValueError('caption_frame_limit')
        while True:
            self.controls()
            reserved=0 if terminal else 2 if control else 8
            cap=self.limits['maxMetadataBytes']-(0 if terminal else 4096 if control else 8192)
            if len(self.ledger)<256-reserved and self.metadata+metadata<=cap and self.counters['queuedOutputBytes']+byte_count<=self.limits['queuedOutputBytes']:return
            self.wait()

    def emit(self,value,raw_bytes=0,terminal=False):
        metadata=len(json.dumps({key:item for key,item in value.items() if key!='data'},separators=(',',':')).encode())+64
        if metadata>4096:raise ValueError('caption_metadata_limit')
        # Terminal/error must remain publishable even when ordinary PCM is full.
        self.room(raw_bytes,metadata,control=value['type'] in ('input','opened'),terminal=terminal)
        next_event=safe_integer(self.event+1);value={'eventId':next_event,**value}
        next_counts={}
        if value['type']=='pcm':
            for key,amount in (('resampledFrames',1),('outputSamples',value['samples']),('outputBytes',raw_bytes)):
                next_counts[key]=safe_integer(self.counters[key]+amount)
        atomic_json(self.directory/('event-%016d.json'%next_event),value)
        self.event=next_event
        self.ledger[self.event]={'bytes':raw_bytes,'frame':value.get('sequence',0),'metadata':metadata};self.metadata+=metadata
        self.counters['queuedOutputBytes']+=raw_bytes
        self.counters.update(next_counts)
        if value['type']=='pcm':self.frame=value['sequence']
        self.state()

    def pcm(self,frame):
        if frame is None:return
        self.controls()
        if frame.format.name!='s16' or frame.format.is_planar or frame.layout.name!='mono' or frame.sample_rate!=self.config['output']['rate'] or len(frame.planes)!=1:raise ValueError('caption_output_format')
        count=safe_integer(frame.samples,1,self.limits['maxOutputFrameBytes']//2);size=count*2
        self.room(size)
        # A plane may carry FFmpeg alignment padding. Never export that padding.
        plane=memoryview(frame.planes[0])
        if plane.nbytes<size:raise ValueError('caption_worker_protocol')
        data=bytes(plane[:size])
        if sys.byteorder!='little':
            import array
            values=array.array('h');values.frombytes(data);values.byteswap();data=values.tobytes()
        self.emit({'type':'pcm','sequence':safe_integer(self.frame+1),'data':base64.b64encode(data).decode('ascii'),
            'bytes':size,'sha256':hashlib.sha256(data).hexdigest(),'samples':count,**self.config['output'],**timing(frame)},size)

    def burst(self,frames):
        if len(frames)>256 or sum(frame.samples*2 for frame in frames if frame is not None)>self.limits['queuedOutputBytes']:raise ValueError('caption_resampler_burst_limit')
        for frame in frames:self.pcm(frame)

    def terminal(self,error=None):
        self.status='error' if error else 'ended'
        self.emit({'type':'terminal','demuxEnded':self.demux_ended,'sourceEofObserved':self.source_eof,
            'decoderFlushed':self.decoder_flushed,'resamplerFlushed':self.resampler_flushed,'outputFrames':self.frame,
            'outputSamples':self.counters['outputSamples'],'outputBytes':self.counters['outputBytes'],'lastFrame':self.frame,
            **({'error':error} if error else {})},terminal=True)


class BridgeIO(io.RawIOBase):
    def __init__(self,owner):
        super().__init__();self.owner=owner;self.position=0;self.number=0;self.end=owner.config['input']['knownSize']

    def readable(self):return True
    def seekable(self):return self.owner.config['input']['seekable']
    def tell(self):return self.position

    def seek(self,offset,whence=os.SEEK_SET):
        if not self.seekable():raise io.UnsupportedOperation('caption_input_nonseekable')
        safe_integer(offset,-MAX_SAFE,MAX_SAFE)
        if whence==os.SEEK_SET:position=offset
        elif whence==os.SEEK_CUR:position=self.position+offset
        elif whence==os.SEEK_END:
            size=self.owner.config['input']['knownSize']
            if size is None:raise io.UnsupportedOperation('caption_input_unknown_size')
            position=size+offset
        else:raise ValueError('caption_invalid')
        self.position=safe_integer(position)
        return self.position

    def read(self,n=-1):
        if n==0:return b''
        if type(n) is not int or n<0:raise ValueError('caption_input_unbounded_read')
        owner=self.owner;owner.controls()
        if self.end is not None and self.position>=self.end:
            owner.source_eof=True
            return b''
        length=min(n,owner.limits['ioChunkBytes'],owner.config['input']['bufferBytes'],MAX_SAFE-self.position)
        if self.end is not None:length=min(length,self.end-self.position)
        if length<=0:raise ValueError('caption_input_offset_limit')
        self.number+=1;request={'type':'input','id':'r'+str(self.number),'offset':self.position,'length':length}
        atomic_json(owner.directory/'pending.json',request)
        owner.counters['inputRequests']=safe_integer(owner.counters['inputRequests']+1)
        owner.emit(request)
        path=owner.directory/'supply.json'
        while not path.exists():owner.wait()
        owner.controls();value=bounded_json(path,360448)
        data=base64.b64decode(value['data'],validate=True)
        if value.get('id')!=request['id'] or value.get('offset')!=self.position or len(data)>length or not data and not value.get('eof') or hashlib.sha256(data).hexdigest()!=value.get('sha256'):raise ValueError('caption_worker_protocol')
        if value.get('eof'):
            terminal=self.position+len(data);known=owner.config['input']['knownSize']
            if self.end is not None and terminal!=self.end or known is not None and terminal!=known:raise ValueError('caption_input_eof_conflict')
            self.end=terminal;owner.source_eof=True
        path.unlink();(owner.directory/'pending.json').unlink()
        self.position+=len(data);owner.counters['inputBytesSupplied']=safe_integer(owner.counters['inputBytesSupplied']+len(data));owner.state()
        return data


def reject_secondary(*args,**kwargs):raise ValueError('caption_secondary_resource_denied')


def decode(owner):
    # The parent monitor is already watching before this optional native import.
    import av
    config=owner.config;format=config['demux']['format']
    if format is not None:
        descriptor=av.format.ContainerFormat(format)
        if not descriptor.is_input or int(descriptor.flags)&3:raise ValueError('caption_demux_format')
    options={key:str(value) for key,value in config['demux']['options'].items()}
    options['protocol_whitelist']='pipe'
    bridge=BridgeIO(owner);container=None
    try:
        owner.operation='open'
        container=av.open(bridge,mode='r',format=format,buffer_size=config['input']['bufferBytes'],
            container_options=options,io_open=reject_secondary)
        owner.operation='select-audio'
        index=config['audio']['index']
        if index>=len(container.streams.audio):raise ValueError('caption_audio_stream_missing')
        stream=container.streams.audio[index]
        # demux(stream) selects the requested audio. Stream.discard is not
        # exposed by the pinned PyAV 15.1 runtime, including video streams.
        clock=stream.time_base
        facts={'type':'opened','audioIndex':index,'streamIndex':safe_integer(stream.index),'codec':stream.codec_context.name,
            'timeBaseNum':safe_integer(clock.numerator,1) if clock else None,'timeBaseDen':safe_integer(clock.denominator,1) if clock else None,
            'startTime':safe_integer(stream.start_time,-MAX_SAFE,MAX_SAFE) if stream.start_time is not None else None,
            'duration':safe_integer(stream.duration,0) if stream.duration is not None else None,
            'pyav':av.__version__,'libraries':{key:list(value) for key,value in av.library_versions.items()},'acceptedOptions':config['demux']}
        owner.status='decoding';owner.emit(facts)
        resampler=AudioResample(config['output'],config.get('resample',{}).get('async',0),owner.limits,owner.controls);initial=None;flushed=False
        packets=iter(container.demux(stream))
        while True:
            # Reserve at least one maximum frame before asking libav for more packets.
            owner.room(owner.limits['maxOutputFrameBytes'])
            owner.operation='demux'
            try:packet=next(packets)
            except StopIteration:break
            dummy=packet.size==0 and packet.pts is None and packet.dts is None
            if dummy:
                if flushed:continue
                flushed=True
            owner.operation='decode'
            for frame in packet.decode():
                owner.counters['decodedFrames']=safe_integer(owner.counters['decodedFrames']+1)
                observed=(frame.format.name,frame.layout.name,frame.sample_rate)
                if initial is None:initial=observed
                elif observed!=initial:raise PhysicalFailure('caption_input_format_changed',{'expectedInput':list(initial),'observedInput':list(observed),**timing(frame)})
                owner.operation='resample';owner.burst(resampler.resample(frame));owner.operation='decode'
        owner.demux_ended=True;owner.decoder_flushed=flushed
        # PyAV demux emits its own decoder flush packet. Never decode(None) again.
        owner.operation='flush';owner.burst(resampler.resample(None))
        owner.resampler_flushed=True;owner.terminal()
    finally:
        if container is not None:container.close()
        bridge.close()


def main():
    directory=Path(sys.argv[1]);parent=int(sys.argv[2]);cancel=int(sys.argv[3])
    monitor=DownloadParentMonitor(parent,cancel)
    monitor.start()
    owner=None
    try:
        raw=bounded_json(directory/'config.json',16384);config=configuration(raw)
        owner=Computation(directory,config);owner.state()
        try:decode(owner)
        except InterruptedError:owner.status='closed';owner.state();return
        except Exception as error:
            code=str(error) if re.fullmatch(r'caption_[a-z_]{1,70}',str(error)) else 'caption_av_decode_failed'
            owner.emit({'type':'error','error':code,**failure_facts(error,owner.operation),**getattr(error,'facts',{})},terminal=True);owner.terminal(code)
        # Preserve output/receipts for app ACK until explicit close or parent death.
        while True:owner.wait()
    except InterruptedError:pass
    finally:monitor.close()


if __name__=='__main__':main()
