"""Native messaging command executor. The extension owns all caption workflows."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import threading
import urllib.parse
import urllib.request
import uuid
from engine import (InferenceSession, PackageLease, atomic_json, check_cancel, decode_audio,
                    is_link, probe, safe_integer, executable)
from av_decode import AvDecodeSession, configuration as av_configuration, native_message_bytes

MAX_MESSAGE=800000
MAX_CHUNK=256*1024
MAX_FILE=20*1024**3
MAX_ACTIVE=32
TOKEN=re.compile(r'^[A-Za-z0-9_.:-]{1,128}$')
OPERATIONS=frozenset(('probe','usage','stat','list','read','write','remove','move','decode','sessionOpen','sessionInfer',
    'sessionClose','httpJson','fetchFile','publish','copyExclusive',
    'avDecodeOpen','avDecodePoll','avDecodeSupply','avDecodeAck','avDecodeClose'))


def read_exact(stream,size):
    result=bytearray()
    while len(result)<size:
        part=stream.read(size-len(result))
        if not part:raise ValueError('caption_protocol')
        result.extend(part)
    return bytes(result)


def read_message(stream):
    first=stream.read(4)
    if not first:return None
    if len(first)!=4:raise ValueError('caption_protocol')
    size=struct.unpack('<I',first)[0]
    if not 1<=size<=MAX_MESSAGE:raise ValueError('caption_protocol')
    value=json.loads(read_exact(stream,size))
    if not isinstance(value,dict):raise ValueError('caption_protocol')
    return value


def default_root():
    if os.environ.get('MDOWNLOADER_CAPTION_HOME'):return Path(os.environ['MDOWNLOADER_CAPTION_HOME'])
    base=os.environ.get('LOCALAPPDATA',str(Path.home()/'Library'/'Application Support') if sys.platform=='darwin' else str(Path.home()/'.local/share'))
    return Path(base)/'MDownloader'/'captions'


def checked_https(url):
    if not isinstance(url,str) or len(url)>16384:raise ValueError('caption_invalid')
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:raise ValueError('caption_invalid')
    return url


class HttpsRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,msg,headers,newurl):
        checked_https(newurl)
        return super().redirect_request(request,fp,code,msg,headers,newurl)


class CaptionHost:
    def __init__(self,root,emit,config=None):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.config=config if config is not None else json.loads((self.root/'config.json').read_text('utf-8')) if (self.root/'config.json').exists() else {}
        namespace=self.config.get('originNamespace')
        self.storage=self.root/'origins'/namespace if namespace else self.root
        if namespace and not re.fullmatch(r'[a-p]{32}',namespace):raise ValueError('caption_invalid')
        self.storage.mkdir(parents=True,exist_ok=True)
        self.jobs=self.storage/'jobs';self.models=self.root/'models'
        for area in (self.jobs,self.models):
            if is_link(area):raise ValueError('caption_invalid')
        self.emit=emit;self.lock=threading.RLock();self.stopping=False
        self.active={};self.canceled=set();self.sessions={};self.decoders={}
        self.package=None;self.package_refs=0
        self.opener=urllib.request.build_opener(HttpsRedirect())

    def path(self,area,name,root_ok=False):
        if area not in ('jobs','models'):raise ValueError('caption_invalid')
        base=self.jobs if area=='jobs' else self.models
        if name=='' and root_ok:
            if is_link(base) or is_link(self.storage):raise ValueError('caption_invalid')
            return base
        if not isinstance(name,str) or not name or len(name)>4096 or '\\' in name:raise ValueError('caption_invalid')
        parts=name.split('/')
        if any(p in ('','.','..') or ':' in p or p.rstrip(' .')!=p or any(ord(c)<32 for c in p) for p in parts):raise ValueError('caption_invalid')
        # Windows device names and alternate streams are never ordinary scoped files.
        if any(re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',p) for p in parts):raise ValueError('caption_invalid')
        path=base.joinpath(*parts)
        for current in (self.storage,base,*[base.joinpath(*parts[:i]) for i in range(1,len(parts)+1)]):
            if is_link(current):raise ValueError('caption_invalid')
        if not path.resolve().is_relative_to(base.resolve()):raise ValueError('caption_invalid')
        return path

    def check_tree(self,path):
        if is_link(path):raise ValueError('caption_invalid')
        if path.is_dir():
            for directory,dirs,files in os.walk(path,followlinks=False):
                if any(is_link(Path(directory)/name) for name in dirs+files):raise ValueError('caption_invalid')

    def delete(self,path):
        self.check_tree(path)
        if path.is_dir():shutil.rmtree(path)
        else:path.unlink(missing_ok=True)

    def guard_model_mutation(self,*paths):
        for record in self.sessions.values():
            model=record['model']
            if any(path==model or path in model.parents or model in path.parents for path in paths):raise ValueError('caption_busy')

    def guard_decoder_mutation(self,*paths):
        for record in self.decoders.values():
            if record['released']:continue
            work=record['session'].work
            if any(path==work or path in work.parents or work in path.parents for path in paths):raise ValueError('caption_busy')

    def release_decoder(self,record):
        with self.lock:
            if not record['released']:
                record['released']=True;self.release_package()

    def hold_package(self):
        if self.package is None:self.package=PackageLease(self.root)
        self.package_refs+=1

    def release_package(self):
        self.package_refs-=1
        if self.package_refs==0 and self.package is not None:
            self.package.close();self.package=None

    def pop_session(self,key,record):
        with self.lock:
            if self.sessions.get(key) is record:
                self.sessions.pop(key);self.release_package()

    def reserve(self,message):
        if not isinstance(message,dict) or message.get('action')!='execute' or message.get('operation') not in OPERATIONS:raise ValueError('caption_unsupported')
        scope=message.get('scope')
        if not isinstance(scope,str) or not TOKEN.fullmatch(scope):raise ValueError('caption_invalid')
        with self.lock:
            if self.stopping:raise InterruptedError('caption_canceled')
            if len(self.active)>=MAX_ACTIVE:raise ValueError('caption_busy')
            if scope in self.canceled and message['operation'] not in ('sessionClose','avDecodeClose'):raise InterruptedError('caption_canceled')
            lease=message['operation']!='probe'
            if lease:self.hold_package()
            token=uuid.uuid4().hex;record={'scope':scope,'cancel':threading.Event(),'done':threading.Event(),'lease':lease}
            record['writes']=[]
            self.active[token]=record
            return token,record

    def finish(self,reserved):
        token,record=reserved
        with self.lock:
            if self.active.pop(token,None) is not None and record['lease']:self.release_package()
            record['done'].set()

    def cancel_scope(self,scope):
        if not isinstance(scope,str) or not TOKEN.fullmatch(scope):raise ValueError('caption_invalid')
        with self.lock:
            self.canceled.add(scope)
            records=[r for r in self.active.values() if r['scope']==scope]
            sessions=[(key,r) for key,r in self.sessions.items() if r['scope']==scope]
            decoders=[r for r in self.decoders.values() if r['scope']==scope and not r['released']]
            for record in records:record['cancel'].set()
            for _,record in sessions:record['cancel'].set()
        decoder_busy=False
        for record in decoders:
            if record['session'].close():self.release_decoder(record)
            else:decoder_busy=True
        # A request finishing after cancellation cannot retain a process or write.
        for _,record in sessions:
            session=record.get('session')
            if session:session.close()
        for record in records:record['done'].wait()
        for key,record in sessions:self.pop_session(key,record)
        if decoder_busy:raise ValueError('caption_busy')
        return {'canceled':True}

    def handle(self,message,reserved=None):
        if not isinstance(message,dict):raise ValueError('caption_invalid')
        if message.get('action')=='cancelExecution':return self.cancel_scope(message.get('scope'))
        own=reserved is None
        if own:reserved=self.reserve(message)
        try:
            _,record=reserved
            if message['operation'] not in ('sessionClose','avDecodeClose'):check_cancel(record['cancel'])
            return self.execute(message,record)
        finally:self.finish(reserved)

    def execute(self,m,record):
        op=m['operation'];cancel=record['cancel'];scope=record['scope']
        if op=='probe':return probe(self.config,m.get('engine'))
        if op.startswith('avDecode'):return self.av_decode(m,record)
        if op=='usage':
            with self.lock:
                path=self.path(m.get('area'),m.get('path'),root_ok=True)
                size=0;entries=0
                if path.is_file():size=path.stat().st_size
                elif path.is_dir():
                    for directory,dirs,files in os.walk(path,followlinks=False):
                        check_cancel(cancel);entries+=len(dirs)+len(files)
                        if any(is_link(Path(directory)/name) for name in dirs+files):raise ValueError('caption_invalid')
                        if entries>100000:raise ValueError('caption_result_limit')
                        for name in files:
                            # Decoder/inference workers atomically replace temporary
                            # files independently of the host's command lock.
                            try:size+=(Path(directory)/name).stat().st_size
                            except FileNotFoundError:continue
                return {'bytes':size,'free':shutil.disk_usage(self.root).free}
        if op in ('stat','list','read','write','remove','move','publish'):
            # Small file primitives are serialized; a cancel never overtakes a write.
            with self.lock:
                check_cancel(cancel)
                if op in ('move','publish'):
                    area=m.get('area');source=self.path(area,m.get('source'));target=self.path(area,m.get('target'))
                    self.guard_decoder_mutation(source,target)
                    if not source.exists():raise ValueError('caption_file_missing')
                    self.check_tree(source);self.check_tree(target)
                    if area=='models':self.guard_model_mutation(source,target)
                    if source==target or source in target.parents or target in source.parents:raise ValueError('caption_invalid')
                    target.parent.mkdir(parents=True,exist_ok=True)
                    if op=='publish':
                        if area!='models':raise ValueError('caption_invalid')
                        backup=target.with_name(target.name+'.rollback-'+uuid.uuid4().hex)
                        existed=target.exists()
                        try:
                            if existed:target.replace(backup)
                            try:source.replace(target)
                            except BaseException:
                                if existed:backup.replace(target)
                                raise
                        finally:
                            if backup.exists() and target.exists():self.delete(backup)
                    else:
                        replace=m.get('replace',False)
                        if type(replace) is not bool:raise ValueError('caption_invalid')
                        if target.exists() and not replace:raise ValueError('caption_output_exists')
                        if replace:source.replace(target)
                        else:source.rename(target)
                    return {'moved':True}
                area=m.get('area');path=self.path(area,m.get('path'),root_ok=op=='list')
                if op in ('write','remove'):self.guard_decoder_mutation(path)
                if area=='models' and op in ('write','remove'):self.guard_model_mutation(path)
                if op=='stat':
                    exists=path.exists();return {'exists':exists,'size':path.stat().st_size if exists and path.is_file() else 0,'isDirectory':exists and path.is_dir()}
                if op=='list':
                    if not path.exists():return {'entries':[]}
                    if not path.is_dir():raise ValueError('caption_invalid')
                    entries=[]
                    for child in sorted(path.iterdir()):
                        if len(entries)>=10000:raise ValueError('caption_result_limit')
                        if is_link(child):raise ValueError('caption_invalid')
                        entries.append({'name':child.name,'size':child.stat().st_size if child.is_file() else 0,'isDirectory':child.is_dir()})
                    if len(json.dumps(entries).encode())>MAX_MESSAGE-1024:raise ValueError('caption_result_limit')
                    return {'entries':entries}
                if op=='remove':self.delete(path);return {'removed':True}
                offset=safe_integer(m.get('offset'),0,MAX_FILE)
                if op=='read':
                    count=safe_integer(m.get('maxBytes'),1,MAX_CHUNK)
                    with path.open('rb') as file:file.seek(offset);data=file.read(count)
                    return {'data':base64.b64encode(data).decode(),'offset':offset+len(data),'done':offset+len(data)>=path.stat().st_size}
                encoded=m.get('data');truncate=m.get('truncate',False)
                if not isinstance(encoded,str) or len(encoded)>4*((MAX_CHUNK+2)//3) or type(truncate) is not bool or truncate and offset!=0:raise ValueError('caption_invalid')
                try:data=base64.b64decode(encoded,validate=True)
                except Exception:raise ValueError('caption_invalid')
                if len(data)>MAX_CHUNK or offset+len(data)>MAX_FILE:raise ValueError('caption_invalid')
                path.parent.mkdir(parents=True,exist_ok=True)
                size=path.stat().st_size if path.exists() else 0
                if offset>size:raise ValueError('caption_upload_order')
                if path.exists() and size>=offset+len(data):
                    with path.open('rb') as file:file.seek(offset);same=file.read(len(data))==data
                    if same and (not truncate or size==len(data)):return {'offset':offset+len(data)}
                if offset<size and not truncate:raise ValueError('caption_upload_order')
                with path.open('wb' if truncate else 'ab') as file:file.write(data)
                return {'offset':offset+len(data)}
        if op=='decode':
            source=m.get('source')
            source=self.external(source['external']) if isinstance(source,dict) and set(source)=={'external'} else self.path('jobs',source)
            output=self.path('jobs',m.get('output'))
            with self.lock:
                self.guard_decoder_mutation(output);record['writes']=[output]
            files=decode_audio(source,output,self.config,cancel,m.get('rate'),m.get('chunkSeconds'),m.get('trim'),m.get('alignOrigin',False),m.get('maxOutputBytes'),m.get('minFreeBytes'))
            return {'files':[{**entry,'path':entry['path'].relative_to(self.jobs).as_posix()} for entry in files]}
        if op=='sessionOpen':
            key=m.get('sessionId')
            if not isinstance(key,str) or not TOKEN.fullmatch(key):raise ValueError('caption_invalid')
            model=self.path('models',m.get('model'));work=self.path('jobs',m.get('work'))
            if not model.exists():raise ValueError('caption_model_missing')
            self.check_tree(model)
            with self.lock:
                self.guard_decoder_mutation(work)
                if key in self.sessions or len(self.sessions)>=8:raise ValueError('caption_busy')
                session_record={'scope':scope,'cancel':cancel,'session':None,'model':model,'work':work};self.hold_package();self.sessions[key]=session_record
            try:
                def register(session):
                    with self.lock:session_record['session']=session
                InferenceSession(m.get('engine'),model,m.get('recognition'),m.get('processing'),work,cancel,register,
                    backend=m.get('backend','binding'),cli=executable(self.config,'whisperCli','whisper-cli'))
                check_cancel(cancel)
                return {'sessionId':key}
            except BaseException:
                if session_record['session']:session_record['session'].close()
                self.pop_session(key,session_record)
                raise
        if op in ('sessionInfer','sessionClose'):
            key=m.get('sessionId')
            with self.lock:session_record=self.sessions.get(key)
            if not session_record:
                if op=='sessionClose':return {'closed':True}
                raise ValueError('caption_session_missing')
            if session_record['scope']!=scope:raise ValueError('caption_invalid')
            session=session_record['session']
            if session is None:raise ValueError('caption_busy')
            if op=='sessionClose':
                session_record['cancel'].set();session.close()
                self.pop_session(key,session_record)
                return {'closed':True}
            language=m.get('language')
            if not isinstance(language,str) or not re.fullmatch(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*|auto',language) or len(language)>35:raise ValueError('caption_invalid')
            audio=self.path('jobs',m.get('audio'));output=self.path('jobs',m.get('output'))
            with self.lock:
                self.guard_decoder_mutation(output);record['writes']=[output]
            word_timestamps=m.get('wordTimestamps',False)
            if type(word_timestamps) is not bool:raise ValueError('caption_invalid')
            value=session.infer(audio,language,word_timestamps) if word_timestamps else session.infer(audio,language);check_cancel(cancel)
            output.parent.mkdir(parents=True,exist_ok=True);atomic_json(output,value)
            return {'path':output.relative_to(self.jobs).as_posix(),'bytes':output.stat().st_size}
        if op in ('httpJson','fetchFile'):return self.transfer(m,record)
        if op=='copyExclusive':return self.copy_exclusive(m,cancel,record)
        raise ValueError('caption_unsupported')

    def av_decode(self,m,operation):
        key=m.get('decoderId');scope=operation['scope'];op=m['operation']
        if not isinstance(key,str) or not TOKEN.fullmatch(key):raise ValueError('caption_invalid')
        with self.lock:
            record=self.decoders.get(key)
            if record and record['scope']!=scope:raise ValueError('caption_invalid')
            if op=='avDecodeOpen':
                config=av_configuration(m);work=self.path('jobs',m.get('work'))
                if record:
                    if record['config']!=config or record['session'].work!=work:raise ValueError('caption_replay_conflict')
                    return {'decoderId':key,'state':'closed' if record['released'] else record['session'].state()['state'],'contractVersion':1}
                # Retain tombstones for this connection; never recycle stale IDs.
                if len(self.decoders)>=1024 or sum(not r['released'] for r in self.decoders.values())>=8:raise ValueError('caption_busy')
                self.guard_decoder_mutation(work)
                for active in self.active.values():
                    for other in active['writes']:
                        if work==other or work in other.parents or other in work.parents:raise ValueError('caption_busy')
                for existing in self.sessions.values():
                    other=existing['work']
                    if work==other or work in other.parents or other in work.parents:raise ValueError('caption_busy')
                session=AvDecodeSession(key,work,config)
                record={'scope':scope,'session':session,'config':config,'released':False}
                self.hold_package();self.decoders[key]=record
                try:
                    check_cancel(operation['cancel']);session.start()
                except BaseException:
                    if session.close():self.release_decoder(record)
                    raise
                return {'decoderId':key,'state':'opening','contractVersion':1}
            if record is None:raise ValueError('caption_decoder_missing')
            session=record['session']
            if op!='avDecodeClose' and (record['released'] or session.closed):raise ValueError('caption_decoder_closed')
        if op=='avDecodeClose':
            if not session.close():raise ValueError('caption_busy')
            self.release_decoder(record);return {'closed':True}
        if op=='avDecodePoll':return session.poll(m)
        if op=='avDecodeSupply':return session.supply(m)
        if op=='avDecodeAck':return session.ack(m)
        raise ValueError('caption_unsupported')

    def external(self,value):
        if not isinstance(value,str) or not value or '\x00' in value:raise ValueError('caption_invalid')
        path=Path(value)
        if not path.is_absolute() or not path.is_file() or is_link(path):raise ValueError('caption_invalid')
        for parent in path.parents:
            if is_link(parent):raise ValueError('caption_invalid')
        return path.resolve()

    def transfer(self,m,record):
        cancel=record['cancel'];url=checked_https(m.get('url'))
        if m['operation']=='httpJson':
            maximum=safe_integer(m.get('maxBytes'),1,1024*1024)
            with self.opener.open(url,timeout=5) as response:
                checked_https(response.url);parts=bytearray()
                while True:
                    check_cancel(cancel);part=response.read(min(65536,maximum+1-len(parts)))
                    if not part:break
                    parts.extend(part)
                    if len(parts)>maximum:raise ValueError('caption_result_limit')
                check_cancel(cancel);value=json.loads(parts)
                if len(json.dumps(value).encode())>MAX_MESSAGE-1024:raise ValueError('caption_result_limit')
                return value
        if m.get('area')!='models':raise ValueError('caption_invalid')
        target=self.path('models',m.get('path'))
        with self.lock:self.guard_model_mutation(target)
        expected=safe_integer(m.get('bytes'),1,MAX_FILE)
        checksum=m.get('checksum')
        if not isinstance(checksum,dict) or checksum.get('algorithm') not in ('sha256','git-sha1'):raise ValueError('caption_invalid')
        algorithm=checksum['algorithm'];digest=checksum.get('value')
        if not isinstance(digest,str) or not re.fullmatch('[a-fA-F0-9]{'+('64' if algorithm=='sha256' else '40')+'}',digest):raise ValueError('caption_invalid')
        hasher=hashlib.sha256() if algorithm=='sha256' else hashlib.sha1(b'blob '+str(expected).encode()+b'\x00')
        target.parent.mkdir(parents=True,exist_ok=True);temporary=target.with_name(target.name+'.fetch-'+uuid.uuid4().hex)
        received=0
        try:
            with self.opener.open(url,timeout=5) as response,temporary.open('xb') as file:
                checked_https(response.url)
                while True:
                    check_cancel(cancel);data=response.read(min(MAX_CHUNK,expected-received+1))
                    if not data:break
                    received+=len(data)
                    if received>expected:raise ValueError('caption_download_size')
                    file.write(data);hasher.update(data)
                    self.emit({'event':'operationProgress','scope':record['scope'],'received':received,'total':expected})
            check_cancel(cancel)
            if received!=expected:raise ValueError('caption_download_size')
            if hasher.hexdigest()!=digest.lower():raise ValueError('caption_download_checksum')
            with self.lock:
                check_cancel(cancel)
                if target.exists():raise ValueError('caption_output_exists')
                self.path('models',m['path']);self.guard_model_mutation(target);temporary.replace(target)
            return {'bytes':received}
        finally:temporary.unlink(missing_ok=True)

    def copy_exclusive(self,m,cancel,record=None):
        if m.get('area')!='jobs':raise ValueError('caption_invalid')
        source=self.path('jobs',m.get('source'));media=self.external(m.get('videoPath'));name=m.get('name')
        if not isinstance(name,str) or not name or len(name)>240 or name in ('.','..') or any(c in name for c in '/\\:\x00') or name.rstrip(' .')!=name or any(ord(c)<32 for c in name) or re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',name):raise ValueError('caption_invalid')
        target=media.parent/name
        with self.lock:
            self.guard_decoder_mutation(target)
            if record is not None:record['writes']=[target]
        if is_link(target):raise ValueError('caption_invalid')
        owned=False
        try:
            with source.open('rb') as reader:
                try:writer=target.open('xb');owned=True
                except FileExistsError:raise ValueError('caption_output_exists')
                with writer:
                    while True:
                        check_cancel(cancel);data=reader.read(MAX_CHUNK)
                        if not data:break
                        writer.write(data)
                    writer.flush();os.fsync(writer.fileno())
            check_cancel(cancel);owned=False
            return {'name':name}
        finally:
            if owned:target.unlink(missing_ok=True)

    def close(self):
        with self.lock:
            self.stopping=True;scopes={r['scope'] for r in self.active.values()}|{r['scope'] for r in self.sessions.values()}|{r['scope'] for r in self.decoders.values() if not r['released']}
        for scope in scopes:self.cancel_scope(scope)


def caller_config(root,origin):
    manifest=json.loads((root/'com.mdownloader.captions.json').read_text('utf-8'))
    if not isinstance(origin,str) or not re.fullmatch(r'chrome-extension://[a-p]{32}/',origin) or origin not in manifest.get('allowed_origins',[]):raise ValueError('caption_origin')
    config=json.loads((root/'config.json').read_text('utf-8')) if (root/'config.json').exists() else {}
    return {**config,'originNamespace':origin[len('chrome-extension://'):-1]}


def main():
    if sys.platform=='win32':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    output_lock=threading.Lock()
    def emit(value):
        data=native_message_bytes(value)
        if len(data)>MAX_MESSAGE:raise ValueError('caption_protocol')
        with output_lock:sys.stdout.buffer.write(struct.pack('<I',len(data))+data);sys.stdout.buffer.flush()
    root=default_root().resolve()
    host=CaptionHost(root,emit,caller_config(root,sys.argv[1] if len(sys.argv)>1 else None))
    requests=ThreadPoolExecutor(max_workers=MAX_ACTIVE)
    def dispatch(message,reserved=None):
        try:emit({'id':message.get('id'),'ok':True,'data':host.handle(message,reserved)})
        except Exception as error:emit({'id':message.get('id'),'ok':False,'error':str(error) if str(error).startswith('caption_') else 'caption_native_failed'})
    try:
        while (message:=read_message(sys.stdin.buffer)) is not None:
            # Reserve before enqueue, allowing cancellation to see queued operations.
            if message.get('action')=='cancelExecution':dispatch(message)
            else:
                try:reserved=host.reserve(message)
                except Exception as error:emit({'id':message.get('id'),'ok':False,'error':str(error) if str(error).startswith('caption_') else 'caption_native_failed'})
                else:
                    try:requests.submit(dispatch,message,reserved)
                    except BaseException:host.finish(reserved);raise
    finally:
        # EOF means the caller is gone, so cancel and reap everything it owns.
        host.close();requests.shutdown(wait=True)

if __name__=='__main__':main()
