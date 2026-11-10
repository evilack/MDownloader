"""Historical filename: persistent owned worker for both local speech engines.

stdin is exclusively a POSIX parent-life pipe. Bounded atomic control files
carry commands/results; optional engine imports are delayed until selection.
All recognition and processing settings are supplied by the caller.
"""
import argparse
import inspect
import json
import math
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
import wave
from engine import DownloadParentMonitor,atomic_json,safe_integer,validate_recognition,validate_processing


def load_engine(kind,model,recognition):
    if not model.is_absolute() or not model.exists() or kind=='whisper.cpp' and not model.is_file():raise ValueError('caption_model_missing')
    if kind=='faster-whisper':
        from faster_whisper import WhisperModel
        return WhisperModel(str(model),device=recognition['device'],compute_type=recognition['computeType'],
            local_files_only=True,cpu_threads=recognition['cpuThreads'])
    from _pywhispercpp import whisper_sampling_strategy
    from pywhispercpp.model import Model
    parameters=inspect.signature(Model).parameters;loader={}
    if 'context_params' in parameters:loader['context_params']={'use_gpu':recognition['useGpu']}
    elif not recognition['useGpu']:raise ValueError('caption_engine_options_unsupported')
    if 'redirect_whispercpp_logs_to' in parameters:loader['redirect_whispercpp_logs_to']=None
    strategy=whisper_sampling_strategy.WHISPER_SAMPLING_BEAM_SEARCH if recognition['beamSize']>1 else whisper_sampling_strategy.WHISPER_SAMPLING_GREEDY
    return Model(str(model),params_sampling_strategy=1 if recognition['beamSize']>1 else 0,strategy=strategy,
        n_threads=recognition['cpuThreads'],greedy={'best_of':recognition['bestOf']},beam_search={'beam_size':recognition['beamSize'],'patience':-1.0},
        # Reuse model weights, not the previous full() call's prompt. whisper.cpp
        # clears that prompt on entry with no_context; n_max_text_ctx below still
        # controls conditioning between decode steps inside this audio window.
        temperature=recognition['temperature'],temperature_inc=0.0,no_context=True,
        n_max_text_ctx=16384 if recognition['conditionOnPreviousText'] else 0,print_progress=False,print_realtime=False,print_timestamps=False,**loader)


def infer(engine,kind,path,language,recognition,processing,word_timestamps=False):
    with wave.open(str(path)) as source:
        if source.getnchannels()!=1 or source.getsampwidth()!=2 or source.getframerate()!=processing['sampleRate'] or source.getnframes()>processing['sampleRate']*processing['chunkSeconds']:
            raise ValueError('caption_audio_limit')
        duration=source.getnframes()/source.getframerate()
        if kind=='whisper.cpp':
            import numpy as np
            audio=np.frombuffer(source.readframes(source.getnframes()),dtype=np.int16).astype(np.float32)/32768
    if kind=='faster-whisper':
        result,info=engine.transcribe(str(path),language=None if language=='auto' else language,
            beam_size=recognition['beamSize'],best_of=recognition['bestOf'],temperature=recognition['temperature'],
            vad_filter=recognition['vadFilter'],condition_on_previous_text=recognition['conditionOnPreviousText'],word_timestamps=word_timestamps)
        result=list(result);language=info.language;segments=((float(s.start),float(s.end),s.text) for s in result)
        # Alignment uses NumPy scalars. Normalize adapter numeric facts before
        # the plain JSON protocol validates finite values and input bounds.
        words=[[float(w.start),float(w.end),w.word,index,float(w.probability)] for index,s in enumerate(result) for w in (s.words or [])] if word_timestamps else None
    else:
        if word_timestamps:raise ValueError('caption_alignment_unsupported')
        result=engine.transcribe(audio,language=language)
        segments=((s.t0/100,s.t1/100,s.text) for s in result)
        words=None
    if kind=='whisper.cpp' and language=='auto':
        # Read the language selected by this exact full() call, without a second
        # detection pass or treating a requested 'auto' as a detected language.
        try:
            import _pywhispercpp as low
            candidate=low.whisper_lang_str(low.whisper_full_lang_id(engine._ctx))
            if isinstance(candidate,bytes):candidate=candidate.decode('ascii')
            if isinstance(candidate,str) and candidate and len(candidate)<=35:language=candidate
        except (AttributeError,TypeError,ValueError):pass
    return checked_result(segments,language,duration,processing,words)


