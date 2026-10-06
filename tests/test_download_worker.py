import json, sys, unittest
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"audiobook-cloud"))
import download_worker as worker

class PrivateDownloadTests(unittest.TestCase):
    def test_zip_and_m4b_preserve_order_and_chapters(self):
        with TemporaryDirectory() as d:
            folder=Path(d);chapters=[]
            for i in range(2):
                path=folder/f"chapter-{i}.mp3"
                worker.run("ffmpeg","-v","error","-f","lavfi","-i","sine=frequency=500:duration=1","-ar","24000","-ac","1","-y",str(path))
                chapters.append({"local":path,"chapter_index":i,"title":f"Chapter {i+1}","seconds":worker.duration(path)})
            zips=worker.pack_zip(chapters,folder)
            import zipfile
            with zipfile.ZipFile(zips[0]) as z:
                self.assertEqual(z.namelist(),["001 - Chapter 1.mp3","002 - Chapter 2.mp3"])
                self.assertIsNone(z.testzip())
            m4b=worker.pack_m4b(chapters,{"title":"Synthetic fixture","narrator_name":"Test"},folder)[0]
            probe=json.loads(worker.run("ffprobe","-v","error","-show_chapters","-of","json",str(m4b)))
            self.assertEqual([c["tags"]["title"] for c in probe["chapters"]],["Chapter 1","Chapter 2"])
            self.assertLess(m4b.stat().st_size,worker.LIMIT)

    def test_zip_parts_stay_below_cap(self):
        with TemporaryDirectory() as d:
            folder=Path(d);chapters=[]
            for i in range(3):
                p=folder/f"chapter-{i}.mp3";p.write_bytes(b"x"*10000)
                chapters.append({"local":p,"chapter_index":i,"title":"Fixture"})
            original=worker.LIMIT
            try:
                worker.LIMIT=30000
                parts=worker.pack_zip(chapters,folder)
                self.assertEqual(len(parts),2)
                self.assertTrue(all(p.stat().st_size<=30000 for p in parts))
            finally:worker.LIMIT=original

if __name__=="__main__":unittest.main()
