"""Exercise the pinned PyAV decoder with a real multiplexed WebRTC container."""
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from fractions import Fraction
from unittest.mock import patch

import av


SPEC = importlib.util.spec_from_file_location('av_decode_worker', Path(__file__).with_name('av-decode-worker.py'))
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


def multiplexed_webm():
    output = io.BytesIO()
    container = av.open(output, 'w', format='webm')
    video = container.add_stream('libvpx', rate=10)
    video.width = video.height = 16
    video.pix_fmt = 'yuv420p'
    audio = container.add_stream('libopus', rate=48000)
    audio.layout = 'stereo'
    for index in range(10):
        image = av.VideoFrame(16, 16, 'yuv420p')
        for plane in image.planes:
            plane.update(bytes(plane.buffer_size))
        image.pts = index
        for packet in video.encode(image):
            container.mux(packet)
        sound = av.AudioFrame(format='s16', layout='stereo', samples=4800)
        sound.sample_rate = 48000
        sound.pts = index * 4800
        for plane in sound.planes:
            plane.update(bytes(plane.buffer_size))
        for packet in audio.encode(sound):
            container.mux(packet)
    for stream in (video, audio):
        for packet in stream.encode(None):
            container.mux(packet)
    container.close()
    return output.getvalue()


class AudioDecodeTests(unittest.TestCase):
    def test_requested_timestamp_resampling_trims_a_backward_jump_without_rebasing_origin(self):
        resampler=WORKER.AudioResample({'rate':16000},1);output=[]
        for index in range(12):
            frame=av.AudioFrame(format='s16',layout='stereo',samples=2880)
            frame.sample_rate=48000;frame.time_base=Fraction(1,48000)
            frame.pts=2112+index*2880-(14400 if index>=6 else 0)
            for plane in frame.planes:plane.update(bytes(plane.buffer_size))
            output.extend(resampler.resample(frame))
        output.extend(resampler.resample(None))
        self.assertEqual(output[0].pts,704)
        self.assertEqual(sum(frame.samples for frame in output),11520-4800)
        for before,after in zip(output,output[1:]):self.assertEqual(before.pts+before.samples,after.pts)

    def test_timestamp_resampling_bounds_large_gaps_and_checks_cancellation(self):
        calls=[]
        resampler=WORKER.AudioResample({'rate':16000},1,check=lambda:calls.append(True))
        def frame(pts):
            value=av.AudioFrame(format='s16',layout='stereo',samples=2880)
            value.sample_rate=48000;value.time_base=Fraction(1,48000);value.pts=pts
            for plane in value.planes:plane.update(bytes(plane.buffer_size))
            return value
        resampler.resample(frame(0))
        self.assertGreater(len(calls),1)
        with self.assertRaisesRegex(ValueError,'caption_resample_output_limit'):resampler.resample(frame(48000*3600))
        def canceled():raise InterruptedError('caption_canceled')
        resampler.check=canceled
        with self.assertRaises(InterruptedError):resampler.resample(frame(2880))

    def test_requested_timestamp_resampling_keeps_origin_and_represents_a_real_gap(self):
        for gap in (0, 24000):
            resampler=WORKER.AudioResample({'rate':16000},1)
            output=[]
            for index in range(6):
                frame=av.AudioFrame(format='s16',layout='stereo',samples=2880)
                frame.sample_rate=48000;frame.time_base=Fraction(1,48000)
                frame.pts=2112+index*2880+(48 if index in (1,4) else 0)+(gap if index>=3 else 0)
                for plane in frame.planes:plane.update(bytes(plane.buffer_size))
                output.extend(resampler.resample(frame))
            output.extend(resampler.resample(None))
            self.assertEqual(output[0].pts,704)
            for before,after in zip(output,output[1:]):self.assertEqual(before.pts+before.samples,after.pts)
            self.assertEqual(sum(frame.samples for frame in output),5760+gap//3)

    def test_failure_facts_never_export_raw_messages(self):
        error=OSError(22,'private URL https://media.invalid/?token=secret and C:/private/file')
        self.assertEqual(WORKER.failure_facts(error,'open'),{'operation':'open','exceptionType':'OSError','errno':22})
        self.assertEqual(WORKER.failure_facts(AttributeError('private attribute'),'select-audio'),{'operation':'select-audio','exceptionType':'AttributeError'})

    def test_pinned_pyav_decodes_audio_from_video_and_opus_without_stream_discard_api(self):
        data = multiplexed_webm()
        class Input(io.BytesIO):
            def seekable(self):
                return False
            def seek(self, *args):
                raise io.UnsupportedOperation('nonseekable input')
        config = {'demux': {'format': None, 'options': {}}, 'input': {'bufferBytes': 196608},
                  'audio': {'index': 0}, 'output': {'rate': 16000, 'channels': 1, 'sampleFormat': 's16', 'byteOrder': 'little'},
                  'limits': {'maxOutputFrameBytes': 131072, 'queuedOutputBytes': 2880000}}
        events = []
        class Owner(WORKER.Computation):
            def controls(self):
                pass
            def room(self, *args, **kwargs):
                pass
            def emit(self, event, raw_bytes=0, terminal=False):
                if event['type'] == 'pcm':
                    self.frame = event['sequence']
                    self.counters['outputSamples'] += event['samples']
                    self.counters['outputBytes'] += raw_bytes
                events.append(event)
            def state(self):
                pass
        with tempfile.TemporaryDirectory() as directory:
            owner = Owner(Path(directory), config)
            with patch.object(WORKER, 'BridgeIO', lambda owner: Input(data)):
                WORKER.decode(owner)
        self.assertEqual(events[0]['codec'], 'opus')
        self.assertTrue(any(event['type'] == 'pcm' for event in events))
        self.assertEqual(owner.counters['outputSamples'], 16000)
        self.assertTrue(events[-1]['demuxEnded'])
        self.assertTrue(events[-1]['decoderFlushed'])
        self.assertTrue(events[-1]['resamplerFlushed'])
        self.assertEqual(events[-1]['outputBytes'], 32000)


if __name__ == '__main__':
    unittest.main()
