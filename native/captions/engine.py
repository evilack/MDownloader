"""Physical executor utilities. Product policy is supplied by the extension."""
import importlib.util
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import uuid
import wave

CREATE_NO_WINDOW=getattr(subprocess,'CREATE_NO_WINDOW',0)
CAPTION_PACKAGE_VERSION=json.loads(Path(__file__).with_name('bootstrap.json').read_text('utf-8'))['packageVersion']

class FileLease:
    """OS-owned byte/flock lock, released even when its owning process dies."""
    def __init__(self,path):
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        if is_link(path):raise ValueError('caption_invalid')
        self.file=path.open('a+b')
        try:
            if sys.platform=='win32':
                import msvcrt
                self.file.seek(0);msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.file.close();raise ValueError('caption_busy')

    def close(self):
        if not self.file.closed:self.file.close()

class PackageLease:
    """Same lock as both bootstrap scripts; child installers inherit its nonce."""
    def __init__(self,root,inherit=False):
        root=Path(root).resolve();self.lease=None
        inherited=os.environ.get('MDOWNLOADER_CAPTION_PACKAGE_TOKEN')
        if inherit and inherited and os.path.normcase(os.environ.get('MDOWNLOADER_CAPTION_PACKAGE_ROOT',''))==os.path.normcase(str(root)):
            owner=root/'.package-owner'
            if owner.is_file() and owner.read_text('utf-8').strip()==inherited:return
            raise ValueError('caption_busy')
        self.lease=FileLease(root/'.package.lock')

    def close(self):
        if self.lease:self.lease.close()

def safe_integer(value,minimum=0,maximum=9007199254740991):
    if type(value) is not int or not minimum<=value<=maximum:raise ValueError('caption_invalid')
    return value

@lru_cache(maxsize=1)
def _snapshot_windows_api():
    import ctypes
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,wintypes.LPVOID,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
    kernel.CreateFileW.restype=wintypes.HANDLE
    kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle.restype=wintypes.BOOL
    kernel.SetFileInformationByHandle.argtypes=[wintypes.HANDLE,ctypes.c_int,wintypes.LPVOID,wintypes.DWORD]
    kernel.SetFileInformationByHandle.restype=wintypes.BOOL
    class RenameInfo(ctypes.Structure):
        _fields_=[('Flags',wintypes.DWORD),('RootDirectory',wintypes.HANDLE),('FileNameLength',wintypes.DWORD),('FileName',wintypes.WCHAR*1)]
    return kernel,RenameInfo


def open_snapshot(path):
    """Read the opened file version without preventing its atomic replacement."""
    path=Path(path)
    if sys.platform!='win32':return path.open('rb')
    import ctypes
    import msvcrt
    kernel,_=_snapshot_windows_api()
    handle=kernel.CreateFileW(str(path),0x80000000,0x1|0x2|0x4,None,3,0x80,None)
    if handle==ctypes.c_void_p(-1).value:raise ctypes.WinError(ctypes.get_last_error())
    try:descriptor=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY)
    except BaseException:
        kernel.CloseHandle(handle);raise
    try:return os.fdopen(descriptor,'rb')
    except BaseException:
        os.close(descriptor);raise


def _replace_snapshot(source,target):
    if sys.platform=='win32':
        import ctypes
        kernel,RenameInfo=_snapshot_windows_api()
        handle=kernel.CreateFileW(str(source.absolute()),0x10000,0x1|0x2|0x4,None,3,0x80,None)
        if handle==ctypes.c_void_p(-1).value:raise ctypes.WinError(ctypes.get_last_error())
        try:
            name=str(target.absolute()).encode('utf-16-le')
            size=RenameInfo.FileName.offset+len(name)+ctypes.sizeof(ctypes.c_wchar)
            buffer=ctypes.create_string_buffer(max(ctypes.sizeof(RenameInfo),size))
            info=RenameInfo.from_buffer(buffer)
            # REPLACE_IF_EXISTS | POSIX_SEMANTICS: old readers keep their file
            # version; new readers can immediately open the replacement.
            info.Flags=0x1|0x2;info.RootDirectory=None;info.FileNameLength=len(name)
            ctypes.memmove(ctypes.addressof(buffer)+RenameInfo.FileName.offset,name,len(name))
            # FileRenameInfoEx. No retry/fallback after an uncertain write.
            if not kernel.SetFileInformationByHandle(handle,22,buffer,size):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:kernel.CloseHandle(handle)
    else:source.replace(target)


