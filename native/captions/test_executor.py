import base64
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import os
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave
from host import CaptionHost, read_message


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.events = []
        self.host = CaptionHost(self.root, self.events.append, config={})
    def tearDown(self):
        self.host.close()
        self.temp.cleanup()
    def call(self, operation, **fields):
        return self.host.handle({'action':'execute','operation':operation,'scope':'job-1',**fields})
    def test_workflows_are_rejected(self):
        for action in ('begin','prepare','start','openConcurrent','saveResult','probe','prepareModel','finalizeConcurrent'):
            with self.assertRaisesRegex(ValueError,'caption_unsupported'):
                self.host.handle({'action':action,'jobId':'job-1'})
    def test_files_order_idempotency_and_bounded_read(self):
        fields={'area':'jobs','path':'j/input','offset':0,'data':base64.b64encode(b'hello').decode(),'truncate':True}
        self.assertEqual(self.call('write',**fields),{'offset':5})
        self.assertEqual(self.call('write',**fields),{'offset':5})
        self.assertEqual(self.call('read',area='jobs',path='j/input',offset=1,maxBytes=2),{'data':'ZWw=','offset':3,'done':False})
        with self.assertRaises(ValueError):self.call('write',**{**fields,'offset':9,'truncate':False})
        with self.assertRaises(ValueError):self.call('read',area='jobs',path='j/input',offset=0,maxBytes=262145)
        self.call('move',area='jobs',source='j/input',target='j/moved')
        self.assertEqual(self.call('stat',area='jobs',path='j/moved')['size'],5)
        self.assertEqual(self.call('list',area='jobs',path='j')['entries'][0]['name'],'moved')
        self.call('remove',area='jobs',path='j')
        self.assertFalse(self.call('stat',area='jobs',path='j')['exists'])
        self.assertFalse(list(self.root.rglob('state.json')))
    def test_traversal_root_and_redirected_paths_rejected(self):
        for path in ('../outside','/absolute','C:/outside','j/../outside','', '.', 'j:stream', 'j\\x'):
            with self.assertRaises(ValueError):self.call('remove',area='jobs',path=path)
        with self.assertRaises(ValueError):self.call('write',area='bad',path='a',offset=0,data='')
    def test_copy_collision_does_not_select_fallback(self):
        media=self.root/'movie.mp4';media.write_bytes(b'movie')
        self.call('write',area='jobs',path='j/result.srt',offset=0,data='aGVsbG8=',truncate=True)
        self.assertEqual(self.call('copyExclusive',area='jobs',source='j/result.srt',videoPath=str(media),name='movie.en.srt'),{'name':'movie.en.srt'})
        with self.assertRaisesRegex(ValueError,'caption_output_exists'):
            self.call('copyExclusive',area='jobs',source='j/result.srt',videoPath=str(media),name='movie.en.srt')
        self.assertFalse((self.root/'movie.en (1).srt').exists())
    def test_probe_is_primitive(self):
        value=self.call('probe',engine='faster-whisper')
        self.assertEqual(value['executionProtocol'],2)
        self.assertNotIn('models',value);self.assertNotIn('processing',value);self.assertNotIn('defaultOptions',value)
    def test_decode_exact_frame_chunks_and_trim(self):
        source=self.root/'tone.wav'
        with wave.open(str(source),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\x00\x00'*35000)
        result=self.call('decode',source={'external':str(source)},output='j/audio',rate=16000,chunkSeconds=1)
        self.assertEqual([v['frames'] for v in result['files']],[16000,16000,3000])
        trimmed=self.call('decode',source={'external':str(source)},output='j/trim',rate=16000,chunkSeconds=1,trim={'before':1000,'frames':16000,'expectedFrames':35000})
        self.assertEqual([v['frames'] for v in trimmed['files']],[16000])
        with self.assertRaisesRegex(ValueError,'caption_window_clock'):
            self.call('decode',source={'external':str(source)},output='j/bad',rate=16000,chunkSeconds=1,trim={'before':0,'frames':16000,'expectedFrames':35001})
    def test_cancel_waits_for_owned_operation_and_rejects_reuse(self):
        started=threading.Event();stopped=threading.Event();errors=[]
        original=self.host.execute
        def operation(message,record):
            if message['operation']=='httpJson':
                started.set()
                record['cancel'].wait(3)
                time.sleep(.05)
                stopped.set()
                raise InterruptedError('caption_canceled')
            return original(message,record)
        self.host.execute=operation
        def run():
            try:self.call('httpJson',url='https://example.test',maxBytes=100)
            except Exception as error:errors.append(str(error))
        worker=threading.Thread(target=run);worker.start();self.assertTrue(started.wait(1))
        self.assertEqual(self.host.handle({'action':'cancelExecution','scope':'job-1'}),{'canceled':True})
        self.assertTrue(stopped.is_set());worker.join(1);self.assertFalse(worker.is_alive())
        self.assertEqual(errors,['caption_canceled'])
        with self.assertRaises(InterruptedError):self.call('stat',area='jobs',path='j/file')
        self.assertFalse(self.events)
    def test_active_session_holds_package_and_shared_model_lock(self):
        model=self.root/'models'/'engine'/'custom';model.mkdir(parents=True);(model/'weights.bin').write_bytes(b'weights')
        class FakeSession:
            def __init__(inner,*args,**kwargs):inner.closed=False;args[-1](inner)
            def close(inner):inner.closed=True
        other=CaptionHost(self.root,lambda _:None,config={})
        try:
            with patch('host.InferenceSession',FakeSession):
                self.call('sessionOpen',sessionId='sess-1',engine='faster-whisper',model='engine/custom',recognition={},processing={},work='j/work')
            self.assertIsNotNone(self.host.package)
            with self.assertRaisesRegex(ValueError,'caption_busy'):
                self.call('remove',area='models',path='engine/custom')
            with self.assertRaisesRegex(ValueError,'caption_busy'):
                other.handle({'action':'execute','operation':'remove','scope':'other','area':'models','path':'engine/custom'})
            self.assertEqual(other.handle({'action':'execute','operation':'probe','scope':'probe','engine':'faster-whisper'})['executionProtocol'],2)
            self.call('sessionClose',sessionId='sess-1')
            self.assertIsNone(self.host.package)
            other.handle({'action':'execute','operation':'remove','scope':'other','area':'models','path':'engine/custom'})
        finally:other.close()
    def test_publish_rolls_back_failed_replacement(self):
        old=self.root/'models'/'old';new=self.root/'models'/'incoming'
        old.mkdir(parents=True);new.mkdir();(old/'file').write_bytes(b'old');(new/'file').write_bytes(b'new')
        original=Path.replace
        def replace(path,target):
            if path==new:raise OSError('simulated replacement failure')
            return original(path,target)
        with patch.object(Path,'replace',replace),self.assertRaises(OSError):
            self.call('publish',area='models',source='incoming',target='old')
        self.assertEqual((old/'file').read_bytes(),b'old')
        self.assertEqual((new/'file').read_bytes(),b'new')
        self.assertFalse(list((self.root/'models').glob('*.rollback-*')))
    def test_network_verifies_size_checksum_and_never_overwrites(self):
        import hashlib
        class Reply(io.BytesIO):url='https://example.test/model'
        payload=b'model bytes';opener=self.host.opener
        self.host.opener=type('Opener',(),{'open':lambda _,*args,**kwargs:Reply(payload)})()
        fields={'url':'https://example.test/model','area':'models','path':'stage/file','bytes':len(payload),'checksum':{'algorithm':'sha256','value':hashlib.sha256(payload).hexdigest()}}
        try:
            self.assertEqual(self.call('fetchFile',**fields),{'bytes':len(payload)})
            self.assertEqual(self.events[-1],{'event':'operationProgress','scope':'job-1','received':len(payload),'total':len(payload)})
            with self.assertRaisesRegex(ValueError,'caption_output_exists'):self.call('fetchFile',**fields)
            with self.assertRaisesRegex(ValueError,'caption_download_checksum'):
                self.call('fetchFile',**{**fields,'path':'stage/bad','checksum':{'algorithm':'sha256','value':'0'*64}})
            self.assertFalse((self.root/'models'/'stage'/'bad').exists())
            self.assertFalse(list(self.root.rglob('*.fetch-*')))
            with self.assertRaisesRegex(ValueError,'caption_download_size'):
                self.call('fetchFile',**{**fields,'path':'stage/oversize','bytes':len(payload)-1})
            with self.assertRaises(ValueError):self.call('httpJson',url='http://example.test',maxBytes=100)
        finally:self.host.opener=opener
    def test_authentication_isolated_jobs_and_existing_shared_models(self):
        from host import caller_config
        origin='chrome-extension://'+'a'*32+'/'
        (self.root/'com.mdownloader.captions.json').write_text(json.dumps({'allowed_origins':[origin]}),'utf-8')
        config=caller_config(self.root,origin)
        scoped=CaptionHost(self.root,lambda _:None,config)
        try:
            self.assertEqual(scoped.models,self.root/'models')
            self.assertEqual(scoped.jobs,self.root/'origins'/('a'*32)/'jobs')
            with self.assertRaises(ValueError):caller_config(self.root,'chrome-extension://'+'b'*32+'/')
        finally:scoped.close()
    def test_native_subprocess_framed_round_trip(self):
        origin='chrome-extension://'+'a'*32+'/'
        (self.root/'com.mdownloader.captions.json').write_text(json.dumps({'allowed_origins':[origin]}),'utf-8')
        command=[sys.executable,str(Path(__file__).with_name('host.py')),origin]
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            env={**os.environ,'MDOWNLOADER_CAPTION_HOME':str(self.root)},creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        timer=threading.Timer(15,process.kill);timer.start()
        def request(value):
            raw=json.dumps(value).encode();process.stdin.write(struct.pack('<I',len(raw))+raw);process.stdin.flush()
            prefix=process.stdout.read(4)
            self.assertEqual(len(prefix),4)
            length=struct.unpack('<I',prefix)[0]
            return json.loads(process.stdout.read(length))
        try:
            reply=request({'id':1,'action':'execute','operation':'probe','scope':'probe','engine':'faster-whisper'})
            self.assertTrue(reply['ok']);self.assertEqual(reply['data']['executionProtocol'],2)
            reply=request({'id':2,'action':'execute','operation':'write','scope':'j','area':'jobs','path':'j/opaque','offset':0,'data':'eA==','truncate':True})
            self.assertEqual(reply['data'],{'offset':1})
            self.assertEqual((self.root/'origins'/('a'*32)/'jobs'/'j'/'opaque').read_bytes(),b'x')
            reply=request({'id':3,'action':'start','jobId':'j'})
            self.assertFalse(reply['ok']);self.assertEqual(reply['error'],'caption_unsupported')
            process.stdin.close();self.assertEqual(process.wait(timeout=5),0)
        finally:
            timer.cancel()
            if process.poll() is None:process.kill();process.wait()
            if not process.stdin.closed:process.stdin.close()
            process.stdout.close();process.stderr.close()
    def test_usage_tolerates_a_file_removed_after_directory_enumeration(self):
        self.call('write',area='jobs',path='j/retained',offset=0,data='YWJj',truncate=True)
        self.call('write',area='jobs',path='j/state.json.tmp',offset=0,data='eA==',truncate=True)
        vanished=self.host.jobs/'j/state.json.tmp'
        original=Path.stat
        def changing_stat(path,*args,**kwargs):
            if path==vanished and kwargs.get('follow_symlinks',True):raise FileNotFoundError(2,'File removed after enumeration',str(path))
            return original(path,*args,**kwargs)
        with patch.object(Path,'stat',changing_stat):
            self.assertEqual(self.call('usage',area='jobs',path='j')['bytes'],3)
    def test_usage_does_not_hide_other_file_errors(self):
        self.call('write',area='jobs',path='j/unreadable',offset=0,data='eA==',truncate=True)
        unreadable=self.host.jobs/'j/unreadable'
        original=Path.stat
        def changing_stat(path,*args,**kwargs):
            if path==unreadable:raise PermissionError(str(path))
            return original(path,*args,**kwargs)
        with patch.object(Path,'stat',changing_stat):
            with self.assertRaises(PermissionError):self.call('usage',area='jobs',path='j')
    def test_usage_counts_only_requested_owned_tree(self):
        self.call('write',area='jobs',path='j/a',offset=0,data='YWJj',truncate=True)
        self.call('write',area='jobs',path='other/a',offset=0,data='eA==',truncate=True)
        value=self.call('usage',area='jobs',path='j')
        self.assertEqual(value['bytes'],3);self.assertGreater(value['free'],0)
        self.assertEqual(self.call('usage',area='jobs',path='')['bytes'],4)
        self.assertEqual(self.call('usage',area='models',path='')['bytes'],0)
    def test_decode_enforces_explicit_output_and_free_limits(self):
        source=self.root/'quota.wav'
        with wave.open(str(source),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\x00\x00'*32000)
        with self.assertRaisesRegex(ValueError,'caption_audio_limit'):
            self.call('decode',source={'external':str(source)},output='j/quota',rate=16000,chunkSeconds=1,maxOutputBytes=32044,minFreeBytes=0)
        self.assertFalse(list((self.root/'jobs'/'j'/'quota').glob('*.wav')))
        with self.assertRaisesRegex(ValueError,'caption_disk_full'):
            self.call('decode',source={'external':str(source)},output='j/free',rate=16000,chunkSeconds=1,maxOutputBytes=100000,minFreeBytes=9007199254740991)
    def test_installer_discovers_new_nested_modules_without_installer_edit(self):
        import install
        source=self.root/'source';target=self.root/'installed'
        (source/'runtime'/'nested').mkdir(parents=True)
        (source/'runtime'/'nested'/'new_module.py').write_text('VALUE=42','utf-8')
        (source/'runtime'/'nested'/'metadata.json').write_text('{}','utf-8')
        (source/'runtime'/'nested'/'ignored.exe').write_bytes(b'ignored')
        (source/'tests').mkdir();(source/'tests'/'private.py').write_text('no','utf-8')
        (source/'config.json').write_text('{"foreign":true}','utf-8')
        (target/'venv').mkdir(parents=True)
        with patch.object(install,'__file__',str(source/'install.py')),patch.object(install.sys,'platform','win32'),patch.object(install.subprocess,'run') as run:
            install._install('a'*32,target,register=False,dependencies=False)
        run.assert_not_called()
        self.assertEqual((target/'runtime'/'nested'/'new_module.py').read_text('utf-8'),'VALUE=42')
        self.assertTrue((target/'runtime'/'nested'/'metadata.json').is_file())
        self.assertFalse((target/'runtime'/'nested'/'ignored.exe').exists())
        self.assertFalse((target/'tests').exists())
        self.assertEqual(json.loads((target/'config.json').read_text('utf-8')),{})
    def test_probe_advertises_binding_and_cli_capabilities_separately(self):
        import engine
        with patch('engine.binding_capabilities',return_value={'persistentReady':False,'gpuToggleReady':False}),patch('engine.cli_capabilities',return_value=True):
            value=engine.probe({'whisperCli':'/chosen/cli'},'whisper.cpp')
        self.assertTrue(value['engineReady']);self.assertTrue(value['cliReady'])
        self.assertFalse(value['persistentReady']);self.assertFalse(value['gpuToggleReady'])
    def test_cli_adapter_maps_explicit_options_and_returns_detected_language(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('caption_worker',Path(__file__).with_name('cpp-worker.py'))
        worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
        audio=self.root/'clip.wav'
        with wave.open(str(audio),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\x00\x00'*16000)
        recognition={'cpuThreads':2,'beamSize':1,'bestOf':2,'temperature':0.2,'conditionOnPreviousText':False,'useGpu':False}
        processing={'sampleRate':16000,'chunkSeconds':30,'pollIntervalMs':10,'cancelGraceMs':100,'maxWorkerResultBytes':65536,'workerStartupMs':1000,'workerInferenceMs':1000}
        commands=[]
        class Process:
            returncode=0
            def __init__(inner,args,**kwargs):
                commands.append(args)
                output=Path(args[args.index('--output-file')+1]+'.json')
                output.write_text(json.dumps({'result':{'language':'ko'},'transcription':[{'offsets':{'from':0,'to':900},'text':'hello'}]}),'utf-8')
            def poll(inner):return 0
            def wait(inner,timeout=None):return 0
        adapter=worker.CliEngine('/chosen/whisper-cli',self.root/'model.bin',recognition,processing,self.root)
        try:
            with patch.object(worker.subprocess,'Popen',Process):value=adapter.infer(audio,'auto')
            self.assertEqual(value,{'language':'ko','segments':[[0.0,0.9,'hello']]})
            command=commands[0]
            for flag in ('--no-gpu','--beam-size','--best-of','--temperature','--temperature-inc','--max-context','--language','--threads','--output-json'):
                self.assertIn(flag,command)
            self.assertEqual(command[command.index('--max-context')+1],'0')
            self.assertEqual(command[command.index('--temperature-inc')+1],'0')
        finally:adapter.close()
    def test_cli_cancel_reaps_the_exact_owned_process(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('caption_worker_cancel',Path(__file__).with_name('cpp-worker.py'))
        worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
        audio=self.root/'cancel.wav'
        with wave.open(str(audio),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\x00\x00'*16000)
        r={'cpuThreads':1,'beamSize':1,'bestOf':1,'temperature':0,'conditionOnPreviousText':False,'useGpu':False}
        p={'sampleRate':16000,'chunkSeconds':30,'pollIntervalMs':10,'cancelGraceMs':100,'maxWorkerResultBytes':65536,'workerStartupMs':1000,'workerInferenceMs':1000}
        started=threading.Event();children=[];errors=[]
        class Process:
            def __init__(inner,*args,**kwargs):inner.alive=True;inner.waited=False;children.append(inner);started.set()
            def poll(inner):return None if inner.alive else -1
            def kill(inner):inner.alive=False
            def wait(inner,timeout=None):inner.waited=True;return -1
        adapter=worker.CliEngine('/chosen/cli',self.root/'model.bin',r,p,self.root)
        def infer():
            try:adapter.infer(audio,'auto')
            except Exception as error:errors.append(str(error))
        with patch.object(worker.subprocess,'Popen',Process):
            thread=threading.Thread(target=infer);thread.start();self.assertTrue(started.wait(1));adapter.close();thread.join(1)
        self.assertFalse(thread.is_alive());self.assertFalse(children[0].alive);self.assertTrue(children[0].waited)
        self.assertTrue(errors)
    def test_old_binding_reports_gpu_toggle_unsupported(self):
        import importlib.util
        import inspect
        import types
        spec=importlib.util.spec_from_file_location('caption_worker_cap',Path(__file__).with_name('cpp-worker.py'))
        worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
        package=types.ModuleType('pywhispercpp');package.__path__=[]
        model=types.ModuleType('pywhispercpp.model');model.Model=type('OldModel',(),{})
        low=types.ModuleType('_pywhispercpp');low.whisper_sampling_strategy=object()
        with patch.dict(sys.modules,{'pywhispercpp':package,'pywhispercpp.model':model,'_pywhispercpp':low}),patch.object(worker.inspect,'signature',return_value=inspect.Signature()):
            result=worker.capabilities('whisper.cpp')
        self.assertTrue(result['persistentReady']);self.assertFalse(result['gpuToggleReady'])
    def test_cpp_binding_refuses_directory_before_library_can_download(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('caption_worker_local_model',Path(__file__).with_name('cpp-worker.py'))
        worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
        with self.assertRaisesRegex(ValueError,'caption_model_missing'):
            worker.load_engine('whisper.cpp',self.root,{})
    def test_protocol_framing(self):
        value={'action':'execute','operation':'probe'};body=json.dumps(value).encode()
        self.assertEqual(read_message(io.BytesIO(struct.pack('<I',len(body))+body)),value)
        for body in (b'\x01',struct.pack('<I',99999999),struct.pack('<I',100)+b'{}'):
            with self.assertRaises(ValueError):read_message(io.BytesIO(body))

if __name__=='__main__':unittest.main()
