import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
import wave
import numpy as np

SPEC=importlib.util.spec_from_file_location('caption_alignment_worker',Path(__file__).with_name('cpp-worker.py'))
WORKER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(WORKER)

class AlignmentTests(unittest.TestCase):
    def test_requested_word_timestamps_return_engine_words_and_segment_identity(self):
        calls=[]
        class Engine:
            def transcribe(self,path,**options):
                calls.append(options)
                words=[SimpleNamespace(start=np.float64(.1),end=np.float64(.4),word=' Hello',probability=np.float64(.9)),SimpleNamespace(start=.4,end=.8,word=' world.',probability=.8)]
                return iter([SimpleNamespace(start=.1,end=.8,text=' Hello world.',words=words)]),SimpleNamespace(language='en')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'audio.wav'
            with wave.open(str(path),'wb') as file:
                file.setnchannels(1);file.setsampwidth(2);file.setframerate(16000);file.writeframes(bytes(32000))
            result=WORKER.infer(Engine(),'faster-whisper',path,'auto',{'beamSize':5,'bestOf':5,'temperature':0,'vadFilter':True,'conditionOnPreviousText':False},{'sampleRate':16000,'chunkSeconds':30,'maxWorkerResultBytes':1048576},word_timestamps=True)
        self.assertTrue(calls[0]['word_timestamps'])
        self.assertEqual(result['words'],[[.1,.4,' Hello',0,.9],[.4,.8,' world.',0,.8]])
        self.assertEqual(result['segments'],[[.1,.8,' Hello world.']])

    def test_out_of_input_timestamps_are_identified_without_clipping(self):
        with self.assertRaisesRegex(ValueError,'caption_result_timestamp'):
            WORKER.checked_result([(30.98,32.98,'outside')],'en',30,{'maxWorkerResultBytes':1048576})

    def test_overlapping_reversed_word_times_remain_facts_for_application_correction(self):
        words=[[10,12,'A',0,.9],[9,11,' B',0,.9]]
        result=WORKER.checked_result([(9,12,'A B')],'en',30,{'maxWorkerResultBytes':1048576},words)
        self.assertEqual(result['words'],words)

if __name__=='__main__':unittest.main()