def atomic_json(path,value):
    temporary=path.with_name(path.name+'.tmp-'+uuid.uuid4().hex)
    try:temporary.write_text(json.dumps(value,ensure_ascii=False),'utf-8')
    except BaseException:
        temporary.unlink(missing_ok=True);raise
    # A failed replacement can have an uncertain disposition. Preserve its
    # owned payload for diagnosis instead of retrying or deleting it blindly.
    _replace_snapshot(temporary,path)

def executable(config, key, fallback):
    value=config.get(key)
    if value:return str(Path(value).resolve()) if Path(value).is_file() else None
    found=shutil.which(fallback)
    if found:return found
    if key=='ffmpeg':
        try:
            import imageio_ffmpeg
            found=imageio_ffmpeg.get_ffmpeg_exe()
            return found if Path(found).is_file() else None
        except (ImportError,RuntimeError):pass
    return None

def is_link(path):
    return path.is_symlink() or bool(getattr(path,'is_junction',lambda:False)())

def check_cancel(cancel):
    if cancel.is_set():raise InterruptedError('caption_canceled')

def windows_process_api():
    import ctypes
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.WaitForMultipleObjects.argtypes=[wintypes.DWORD,ctypes.POINTER(wintypes.HANDLE),wintypes.BOOL,wintypes.DWORD];kernel.WaitForMultipleObjects.restype=wintypes.DWORD
    kernel.CreateEventW.argtypes=[wintypes.LPVOID,wintypes.BOOL,wintypes.BOOL,wintypes.LPCWSTR];kernel.CreateEventW.restype=wintypes.HANDLE
    kernel.SetEvent.argtypes=[wintypes.HANDLE];kernel.SetEvent.restype=wintypes.BOOL
    kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle.restype=wintypes.BOOL
    return ctypes,kernel

