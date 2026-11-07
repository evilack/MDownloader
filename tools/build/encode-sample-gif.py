"""실제 Chrome PNG 캡처를 인코딩합니다. 프레임 합성이나 원본 재구성을 하지 않습니다."""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
import hashlib
import json
import argparse

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--assets', required=True)
args = parser.parse_args()
source = root / args.source
assets = root / args.assets
assets.mkdir(parents=True, exist_ok=True)
frames = [Image.open(path).convert('RGB') for path in sorted(source.glob('frame-*.png'))]
atlas = Image.new('RGB', (240 * 6, 207 * 4))
for index, frame in enumerate(frames):
    atlas.paste(frame.resize((240, 207)), ((index % 6) * 240, (index // 6) * 207))
palette = atlas.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
# 원본 캡처는 보존하고 기존 최대 720px 표시 영역에 맞는 파생본을 만듭니다.
delivery_size = (720, round(frames[0].height * 720 / frames[0].width))
delivery = [frame.resize(delivery_size, Image.Resampling.LANCZOS) for frame in frames]
indexed = [frame.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG) for frame in delivery]
gif = assets / 'sample-motion.gif'
indexed[0].save(gif, save_all=True, append_images=indexed[1:],
                duration=[120 if index % 2 == 0 else 130 for index in range(len(indexed))],
                loop=0, optimize=True, disposal=1)
poster = assets / 'sample-still.png'
delivery[-1].save(poster, optimize=True)
decoded = Image.open(gif)
durations, hashes = [], []
for index in range(decoded.n_frames):
    decoded.seek(index)
    durations.append(decoded.info['duration'])
    hashes.append(hashlib.sha256(decoded.convert('RGB').tobytes()).hexdigest())
delta = ImageChops.difference(frames[0].crop((80, 260, 880, 650)), frames[-1].crop((80, 260, 880, 650)))
mean = sum(ImageStat.Stat(delta).mean) / 3
assert decoded.n_frames == 23 and len(set(hashes)) > 20 and mean > 5
result = dict(width=decoded.width, height=decoded.height, frames=decoded.n_frames,
              uniqueDecodedFrames=len(set(hashes)), durationMs=sum(durations),
              loop=decoded.info.get('loop'), actualVideoPixelMeanDifference=mean,
              files=[dict(name=path.name, bytes=path.stat().st_size,
                          sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in [gif, poster]],
              settings=f'Pillow GIF: {delivery_size} Lanczos delivery, shared 256-color palette, Floyd-Steinberg dithering, disposal=1, optimized delta rectangles, 8 fps (120/130ms alternating); native {frames[0].size} Chrome screenshots preserved.')
(source / 'gif.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