def checked_result(segments,language,duration,processing,words=None):
    output=[];size=0;indexes={}
    for original_index,(start,end,text) in enumerate(segments):
        if type(start) not in (int,float) or type(end) not in (int,float) or not math.isfinite(start+end) or not isinstance(text,str):raise ValueError('caption_inference_result')
        if start<0 or end<start or end>duration+(0 if words is not None else 1):raise ValueError('caption_result_timestamp')
        if words is None:start=min(duration,start);end=min(duration,end)
        item=[start,end,text];size+=len(json.dumps(item,ensure_ascii=False).encode('utf-8'))+2
        if size>processing['maxWorkerResultBytes']-4096:raise ValueError('caption_result_limit')
        if end>start:indexes[original_index]=len(output);output.append(item)
    value={'language':language,'segments':output}
    if words is not None:
        aligned=[]
        for start,end,text,index,probability in words:
            if type(start) not in (int,float) or type(end) not in (int,float) or not math.isfinite(start+end) or not isinstance(text,str) or type(index) is not int or type(probability) not in (int,float) or not math.isfinite(probability) or not 0<=probability<=1:raise ValueError('caption_inference_result')
            if start<0 or end<start or end>duration:raise ValueError('caption_result_timestamp')
            if index not in indexes:
                if text.strip():raise ValueError('caption_alignment_missing')
                continue
            aligned.append([start,end,text,indexes[index],probability])
        value['words']=aligned
        if len(json.dumps(value,ensure_ascii=False).encode('utf-8'))>processing['maxWorkerResultBytes']-4096:raise ValueError('caption_result_limit')
    return value


def error_code(error):
    text=str(error)
    return text if text.startswith('caption_') else 'caption_recognition_failed'


class CliEngine:
    """One explicit WAV command at a time, owned by this monitored worker."""
    def __init__(self,cli,model,recognition,processing,directory):
        self.cli=str(cli);self.model=Path(model);self.recognition=recognition;self.processing=processing;self.directory=Path(directory)
        self.lock=threading.RLock();self.process=None;self.closed=False;self.sequence=0

    def infer(self,path,language):
        with wave.open(str(path)) as wav:
            if wav.getnchannels()!=1 or wav.getsampwidth()!=2 or wav.getframerate()!=self.processing['sampleRate'] or wav.getnframes()>self.processing['sampleRate']*self.processing['chunkSeconds']:raise ValueError('caption_audio_limit')
            duration=wav.getnframes()/wav.getframerate()
        self.sequence+=1;base=self.directory/('cli-'+str(self.sequence));output=base.with_suffix('.json');log=base.with_suffix('.log');r=self.recognition
        command=[self.cli,'--model',str(self.model),'--file',str(path),'--language',language,'--threads',str(r['cpuThreads']),
            '--best-of',str(r['bestOf']),'--beam-size',str(r['beamSize']),'--temperature',str(r['temperature']),'--temperature-inc','0',
            '--max-context','16384' if r['conditionOnPreviousText'] else '0','--output-json','--output-file',str(base)]
        if not r['useGpu']:command+=['--no-gpu']
        deadline=time.monotonic()+self.processing['workerInferenceMs']/1000
        try:
            with log.open('wb') as diagnostics:
                with self.lock:
                    if self.closed:raise InterruptedError('caption_canceled')
                    self.process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=diagnostics,stderr=diagnostics,
                        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                    process=self.process
                while process.poll() is None:
                    if self.closed:raise InterruptedError('caption_canceled')
                    if time.monotonic()>deadline:raise ValueError('caption_worker_timeout')
                    if log.stat().st_size>8*1024*1024:raise ValueError('caption_result_limit')
                    if output.exists() and output.stat().st_size>self.processing['maxWorkerResultBytes']:raise ValueError('caption_result_limit')
                    time.sleep(self.processing['pollIntervalMs']/1000)
                if process.wait() or self.closed:raise ValueError('caption_process_failed')
            if not output.is_file() or output.stat().st_size>self.processing['maxWorkerResultBytes']:raise ValueError('caption_result_limit')
            value=json.loads(output.read_text('utf-8'));items=value.get('transcription')
            if not isinstance(items,list):raise ValueError('caption_worker_protocol')
            result_language=value.get('result',{}).get('language',language)
            if not isinstance(result_language,str) or len(result_language)>35:raise ValueError('caption_worker_protocol')
            segments=((item['offsets']['from']/1000,item['offsets']['to']/1000,item['text']) for item in items)
            return checked_result(segments,result_language,duration,self.processing)
        finally:
            with self.lock:
                if self.process is not None:
                    if self.process.poll() is None:self.process.kill()
                    self.process.wait(timeout=self.processing['cancelGraceMs']/1000);self.process=None
            output.unlink(missing_ok=True);log.unlink(missing_ok=True)

    def close(self):
        with self.lock:
            self.closed=True
            if self.process is not None:
                if self.process.poll() is None:self.process.kill()
                self.process.wait(timeout=self.processing['cancelGraceMs']/1000)


