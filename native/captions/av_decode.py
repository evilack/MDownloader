"""Owned asynchronous byte-IO/audio computation; no application workflow."""
import base64
from collections import OrderedDict
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import uuid
from engine import atomic_json, open_snapshot, safe_integer, spawn_owned_worker

MAX_SAFE=9007199254740991


def native_message_bytes(value):
    """Use the transport's UTF-8 JSON encoding for exact response budgets."""
    return json.dumps(value,ensure_ascii=False).encode('utf-8')


def configuration(message):
    source=message.get('input');demux=message.get('demux');audio=message.get('audio');output=message.get('output');limits=message.get('limits')
    if not all(isinstance(v,dict) for v in (source,demux,audio,output,limits)):raise ValueError('caption_invalid')
    if type(source.get('seekable')) is not bool:raise ValueError('caption_invalid')
    known=source.get('knownSize')
    if known is not None:safe_integer(known)
    if known is None and source['seekable']:raise ValueError('caption_input_unknown_size')
    format=demux.get('format')
    if format is not None and (not isinstance(format,str) or not re.fullmatch(r'[a-zA-Z0-9_]{1,64}',format)):raise ValueError('caption_invalid')
    options=demux.get('options')
    if not isinstance(options,dict) or set(options)-{'probesize','analyzeduration','max_probe_packets'}:raise ValueError('caption_invalid')
    bounds={'probesize':(32,64*1024*1024),'analyzeduration':(0,60000000),'max_probe_packets':(1,100000)}
    for key,value in options.items():safe_integer(value,*bounds[key])
    if output.get('channels')!=1 or type(output.get('channels')) is not int or output.get('sampleFormat')!='s16' or output.get('byteOrder')!='little':raise ValueError('caption_invalid')
    resample=message.get('resample',{'async':0})
    if not isinstance(resample,dict) or set(resample)!={'async'}:raise ValueError('caption_invalid')
    asynchronous=safe_integer(resample['async'],0,1000)
    checked={}
    for key,low,high in (('ioChunkBytes',1,262144),('queuedOutputBytes',4096,64*1024*1024),
            ('maxOutputFrameBytes',2,131072),('maxMetadataBytes',16384,4*1024*1024),
            ('maxLogBytes',0,1024*1024),('cancelGraceMs',10,5000),('pollIntervalMs',10,1000)):
        checked[key]=safe_integer(limits.get(key),low,high)
    if checked['queuedOutputBytes']<checked['maxOutputFrameBytes']:raise ValueError('caption_invalid')
    return {'input':{'seekable':source['seekable'],'knownSize':known,'bufferBytes':safe_integer(source.get('bufferBytes'),1024,262144)},
        'demux':{'format':format,'options':options},'audio':{'index':safe_integer(audio.get('index'),0,4095)},
        'output':{'rate':safe_integer(output.get('rate'),8000,192000),'channels':1,'sampleFormat':'s16','byteOrder':'little'},'resample':{'async':asynchronous},'limits':checked}


def bounded_json(path,maximum):
    with open_snapshot(path) as file:data=file.read(maximum+1)
    if len(data)>maximum:raise ValueError('caption_worker_protocol')
    value=json.loads(data)
    if not isinstance(value,dict):raise ValueError('caption_worker_protocol')
    return value


