"""Create the website's manual-install ZIP without changing extension sources."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
extension = ROOT / 'extension'
version = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))['version']
destination = ROOT / 'website' / 'downloads'
destination.mkdir(parents=True, exist_ok=True)
archive = destination / 'MDownloader-development.zip'
files = {}
for base, prefix in [(extension, 'extension'), (ROOT / 'native' / 'kakao', 'extension/native/kakao')]:
    for source in sorted(base.rglob('*')):
        relative = source.relative_to(base)
        if not source.is_file() or any(p in {'.local', '__pycache__', '.git'} for p in relative.parts):
            continue
        if source.name in {'host.cmd', 'host-manifest.json'} or source.suffix in {'.pyc', '.log', '.tmp'}:
            continue
        files[f'{prefix}/{relative.as_posix()}'] = source.read_bytes()
policy = files['extension/lib/distribution-policy.js'].decode('utf-8')
if "flavor: 'development'" not in policy:
    raise RuntimeError('Expected the development source distribution')
for name in ['THIRD_PARTY_NOTICES.md']:
    files[name] = (ROOT / name).read_bytes()
files['INSTALL.txt'] = (
    'MDownloader development build / 개발판 ' + version + '\n\n'
    'Extract this ZIP to a permanent folder. Open chrome://extensions or edge://extensions, '
    'enable Developer mode, select Load unpacked, and choose the extension folder. '
    'Finish active jobs before replacing files and reloading the extension.\n\n'
    'ZIP을 유지할 폴더에 압축 해제하세요. chrome://extensions 또는 edge://extensions에서 '
    '개발자 모드를 켠 뒤 압축해제된 확장 프로그램 로드로 extension 폴더를 선택하세요. '
    '업데이트 전에는 진행 중인 작업을 마치고 파일 교체 후 확장을 새로고침하세요.\n'
).encode('utf-8')
with ZipFile(archive, 'w', ZIP_DEFLATED, compresslevel=6) as output:
    for name, data in sorted(files.items()):
        output.writestr(name, data)
with ZipFile(archive) as check:
    assert check.testzip() is None
    assert set(check.namelist()) == set(files)
    for name, data in files.items():
        assert hashlib.sha256(check.read(name)).digest() == hashlib.sha256(data).digest(), name
metadata = {'version': version, 'files': len(files), 'bytes': archive.stat().st_size,
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
(destination / 'development.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(json.dumps(metadata))