def capabilities(kind):
    try:
        if kind=='faster-whisper':
            from faster_whisper import WhisperModel
            return {'persistentReady':True,'gpuToggleReady':True}
        if kind!='whisper.cpp':raise ValueError('caption_invalid')
        from pywhispercpp.model import Model
        from _pywhispercpp import whisper_sampling_strategy
        return {'persistentReady':True,'gpuToggleReady':'context_params' in inspect.signature(Model).parameters}
    except Exception:return {'persistentReady':False,'gpuToggleReady':False}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--model',required=True)
    parser.add_argument('--recognition',required=True);parser.add_argument('--processing',required=True);parser.add_argument('--session',type=Path,required=True)
    parser.add_argument('--engine',choices=('faster-whisper','whisper.cpp'),required=True)
    parser.add_argument('--backend',choices=('binding','cli'),required=True);parser.add_argument('--cli')
    parser.add_argument('parent_handle',type=int,nargs='?',default=0);parser.add_argument('cancel_handle',type=int,nargs='?',default=0)
    args=parser.parse_args();recognition=validate_recognition(json.loads(args.recognition),args.engine);processing=validate_processing(json.loads(args.processing))
    directory=args.session.resolve();cli_engine=None
    if args.backend=='cli':
        if args.engine!='whisper.cpp' or not args.cli or not Path(args.cli).is_file():raise ValueError('caption_engine_missing')
        cli_engine=CliEngine(args.cli,Path(args.model),recognition,processing,directory)
    monitor=DownloadParentMonitor(args.parent_handle,args.cancel_handle,cli_engine.close if cli_engine else None)
    sequence=0
    try:
        monitor.start();engine=cli_engine if cli_engine else load_engine(args.engine,Path(args.model),recognition)
        atomic_json(directory/'ready.json',{'ready':True})
        while True:
            if monitor.errors:raise ValueError('caption_worker_monitor_failed')
            request=directory/'request.json'
            if not request.is_file():time.sleep(processing['pollIntervalMs']/1000);continue
            if request.stat().st_size>16384:raise ValueError('caption_worker_protocol')
            value=json.loads(request.read_text('utf-8'));request.unlink()
            next_sequence=safe_integer(value.get('sequence'),1)
            if next_sequence!=sequence+1:raise ValueError('caption_worker_protocol')
            sequence=next_sequence;response=directory/('response-'+str(sequence)+'.json')
            try:
                audio=Path(value['audio'])
                if not audio.is_absolute() or not audio.is_file():raise ValueError('caption_invalid')
                language=value.get('language')
                if not isinstance(language,str) or len(language)>35:raise ValueError('caption_invalid')
                word_timestamps=value.get('wordTimestamps',False)
                if type(word_timestamps) is not bool:raise ValueError('caption_invalid')
                if cli_engine and word_timestamps:raise ValueError('caption_alignment_unsupported')
                result=cli_engine.infer(audio,language) if cli_engine else infer(engine,args.engine,audio,language,recognition,processing,word_timestamps)
                atomic_json(response,{'sequence':sequence,**result})
            except Exception as error:atomic_json(response,{'sequence':sequence,'error':error_code(error)})
    except Exception as error:
        atomic_json(directory/('ready.json' if sequence==0 else 'response-'+str(sequence)+'.json'),{'sequence':sequence,'error':error_code(error)})
        raise SystemExit(2)
    finally:
        if cli_engine:cli_engine.close()
        monitor.close()


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--capabilities':print(json.dumps(capabilities(sys.argv[2])))
    else:main()