class AvDecodeSession:
    def __init__(self,key,work,config):
        self.key=key;self.work=Path(work);self.config=config;self.directory=self.work/('av-'+uuid.uuid4().hex)
        self.lock=threading.RLock();self.process=None;self.kernel=None;self.cancel_event=None
        self.closed=False;self.stopped=False;self.receipts=OrderedDict();self.last_supply=0
        self.acked_event=0;self.acked_frame=0;self.high_event=0;self.high_frame=0

    def start(self):
        with self.lock:
            if self.closed:raise InterruptedError('caption_canceled')
            self.directory.mkdir(parents=True,exist_ok=False)
            atomic_json(self.directory/'config.json',self.config)
            atomic_json(self.directory/'control.json',{'event':0,'frame':0,'close':False})
            command=[sys.executable,'-X','faulthandler',str(Path(__file__).with_name('av-decode-worker.py')),str(self.directory)]
            # No unbounded worker stderr file; factual errors travel in bounded events.
            with open(os.devnull,'wb') as sink:
                self.process,self.kernel,self.cancel_event=spawn_owned_worker(command,sink)

    def state(self):
        path=self.directory/'state.json'
        value=bounded_json(path,16384) if path.exists() else {'state':'opening','counters':{}}
        if self.process is not None and self.process.poll() is not None and value.get('state') not in ('ended','error','closed'):
            value={**value,'state':'error','error':'caption_worker_exited'}
        return value

    def poll(self,message):
        with self.lock:
            after=safe_integer(message.get('afterEvent'));maximum=safe_integer(message.get('maxEvents'),1,128)
            budget=safe_integer(message.get('maxBytes'),4096,524288)
            if after<self.acked_event:raise ValueError('caption_event_expired')
            if after>self.high_event:raise ValueError('caption_invalid')
            events=[];cursor=after;state=self.state()
            response={'events':events,'nextEvent':cursor,**state}
            def fits(value):
                # Count the real envelope and four-byte native-message prefix.
                return 4+len(native_message_bytes({'id':message.get('id'),'ok':True,'data':value}))<=budget
            if not fits(response):raise ValueError('caption_poll_bytes')
            # The worker publishes consecutive immutable events atomically.
            while len(events)<maximum:
                path=self.directory/('event-%016d.json'%(cursor+1))
                if not path.exists():break
                value=bounded_json(path,196608)
                events.append(value)
                candidate={'events':events,'nextEvent':cursor+1,**state}
                if not fits(candidate):
                    events.pop()
                    if not events:raise ValueError('caption_poll_bytes')
                    break
                cursor+=1;response=candidate
                self.high_event=max(self.high_event,cursor)
                if value.get('type')=='pcm':self.high_frame=max(self.high_frame,value['sequence'])
            return response

    def supply(self,message):
        with self.lock:
            request=message.get('requestId');offset=safe_integer(message.get('offset'));eof=message.get('eof');encoded=message.get('data')
            if not isinstance(request,str) or not re.fullmatch(r'r[1-9][0-9]{0,15}',request) or type(eof) is not bool or not isinstance(encoded,str) or len(encoded)>349528:raise ValueError('caption_invalid')
            try:data=base64.b64decode(encoded,validate=True)
            except Exception:raise ValueError('caption_invalid')
            identity=(offset,eof,len(data),hashlib.sha256(data).hexdigest())
            if request in self.receipts:
                old,result=self.receipts[request]
                if old!=identity:raise ValueError('caption_replay_conflict')
                return result
            number=int(request[1:])
            if number<=self.last_supply:raise ValueError('caption_replay_rejected')
            pending=self.directory/'pending.json'
            if not pending.exists():raise ValueError('caption_input_missing')
            expected=bounded_json(pending,4096)
            if expected.get('id')!=request or expected.get('offset')!=offset or not 0<=len(data)<=expected['length'] or not data and not eof or offset+len(data)>MAX_SAFE:raise ValueError('caption_invalid')
            known=self.config['input']['knownSize']
            if known is not None and (offset+len(data)>known or eof and offset+len(data)!=known):raise ValueError('caption_input_eof_conflict')
            if (self.directory/'supply.json').exists():raise ValueError('caption_busy')
            atomic_json(self.directory/'supply.json',{'id':request,'offset':offset,'data':encoded,'eof':eof,'sha256':identity[3]})
            result={'requestId':request,'acceptedBytes':len(data)}
            self.last_supply=number;self.receipts[request]=(identity,result)
            while len(self.receipts)>128:self.receipts.popitem(last=False)
            return result

    def ack(self,message):
        with self.lock:
            event=safe_integer(message.get('throughEvent'));frame=safe_integer(message.get('throughFrame'))
            if event<self.acked_event or frame<self.acked_frame or event>self.high_event or frame>self.high_frame:raise ValueError('caption_invalid')
            expected=self.acked_frame
            for index in range(self.acked_event+1,event+1):
                value=bounded_json(self.directory/('event-%016d.json'%index),196608)
                if value.get('type')=='pcm':expected=value['sequence']
            if expected!=frame:raise ValueError('caption_invalid')
            self.acked_event=event;self.acked_frame=frame
            atomic_json(self.directory/'control.json',{'event':event,'frame':frame,'close':False})
            # Credit is confirmed by the worker state, not guessed from unpolled output.
            state=self.state();credit=max(0,self.config['limits']['queuedOutputBytes']-state.get('counters',{}).get('queuedOutputBytes',self.config['limits']['queuedOutputBytes']))
            return {'ackedEvent':event,'ackedFrame':frame,'outputCreditBytes':credit}

    def close(self):
        with self.lock:
            if self.stopped:return True
            self.closed=True;grace=self.config['limits']['cancelGraceMs']/1000
            if self.directory.exists():atomic_json(self.directory/'control.json',{'event':self.acked_event,'frame':self.acked_frame,'close':True})
            process=self.process
            if process is not None:
                if process.poll() is None:
                    if self.cancel_event:self.kernel.SetEvent(self.cancel_event)
                    if process.stdin:process.stdin.close()
                    try:process.wait(timeout=grace)
                    except subprocess.TimeoutExpired:
                        process.terminate()
                        try:process.wait(timeout=grace)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            try:process.wait(timeout=grace)
                            except subprocess.TimeoutExpired:return False
                process.wait(timeout=grace)
            if self.cancel_event:self.kernel.CloseHandle(self.cancel_event);self.cancel_event=None
            if self.directory.exists():shutil.rmtree(self.directory)
            self.stopped=True;self.receipts.clear()
            return True
