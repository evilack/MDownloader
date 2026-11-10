import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import engine
from av_decode import bounded_json


class SnapshotIoTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'win32', 'Windows file replacement sharing')
    def test_atomic_replace_while_reader_keeps_the_previous_snapshot_open(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'state.json'
            engine.atomic_json(path,{'revision':1})
            open_snapshot=getattr(engine,'open_snapshot',lambda value:Path(value).open('rb'))
            with open_snapshot(path) as reader:
                engine.atomic_json(path,{'revision':2})
                self.assertEqual(json.loads(reader.read()),{'revision':1})
                self.assertEqual(bounded_json(path,128),{'revision':2})
            self.assertFalse(list(Path(directory).glob('*.tmp-*')))

    def test_concurrent_status_reads_never_interrupt_atomic_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'state.json'
            engine.atomic_json(path,{'revision':0,'payload':'가'*64})
            stop=threading.Event();errors=[]
            def read():
                try:
                    while not stop.is_set():
                        value=bounded_json(path,1024)
                        self.assertEqual(value['payload'],'가'*64)
                        self.assertIsInstance(value['revision'],int)
                except BaseException as error:errors.append(error)
            thread=threading.Thread(target=read);thread.start()
            try:
                for revision in range(1,201):engine.atomic_json(path,{'revision':revision,'payload':'가'*64})
            finally:stop.set();thread.join(5)
            self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
            self.assertEqual(bounded_json(path,1024)['revision'],200)

    def test_snapshot_json_limits_and_shape_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'state.json'
            path.write_text('{"payload":"'+'x'*128+'"}',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'caption_worker_protocol'):bounded_json(path,32)
            path.write_text('[]',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'caption_worker_protocol'):bounded_json(path,32)
            with self.assertRaises(FileNotFoundError):bounded_json(path.with_name('missing.json'),32)

    def test_failed_replacement_keeps_the_owned_new_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'state.json';engine.atomic_json(path,{'revision':1})
            with patch.object(engine,'_replace_snapshot',side_effect=OSError('replacement outcome unknown')):
                with self.assertRaises(OSError):engine.atomic_json(path,{'revision':2})
            self.assertEqual(bounded_json(path,128),{'revision':1})
            retained=list(Path(directory).glob('*.tmp-*'));self.assertEqual(len(retained),1)
            self.assertEqual(json.loads(retained[0].read_text('utf-8')),{'revision':2})


if __name__=='__main__':unittest.main()
