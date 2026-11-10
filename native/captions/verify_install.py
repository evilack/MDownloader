"""Verify primitive execution through the actual installed host; never fetch a model."""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading


def read_exact(stream,count):
    result=bytearray()
    while len(result)<count:
        part=stream.read(count-len(result))
        if not part:raise RuntimeError('caption_host_start_failed')
        result.extend(part)
    return bytes(result)


def main():
    root=Path(sys.argv[1]).resolve();env={**os.environ,'MDOWNLOADER_CAPTION_HOME':str(root)}
    manifest=json.loads((root/'com.mdownloader.captions.json').read_text('utf-8'))
    origin=manifest['allowed_origins'][0]
    engines=['whisper.cpp'] if sys.platform=='darwin' else ['faster-whisper','whisper.cpp']
    command=[str(root/'caption-host.cmd'),origin] if sys.platform=='win32' else [str(root/'caption-host'),origin]
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    timer=threading.Timer(120,process.kill);timer.start()
    try:
        for index,engine in enumerate(engines):
            body=json.dumps({'id':index+1,'action':'execute','operation':'probe','scope':'verify-'+str(index),'engine':engine}).encode()
            process.stdin.write(struct.pack('<I',len(body))+body);process.stdin.flush()
            size=struct.unpack('<I',read_exact(process.stdout,4))[0]
            if not 1<=size<=800000:raise RuntimeError('caption_host_protocol')
            reply=json.loads(read_exact(process.stdout,size));data=reply.get('data',{})
            if reply.get('id')!=index+1 or not reply.get('ok') or data.get('executionProtocol')!=2 or not data.get('engineReady') or not data.get('converterReady'):
                raise RuntimeError('caption_engine_verification_failed')
        process.stdin.close()
        if process.wait(timeout=15):raise RuntimeError('caption_host_start_failed')
    finally:
        timer.cancel()
        if process.poll() is None:process.kill();process.wait()
        process.stdout.close()
        if not process.stdin.closed:process.stdin.close()
    print(json.dumps({'verified':True,'engines':engines,'modelsDownloaded':False,'executionProtocol':2}))

if __name__=='__main__':main()
