import hashlib, io, json, sys, unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'audiobook-cloud'))
import drive_backup_worker as worker

class Response(io.BytesIO):
    def __init__(self, value):
        super().__init__(json.dumps(value).encode())

class DriveBackupTests(unittest.TestCase):
    def test_missing_target_never_creates_fallback_audio_folder(self):
        from unittest.mock import Mock
        drive=Mock()
        claim={'job':{'id':'fixture'},'book':{},'files':[]}
        with self.assertRaises(worker.FolderAccessRequired): worker.copy_backup(claim,drive)
        drive.folder.assert_not_called()

    def test_book_folder_hierarchy_and_private_checks(self):
        from unittest.mock import Mock
        drive=Mock();drive.folder.side_effect=['audio_subfolder','edition_subfolder']
        claim={'targetFolderId':'book_folder','job':{'id':'fixture','audio_book_id':'book','source_fingerprint':'fingerprint','created_at':'2026-10-08T00:00:00Z'},'book':{'narrator_name':'Arne B.','language_code':'DE'},'files':[]}
        with patch.object(worker,'api') as backend:
            worker.copy_backup(claim,drive)
            self.assertEqual(drive.folder.call_args_list[0].args,('ajkBookAudio','book_folder','Hörbuch','book_folder'))
            self.assertEqual(drive.folder.call_args_list[1].args[-1],'audio_subfolder')
            self.assertEqual(backend.call_args.kwargs['folderId'],'edition_subfolder')
        self.assertEqual([c.args[0] for c in drive.check_private.call_args_list],['book_folder','book_folder','audio_subfolder','edition_subfolder'])

    def test_missing_credentials_do_not_access_drive(self):
        with patch.dict(worker.os.environ,{},clear=True), patch.object(worker.urllib.request,'urlopen') as network:
            with self.assertRaises(worker.ConnectionRequired): worker.Drive()
            network.assert_not_called()

    def test_broad_scope_is_rejected(self):
        env={k:'fixture' for k in ['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN']}
        with patch.dict(worker.os.environ,env), patch.object(worker.urllib.request,'urlopen',return_value=Response({'access_token':'fixture','scope':'https://www.googleapis.com/auth/drive'})):
            with self.assertRaises(worker.ConnectionRequired): worker.Drive()

    def test_existing_verified_file_is_reused(self):
        drive=worker.Drive.__new__(worker.Drive)
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'m4b-001.m4b';path.write_bytes(b'audio fixture')
            digest=hashlib.md5(path.read_bytes()).hexdigest()
            with patch.object(drive,'find',return_value=[{'id':'existing_private_file','size':str(path.stat().st_size),'md5Checksum':digest}]), patch.object(drive,'request') as upload:
                result=drive.upload(path,'private_folder','edition:file')
                self.assertEqual(result['id'],'existing_private_file')
                upload.assert_not_called()

    def test_public_folder_is_refused(self):
        drive=worker.Drive.__new__(worker.Drive)
        with patch.object(drive,'json',side_effect=[{'mimeType':'application/vnd.google-apps.folder'},{'permissions':[{'type':'anyone','role':'reader'}]}]):
            with self.assertRaises(ValueError): drive.check_private('fixture')

    def test_missing_connection_finishes_with_actionable_state(self):
        claim={'job':{'id':'fixture'}}
        with patch.object(worker,'api',side_effect=[claim,{}, {'job':None}]) as backend, patch.object(worker,'Drive',side_effect=worker.ConnectionRequired):
            worker.main()
            self.assertEqual(backend.call_args_list[1].kwargs, {'jobId':'fixture','success':False,'reason':'connection_required'})

    def test_upload_response_wrong_hash_is_rejected(self):
        drive=worker.Drive.__new__(worker.Drive)
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'m4b-001.m4b';path.write_bytes(b'audio fixture')
            init=Response({});init.headers={'Location':'https://www.googleapis.com/upload/session'}
            result=Response({'id':'fixture','size':path.stat().st_size,'md5Checksum':'bad'})
            with patch.object(drive,'find',return_value=[]), patch.object(drive,'request',side_effect=[init,result]):
                with self.assertRaises(ValueError): drive.upload(path,'folder','edition:file')

if __name__=='__main__':unittest.main()
