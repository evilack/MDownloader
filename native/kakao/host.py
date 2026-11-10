"""Versioned native bridge for bounded process enumeration and header observation.

No observed headers or credentials are logged. Product policy is supplied by the
authenticated extension as declarative data, never as JavaScript or shell text.
"""
import json
import re
import struct
import sys
import threading
from pathlib import Path

CAPTURE_PROTOCOL = 2
MAX_HEADERS = 65536


def send(value):
    payload = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if len(payload) > 1048576:
        raise ValueError('response_too_large')
    sys.stdout.buffer.write(struct.pack('<I', len(payload)) + payload)
    sys.stdout.buffer.flush()


def read_exact(size):
    result = bytearray()
    while len(result) < size:
        part = sys.stdin.buffer.read(size - len(result))
        if not part:
            raise EOFError()
        result.extend(part)
    return bytes(result)


def receive():
    size = struct.unpack('<I', read_exact(4))[0]
    if not 1 <= size <= 16384:
        raise ValueError('invalid_message')
    value = json.loads(read_exact(size))
    if not isinstance(value, dict):
        raise ValueError('invalid_message')
    return value


def authorize(origin, manifest_path=None):
    if not isinstance(origin, str) or not re.fullmatch(r'chrome-extension://[a-p]{32}/', origin):
        raise ValueError('origin_denied')
    manifest = json.loads((manifest_path or Path(__file__).with_name('host-manifest.json')).read_text(encoding='utf-8-sig'))
    if origin not in manifest.get('allowed_origins', []):
        raise ValueError('origin_denied')


def capture_spec(message):
    if set(message) != {'action', 'pid', 'timeoutMs', 'filter'}:
        raise ValueError('invalid_capture_spec')
    pid, timeout = message['pid'], message['timeoutMs']
    if type(pid) is not int or not 1 <= pid <= 4294967295 or type(timeout) is not int or not 1000 <= timeout <= 300000:
        raise ValueError('invalid_capture_spec')
    spec = message['filter']
    if not isinstance(spec, dict) or set(spec) != {'host', 'pathPrefix', 'headerName'}:
        raise ValueError('invalid_capture_spec')
    host, prefix, header = spec['host'], spec['pathPrefix'], spec['headerName']
    if not isinstance(host, str) or len(host) > 253 or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', host):
        raise ValueError('invalid_capture_spec')
    if not isinstance(prefix, str) or len(prefix) > 2048 or not prefix.startswith('/') or not re.fullmatch(r'[\x21-\x7e]+', prefix):
        raise ValueError('invalid_capture_spec')
    if not isinstance(header, str) or len(header) > 128 or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", header):
        raise ValueError('invalid_capture_spec')
    return pid, timeout, dict(spec)


HOOK_SOURCE = r'''const requests=new Map();let observed=false;
function read(p, wide, length) {
 try { if(p.isNull()) return ''; const n=length<0?undefined:Math.min(length,65536); return wide?p.readUtf16String(n):p.readCString(n); } catch (_) { return ''; }
}
function hook(mod,name,callbacks) { const m=Process.findModuleByName(mod); const p=m && m.findExportByName(name); if(p) Interceptor.attach(p,callbacks); }
function remember(handle,value){if(requests.size>=4096)requests.delete(requests.keys().next().value);requests.set(handle.toString(),value);}
function capture(handle, text) {
 const r=requests.get(handle.toString());
 if(observed||!r||r.host.toLowerCase()!==filter.host.toLowerCase()||!r.path.startsWith(filter.pathPrefix)||text.length>65536)return;
 if(text.split(/\r?\n/).some(line=>{const colon=line.indexOf(':');return colon>0&&line.slice(0,colon).toLowerCase()===filter.headerName.toLowerCase();})){observed=true;send(text);}
}
function family(mod, winhttp, wide, suffix) {
 hook(mod,winhttp?'WinHttpConnect':'InternetConnect'+suffix,{
  onEnter(a){this.host=read(a[1],wide,-1);},onLeave(r){if(!r.isNull())remember(r,{host:this.host,path:''});}
 });
 hook(mod,winhttp?'WinHttpOpenRequest':'HttpOpenRequest'+suffix,{
  onEnter(a){const parent=requests.get(a[0].toString());this.record=parent&&{host:parent.host,path:read(a[2],wide,-1)};},
  onLeave(r){if(this.record&&!r.isNull())remember(r,this.record);}
 });
 hook(mod,winhttp?'WinHttpAddRequestHeaders':'HttpAddRequestHeaders'+suffix,{onEnter(a){capture(a[0],read(a[1],wide,a[2].toInt32()));}});
 hook(mod,winhttp?'WinHttpSendRequest':'HttpSendRequest'+suffix,{onEnter(a){capture(a[0],read(a[1],wide,a[2].toInt32()));}});
 hook(mod,winhttp?'WinHttpCloseHandle':'InternetCloseHandle',{onEnter(a){requests.delete(a[0].toString());}});
}
family('wininet.dll',false,false,'A');family('wininet.dll',false,true,'W');family('winhttp.dll',true,true,'');
Interceptor.flush();'''


def build_hook(spec):
    # JSON serialization is the only bridge from declarative data into this fixed script.
    return 'const filter=' + json.dumps(spec, ensure_ascii=True) + ';\n' + HOOK_SOURCE


def capture(message):
    pid, timeout, spec = capture_spec(message)
    import frida
    session = frida.attach(pid)
    try:
        event, result = threading.Event(), {}
        script = session.create_script(build_hook(spec))

        def on_capture(message, _data):
            if message.get('type') == 'send':
                headers = message.get('payload')
                if isinstance(headers, str) and len(headers) <= MAX_HEADERS:
                    result['headers'] = headers
                else:
                    result['error'] = True
                event.set()
            elif message.get('type') == 'error':
                result['error'] = True
                event.set()

        script.on('message', on_capture)
        script.load()
        send({'ok': True, 'status': 'waiting'})
        if not event.wait(timeout / 1000):
            raise ValueError('capture_timeout')
        if result.get('error') or 'headers' not in result:
            raise ValueError('capture_failed')
        send({'ok': True, 'status': 'captured', 'headers': result['headers']})
    finally:
        if not session.is_detached:
            session.detach()


def main():
    try:
        authorize(sys.argv[1] if len(sys.argv) > 1 else '')
        while True:
            message = receive()
            action = message.get('action')
            if action == 'ping' and set(message) == {'action'}:
                send({'ok': True, 'captureProtocol': CAPTURE_PROTOCOL, 'capabilities': ['listProcesses', 'captureHeaders']})
            elif action == 'listProcesses' and set(message) == {'action'}:
                import frida
                send({'ok': True, 'processes': [{'pid': p.pid, 'name': p.name} for p in frida.get_local_device().enumerate_processes()]})
            elif action == 'capture':
                capture(message)
                return
            else:
                raise ValueError('invalid_message')
    except EOFError:
        return
    except Exception as error:
        code = str(error)
        if code not in {'origin_denied', 'invalid_message', 'invalid_capture_spec', 'capture_timeout', 'capture_failed', 'response_too_large'}:
            code = 'capture_failed'
        send({'ok': False, 'status': 'error', 'code': code})


if __name__ == '__main__':
    main()