import hashlib, io, sys, unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ops'))
import caravanserai_mp3_backup as worker

class CopyTests(unittest.TestCase):
    def found(self):
        return {worker.PROTECTED: {'id':worker.PROTECTED_ID,'size':'44400237'}}
    def test_exact_missing_32(self):
        missing=worker.plan(self.found())
        self.assertEqual(len(missing),32)
        self.assertNotIn(worker.PROTECTED,[x['name'] for x in missing])
        self.assertEqual(sum(x['bytes'] for x in missing),209719872)
    def test_protected_upload_never_calls_network(self):
        entry=next(x for x in worker.MANIFEST if x['name']==worker.PROTECTED)
        with patch.object(worker.transport,'request') as network:
            with self.assertRaises(RuntimeError): worker.upload('token',entry,Path('unused'))
            network.assert_not_called()
    def test_wrong_protected_id_blocks(self):
        found=self.found();found[worker.PROTECTED]['id']='other'
        with self.assertRaises(RuntimeError): worker.plan(found)
    def test_unexpected_file_blocks(self):
        found=self.found();found['other.mp3']={}
        with self.assertRaises(RuntimeError): worker.plan(found)
    def test_existing_file_appearing_blocks_upload(self):
        entry=worker.MANIFEST[0]
        with patch.object(worker,'inventory',return_value={entry['name']:{}}),patch.object(worker.transport,'request') as network:
            with self.assertRaises(RuntimeError): worker.upload('token',entry,Path('unused'))
            network.assert_not_called()
    def test_duplicate_names_block(self):
        with patch.object(worker.transport,'google',return_value={'files':[{'name':'same'},{'name':'same'}]}):
            with self.assertRaises(RuntimeError): worker.inventory('token')
    def test_source_url_escape_blocks_before_download(self):
        entry=worker.MANIFEST[0]
        with patch.object(worker.transport,'edge',return_value={'name':entry['name'],'bytes':entry['bytes'],'url':'https://example.com/audio'}),patch.object(worker.transport,'request') as network:
            with self.assertRaises(RuntimeError): worker.download(entry,Path('unused'))
            network.assert_not_called()
    def test_corrupted_readback_blocks(self):
        data=b'audio';md5=hashlib.md5(data).hexdigest();sha=hashlib.sha256(data).hexdigest()
        meta={'name':'fixture.mp3','size':5,'md5Checksum':md5,'parents':[worker.FOLDER]}
        with patch.object(worker.transport,'google',return_value=meta),patch.object(worker.transport,'is_private'),patch.object(worker.transport,'request',return_value=io.BytesIO(b'wrong')):
            with self.assertRaises(RuntimeError): worker.transport.verified('token',worker.FOLDER,'id','fixture.mp3',5,sha,md5)
    def test_pilot_failure_never_starts_batch(self):
        with patch.object(worker.transport,'drive_token',return_value='token'),patch.object(worker.transport,'is_private'),patch.object(worker,'inventory',return_value=self.found()),patch.object(worker,'download',return_value=('sha','md5')),patch.object(worker.transport,'verified',side_effect=[{},RuntimeError('pilot failed')]),patch.object(worker,'upload',return_value='new') as upload:
            with self.assertRaises(RuntimeError): worker.execute()
            self.assertEqual(upload.call_count,1)

if __name__=='__main__': unittest.main()
