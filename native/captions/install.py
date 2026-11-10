"""Per-user installer. No administrator access, global pip, or unrelated host changes."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import venv
import uuid
from engine import PackageLease

HOST='com.mdownloader.captions'

def install(extension_id,root,python=sys.executable,whisper_cli=None,ffmpeg=None,register=True,dependencies=True):
    root=root.resolve();root.mkdir(parents=True,exist_ok=True)
    lease=PackageLease(root,inherit=True)
    try:return _install(extension_id,root,python,whisper_cli,ffmpeg,register,dependencies)
    finally:lease.close()


def _install(extension_id,root,python=sys.executable,whisper_cli=None,ffmpeg=None,register=True,dependencies=True):
    if not re.fullmatch('[a-p]{32}',extension_id):raise ValueError('Invalid extension ID')
    if sys.platform not in ('win32','darwin'):raise ValueError('This installer supports Windows and macOS')
    root=root.resolve();root.mkdir(parents=True,exist_ok=True)
    source=Path(__file__).parent
    # Source modules can be nested. Installation preserves relative paths while
    # refusing redirects and excluding environments, private tests and user data.
    source=source.resolve();files=[]
    excluded={'venv','.venv','env','__pycache__','tests','test','node_modules','.git','jobs','models','origins','artifacts'}
    for directory,dirs,names in os.walk(source,followlinks=False):
        parent=Path(directory)
        dirs[:]=sorted(name for name in dirs if name not in excluded and not name.startswith('.')
            and not (parent/name).is_symlink() and not getattr(parent/name,'is_junction',lambda:False)()
            and (parent/name).resolve()!=root)
        for name in sorted(names):
            path=parent/name
            if name.startswith('test_') or parent==source and name in ('config.json','com.mdownloader.captions.json') or path.suffix not in ('.py','.json','.txt'):continue
            if path.is_symlink() or getattr(path,'is_junction',lambda:False)() or not path.is_file():continue
            relative=path.relative_to(source)
            if any(part in ('.','..') or ':' in part for part in relative.parts):raise ValueError('Unsafe package source')
            files.append((path,relative))
            if len(files)>10000:raise ValueError('Package source limit exceeded')
    for source_file,relative in files:
        destination=root/relative
        for current in [root.joinpath(*relative.parts[:count]) for count in range(1,len(relative.parts)+1)]:
            if current.is_symlink() or getattr(current,'is_junction',lambda:False)():raise ValueError('Unsafe package destination')
        if not destination.resolve().is_relative_to(root):raise ValueError('Unsafe package destination')
        destination.parent.mkdir(parents=True,exist_ok=True)
        if destination.resolve()!=source_file.resolve():
            temporary=destination.with_name(destination.name+'.install-'+uuid.uuid4().hex)
            try:shutil.copyfile(source_file,temporary);temporary.replace(destination)
            finally:temporary.unlink(missing_ok=True)
    environment=root/'venv'
    if not environment.exists():subprocess.run([python,'-m','venv',str(environment)],check=True)
    executable=environment/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
    if dependencies:subprocess.run([str(executable),'-m','pip','install','--disable-pip-version-check','-r',str(root/'requirements.txt')],check=True)
    config_path=root/'config.json'
    config=json.loads(config_path.read_text('utf-8')) if config_path.exists() else {}
    for key,value in [('whisperCli',whisper_cli),('ffmpeg',ffmpeg)]:
        if value:
            resolved=Path(value).expanduser().resolve()
            if not resolved.is_file():raise ValueError('Executable not found: '+str(resolved))
            config[key]=str(resolved)
    config_path.write_text(json.dumps(config,indent=2),'utf-8')
    if sys.platform=='win32':
        launcher=root/'caption-host.cmd'
        # cmd path metacharacters can expand even inside quotes; reject them.
        if any(c in str(root)+str(executable) for c in '%!\r\n'):raise ValueError('Unsupported install path')
        launcher.write_text('@echo off\r\nset "MDOWNLOADER_CAPTION_HOME=%~dp0"\r\n"%~dp0venv\\Scripts\\python.exe" "%~dp0host.py" %*\r\n',encoding='ascii')
    else:
        launcher=root/'caption-host'
        launcher.write_text('#!/bin/sh\nexport MDOWNLOADER_CAPTION_HOME='+shlex.quote(str(root))+'\nexec '+shlex.quote(str(executable))+' '+shlex.quote(str(root/'host.py'))+' "$@"\n','utf-8');launcher.chmod(0o700)
    manifest_path=root/(HOST+'.json');origins=['chrome-extension://'+extension_id+'/']
    if manifest_path.exists():
        previous=json.loads(manifest_path.read_text('utf-8'))
        if previous.get('name')==HOST:origins+= [v for v in previous.get('allowed_origins',[]) if isinstance(v,str) and re.fullmatch(r'chrome-extension://[a-p]{32}/',v)]
    manifest={'name':HOST,'description':'MDownloader local speech recognition','path':str(launcher),'type':'stdio','allowed_origins':list(dict.fromkeys(origins))}
    manifest_path.write_text(json.dumps(manifest,indent=2),'utf-8')
    if register:
        if sys.platform=='win32':
            import winreg
            for browser in ('Google\\Chrome','Microsoft\\Edge'):
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER,'Software\\'+browser+'\\NativeMessagingHosts\\'+HOST) as key:winreg.SetValueEx(key,'',0,winreg.REG_SZ,str(manifest_path))
        else:
            for browser in ('Google/Chrome','Microsoft Edge'):
                folder=Path.home()/'Library'/'Application Support'/browser/'NativeMessagingHosts';folder.mkdir(parents=True,exist_ok=True);shutil.copyfile(manifest_path,folder/manifest_path.name)
    return manifest_path

def main():
    from host import default_root
    parser=argparse.ArgumentParser(description='Install the local caption helper for this user.')
    parser.add_argument('--extension-id',required=True);parser.add_argument('--destination',type=Path,default=default_root());parser.add_argument('--python',default=sys.executable)
    parser.add_argument('--whisper-cli');parser.add_argument('--ffmpeg');parser.add_argument('--no-register',action='store_true');parser.add_argument('--skip-dependencies',action='store_true')
    args=parser.parse_args();print(install(args.extension_id,args.destination,args.python,args.whisper_cli,args.ffmpeg,not args.no_register,not args.skip_dependencies))
if __name__=='__main__':main()