def spawn_owned_worker(command,stderr):
    if sys.platform!='win32':
        return subprocess.Popen(command+['0','0'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=stderr,close_fds=True),None,None
    ctypes,kernel=windows_process_api()
    # SYNCHRONIZE access only. Pass an inherited handle to this exact process,
    # never a PID which could be recycled before the child starts monitoring.
    parent=kernel.OpenProcess(0x00100000,True,os.getpid())
    if not parent:raise ctypes.WinError(ctypes.get_last_error())
    cancel_event=None
    try:
        cancel_event=kernel.CreateEventW(None,True,False,None)
        if not cancel_event:raise ctypes.WinError(ctypes.get_last_error())
        os.set_handle_inheritable(cancel_event,True)
        startup=subprocess.STARTUPINFO();startup.lpAttributeList={'handle_list':[parent,cancel_event]}
        process=subprocess.Popen(command+[str(parent),str(cancel_event)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=stderr,
            close_fds=True,startupinfo=startup,creationflags=CREATE_NO_WINDOW)
        return process,kernel,cancel_event
    except BaseException:
        if cancel_event:kernel.CloseHandle(cancel_event)
        raise
    finally:kernel.CloseHandle(parent)

class DownloadParentMonitor:
    def __init__(self,parent_handle,cancel_handle,on_parent_exit=None):
        self.on_parent_exit=on_parent_exit
        self.parent_handle=parent_handle;self.cancel_handle=cancel_handle;self.stop=threading.Event();self.errors=[];self.thread=None;self.kernel=None

    def start(self):
        if sys.platform=='win32':
            self.ctypes,self.kernel=windows_process_api()
            if self.parent_handle<=0 or self.cancel_handle<=0:raise ValueError('caption_model_monitor_failed')
            self.handles=(self.ctypes.c_void_p*2)(self.parent_handle,self.cancel_handle)
            # The venv redirector already passed the handles to this interpreter.
            # Do not let any subsequent subprocess inherit them again.
            os.set_handle_inheritable(self.parent_handle,False);os.set_handle_inheritable(self.cancel_handle,False)
        else:
            import select
            self.select=select.select;self.fd=sys.stdin.fileno()
        self.thread=threading.Thread(target=self.watch,name='caption-parent-monitor',daemon=False)
        self.thread.start()

    def watch(self):
        try:
            while not self.stop.is_set():
                if self.kernel is not None:
                    result=self.kernel.WaitForMultipleObjects(2,self.handles,False,100)
                    if result in (0,1):
                        if not self.stop.is_set():self.parent_exit() # Exit only this canceled/orphan worker.
                        return
                    if result==258:continue # WAIT_TIMEOUT
                    if result==0xffffffff:raise self.ctypes.WinError(self.ctypes.get_last_error())
                    raise ValueError('caption_model_monitor_failed')
                try:
                    ready,_,_=self.select([self.fd],[],[],.1)
                    if ready and not os.read(self.fd,1):
                        if not self.stop.is_set():self.parent_exit()
                        return
                except InterruptedError:continue
        except Exception as error:self.errors.append(error)

    def parent_exit(self):
        try:
            if self.on_parent_exit:self.on_parent_exit()
        finally:os._exit(1)

    def close(self):
        self.stop.set()
        if self.thread is not None and self.thread.ident is not None:self.thread.join()
        if self.kernel is not None:
            for handle in (self.parent_handle,self.cancel_handle):
                if handle>0 and not self.kernel.CloseHandle(handle):self.errors.append(self.ctypes.WinError(self.ctypes.get_last_error()))
            self.parent_handle=self.cancel_handle=0

def run_process(args,cancel,log_path,monitor=None):
    with log_path.open('wb') as log:
        process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=CREATE_NO_WINDOW)
        try:
            while process.poll() is None:
                check_cancel(cancel)
                if monitor:monitor()
                time.sleep(.1)
            if process.returncode:raise RuntimeError('caption_process_failed')
        finally:
            if process.poll() is None:
                process.kill();process.wait()

def validate_recognition(value,engine):
    if not isinstance(value,dict):raise ValueError('caption_invalid')
    common={'cpuThreads','beamSize','bestOf','temperature','conditionOnPreviousText'}
    fields=common|({'device','computeType','vadFilter'} if engine=='faster-whisper' else {'useGpu'})
    if not fields.issubset(value):raise ValueError('caption_invalid')
    result={key:value[key] for key in fields}
    for key,limit in (('cpuThreads',256),('beamSize',8 if engine=='whisper.cpp' else 64),('bestOf',8 if engine=='whisper.cpp' else 64)):
        safe_integer(result[key],1,limit)
    if type(result['temperature']) not in (int,float) or not math.isfinite(result['temperature']) or not 0<=result['temperature']<=1:raise ValueError('caption_invalid')
    if type(result['conditionOnPreviousText']) is not bool:raise ValueError('caption_invalid')
    if engine=='faster-whisper':
        if result['device'] not in ('cpu','cuda','auto') or result['computeType'] not in ('auto','default','int8','int8_float16','float16','float32') or type(result['vadFilter']) is not bool:raise ValueError('caption_invalid')
    elif type(result['useGpu']) is not bool:raise ValueError('caption_invalid')
    return result


def validate_processing(value):
    if not isinstance(value,dict):raise ValueError('caption_invalid')
    limits={'sampleRate':(8000,192000),'chunkSeconds':(1,3600),'pollIntervalMs':(10,10000),'cancelGraceMs':(10,60000),
        'maxWorkerResultBytes':(4096,64*1024*1024),'workerStartupMs':(100,3600000),'workerInferenceMs':(100,86400000)}
    for key,(minimum,maximum) in limits.items():safe_integer(value.get(key),minimum,maximum)
    return dict(value)


@lru_cache(maxsize=2)
def binding_capabilities(engine):
    try:
        result=subprocess.run([sys.executable,str(Path(__file__).with_name('cpp-worker.py')),'--capabilities',engine],
            stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20,creationflags=CREATE_NO_WINDOW)
        if result.returncode or len(result.stdout)>16384:raise ValueError('caption_worker_protocol')
        value=json.loads(result.stdout.decode('utf-8').strip().splitlines()[-1])
        return {'persistentReady':value.get('persistentReady') is True,'gpuToggleReady':value.get('gpuToggleReady') is True}
    except Exception:return {'persistentReady':False,'gpuToggleReady':False}


@lru_cache(maxsize=4)
def _cli_capabilities(path,mtime,size):
    try:
        result=subprocess.run([path,'--help'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
            timeout=10,creationflags=CREATE_NO_WINDOW)
        if result.returncode not in (0,1) or len(result.stdout)>256*1024:return False
        text=result.stdout.decode('utf-8','replace')
        return all(flag in text for flag in ('--output-json','--output-file','--threads','--language','--best-of','--beam-size',
            '--temperature','--temperature-inc','--max-context','--no-gpu'))
    except Exception:return False


def cli_capabilities(config):
    path=executable(config,'whisperCli','whisper-cli')
    if not path:return False
    info=Path(path).stat()
    return _cli_capabilities(path,info.st_mtime_ns,info.st_size)


def probe(config,engine):
    if engine not in ('faster-whisper','whisper.cpp'):raise ValueError('caption_invalid')
    binding=binding_capabilities(engine);cli=engine=='whisper.cpp' and cli_capabilities(config)
    return {'connected':True,'executionProtocol':2,'captionPackageVersion':CAPTION_PACKAGE_VERSION,
        **binding,'cliReady':cli,'engineReady':binding['persistentReady'] or cli,
        'converterReady':bool(executable(config,'ffmpeg','ffmpeg')),
        **({'avDecodeStreamVersion':2} if importlib.util.find_spec('av') is not None else {}),
        'wordTimestampsVersion':1 if engine=='faster-whisper' and binding['persistentReady'] else 0,
        'platform':'win' if sys.platform=='win32' else 'mac' if sys.platform=='darwin' else 'linux'}


def decode_audio(source,directory,config,cancel,rate,chunk_seconds,trim=None,align_origin=False,max_output_bytes=None,min_free_bytes=None):
    """Stream bounded PCM blocks into exact-sized WAVs; no whole-video PCM file."""
    import queue
    if type(align_origin) is not bool:raise ValueError('caption_invalid')
    output_limit=safe_integer(max_output_bytes,1,20*1024**3) if max_output_bytes is not None else 2*1024**3
    free_limit=safe_integer(min_free_bytes,0) if min_free_bytes is not None else 64*1024*1024
    rate=safe_integer(rate,8000,192000);chunk_seconds=safe_integer(chunk_seconds,1,3600)
    if trim is not None:
        if not isinstance(trim,dict):raise ValueError('caption_invalid')
        before=safe_integer(trim.get('before'),0,192000*3600)
        frames=safe_integer(trim.get('frames'),1,192000*3600)
        expected=safe_integer(trim.get('expectedFrames'),1,192000*7200)
        if before+frames>expected:raise ValueError('caption_invalid')
    ffmpeg=executable(config,'ffmpeg','ffmpeg')
    if not ffmpeg:raise ValueError('caption_converter_missing')
    directory.mkdir(parents=True,exist_ok=True)
    if any(directory.iterdir()):raise ValueError('caption_output_exists')
    created=[];log=directory/'decode.log';stream=None;wav=None;current_frames=0;total=0;selected=0
    maximum=(expected+rate)*2 if trim is not None else 2*1024**3
    packets=queue.Queue(maxsize=2);reader_stop=threading.Event()
    process=None;reader=None
    def offer(value):
        while not reader_stop.is_set():
            try:packets.put(value,timeout=.1);return
            except queue.Full:continue
    def read_pipe():
        try:
            while not reader_stop.is_set():
                data=process.stdout.read(65536)
                if not data:break
                offer(data)
        except Exception as error:offer(error)
        finally:offer(None)
    def finish_wav():
        nonlocal wav,stream,current_frames
        if wav is not None:wav.close();wav=None
        if stream is not None:stream.close();stream=None
        current_frames=0
    try:
        with log.open('wb') as diagnostics:
            command=[ffmpeg,'-nostdin','-v','error','-protocol_whitelist','file,pipe']
            if align_origin:command+=['-copyts','-start_at_zero']
            command+=['-i',str(source),'-map','0:a:0','-vn']
            if align_origin:command+=['-af','aresample=async=1:first_pts=0']
            command+=['-ar',str(rate),'-ac','1','-c:a','pcm_s16le','-f','s16le','pipe:1']
            process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                stderr=diagnostics,creationflags=CREATE_NO_WINDOW)
            reader=threading.Thread(target=read_pipe,name='caption-pcm-reader',daemon=True);reader.start()
            pending=b''
            while True:
                check_cancel(cancel)
                try:data=packets.get(timeout=.1)
                except queue.Empty:continue
                if data is None:break
                if isinstance(data,Exception):raise data
                data=pending+data;pending=data[-1:] if len(data)%2 else b''
                data=data[:len(data)-len(pending)]
                start=total;count=len(data)//2;total+=count
                if total*2>maximum:raise ValueError('caption_audio_limit')
                if shutil.disk_usage(directory).free<free_limit:raise ValueError('caption_disk_full')
                if log.stat().st_size>1024*1024:raise ValueError('caption_process_failed')
                lower=max(start,before) if trim is not None else start
                upper=min(total,before+frames) if trim is not None else total
                if upper<=lower:continue
                block=memoryview(data)[(lower-start)*2:(upper-start)*2]
                estimated_files=(selected+len(block)//2+rate*chunk_seconds-1)//(rate*chunk_seconds)
                if (selected+len(block)//2)*2+estimated_files*44>output_limit:raise ValueError('caption_audio_limit')
                while block:
                    check_cancel(cancel)
                    if wav is None:
                        path=directory/('part-%06d.wav'%len(created));stream=path.open('xb')
                        created.append({'path':path,'frames':0,'rate':rate});wav=wave.open(stream,'wb')
                        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate)
                    available=rate*chunk_seconds-current_frames;take=min(available,len(block)//2)
                    wav.writeframesraw(block[:take*2]);block=block[take*2:];current_frames+=take;selected+=take
                    created[-1]['frames']+=take
                    if current_frames==rate*chunk_seconds:finish_wav()
            finish_wav()
            if pending:raise ValueError('caption_audio_limit')
            if process.wait(timeout=10):raise RuntimeError('caption_process_failed')
            if trim is not None and (total!=expected or selected!=frames):raise ValueError('caption_window_clock')
            if not selected:raise ValueError('caption_no_audio')
        return created
    except BaseException:
        finish_wav()
        for entry in created:entry['path'].unlink(missing_ok=True)
        raise
    finally:
        reader_stop.set()
        if process is not None:
            if process.poll() is None:process.kill()
            process.wait(timeout=10)
            if process.stdout:process.stdout.close()
        if reader is not None:reader.join(timeout=10)
        log.unlink(missing_ok=True)


class InferenceSession:
    """An owned model process; explicit engine inputs only, no application workflow."""
    def __init__(self,engine,model,recognition,processing,work,cancel,ready=None,*,backend="binding",cli=None):
        if engine not in ('faster-whisper','whisper.cpp') or backend not in ('binding','cli') or backend=='cli' and (engine!='whisper.cpp' or not cli):raise ValueError('caption_invalid')
        self.processing=validate_processing(processing);recognition=validate_recognition(recognition,engine)
        self.cancel=cancel;self.directory=Path(work)/('worker-'+uuid.uuid4().hex);self.directory.mkdir(parents=True)
        self.sequence=0;self.closed=False;self.stopped=False;self.process=None;self.kernel=None;self.cancel_event=None;self.log=None
        self.io_lock=threading.Lock();self.close_lock=threading.RLock()
        try:
            if ready:ready(self)
            check_cancel(cancel)
            command=[sys.executable,'-X','faulthandler',str(Path(__file__).with_name('cpp-worker.py')),'--session',str(self.directory),
                '--engine',engine,'--backend',backend,'--model',str(model),'--recognition',json.dumps(recognition),'--processing',json.dumps(self.processing)]
            if backend=='cli':command+=['--cli',str(cli)]
            with self.close_lock:
                check_cancel(cancel)
                if self.closed:raise InterruptedError('caption_canceled')
                self.log=(self.directory/'worker.log').open('wb');self.process,self.kernel,self.cancel_event=spawn_owned_worker(command,self.log)
            self.wait_response(self.directory/'ready.json',self.processing['workerStartupMs'])
        except BaseException:self.close();raise

    def wait_response(self,path,timeout):
        deadline=time.monotonic()+timeout/1000
        while True:
            check_cancel(self.cancel)
            if path.is_file():
                if path.stat().st_size>self.processing['maxWorkerResultBytes']:raise ValueError('caption_result_limit')
                value=json.loads(path.read_text('utf-8'))
                if value.get('error'):raise ValueError(value['error'])
                return value
            if self.closed or self.process.poll() is not None:raise ValueError('caption_worker_exited')
            if time.monotonic()>deadline:raise ValueError('caption_worker_timeout')
            self.cancel.wait(self.processing['pollIntervalMs']/1000)

    def infer(self,audio,language,word_timestamps=False):
        with self.io_lock:
            check_cancel(self.cancel)
            if self.closed:raise InterruptedError('caption_canceled')
            self.sequence+=1;sequence=self.sequence;response=self.directory/('response-'+str(sequence)+'.json')
            try:
                atomic_json(self.directory/'request.json',{'sequence':sequence,'audio':str(audio),'language':language,'wordTimestamps':word_timestamps})
                value=self.wait_response(response,self.processing['workerInferenceMs'])
                if value.get('sequence')!=sequence or not isinstance(value.get('segments'),list):raise ValueError('caption_inference_result')
                response.unlink(missing_ok=True)
                return value
            except BaseException:self.close();raise

    def close(self):
        with self.close_lock:
            if self.stopped:return
            self.closed=True
            if self.process:
                if self.process.poll() is None:
                    if self.cancel_event:self.kernel.SetEvent(self.cancel_event)
                    if self.process.stdin:self.process.stdin.close()
                    try:self.process.wait(timeout=self.processing['cancelGraceMs']/1000)
                    except subprocess.TimeoutExpired:self.process.kill();self.process.wait(timeout=self.processing['cancelGraceMs']/1000)
                self.process.wait(timeout=self.processing['cancelGraceMs']/1000)
            if self.cancel_event:
                if not self.kernel.CloseHandle(self.cancel_event):
                    import ctypes
                    raise ctypes.WinError(ctypes.get_last_error())
                self.cancel_event=None
            if self.log:self.log.close();self.log=None
            try:self.directory.lstat()
            except FileNotFoundError:pass # This session's owned directory is already gone.
            else:
                if is_link(self.directory):raise ValueError('caption_invalid')
                shutil.rmtree(self.directory)
            # A retry must finish any failed handle/log/path cleanup before success.
            self.stopped=True
