"""Exercise the Edge issuer and the guest HTTP route using V17 and a memory transport."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from unittest.mock import patch
import time
from pathlib import Path
import subprocess
import sys
from threading import Thread

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT / "staging/v17"))
from guest_media import media_handler, read_ticket

key = "ab"*32  # test fixture
js = """
import assert from 'node:assert/strict';
import {guestTicket} from './staging/supabase/audio-library/guest-m4b.mjs';
const book={title:'Fixture',is_active:true,status:'ready'};
const args=[book,{slug:'fixture',info:{sha256:'a'.repeat(64)}},1,'https://fixture.invalid','ab'.repeat(32)];
await assert.rejects(guestTicket({listenerId:'guest',audioAccess:{}},...args));
const reply=await guestTicket({listenerId:'guest',audioAccess:{Fixture:true}},...args);
console.log(new URL(reply.url).pathname);
"""
ticket = subprocess.check_output(["node","--input-type=module","-e",js],cwd=ROOT,text=True).strip()
with patch("guest_media.time.time", return_value=time.time()+301):
    try:
        read_ticket(ticket,bytes.fromhex(key))
    except ValueError:
        pass
    else:
        raise AssertionError("Expired guest ticket accepted")
edition = dict(slug="fixture",drive_file_id="fixture000000001",size=100000,sha256="a"*64,
               drive_md5="a"*32,drive_version="1",readback_sha256="a"*64,readback_size=100000,
               private=True,original_cover_verified=True,technical_qc=True)

class Fixture:
    def get(self, slug):
        assert slug=="fixture"
        return dict(state="ready",document=json.dumps({"edition":edition}))
    def is_ready(self, slug): return True
    def allowed(self): return True
    def inspect(self, media): assert media.sha256==edition["sha256"]
    def read(self, media, start, end): return bytes(end-start+1)
    def reserve(self, size, direction): return 1
    def observed(self, reservation, size): pass

f = Fixture()
with ThreadingHTTPServer(("127.0.0.1",0),media_handler(f,f,f,bytes.fromhex(key))) as server:
    thread=Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        for path, status in [(ticket,206),(ticket[:-1]+('e' if ticket[-1]=='f' else 'f'),403),('/drive-library',403)]:
            client=HTTPConnection(*server.server_address,timeout=4)
            client.request("GET",path,headers={"Range":"bytes=0-1"})
            response=client.getresponse()
            assert response.status==status,(response.status,status)
            if status==206:
                assert response.getheader("Content-Range")=="bytes 0-1/100000"
                assert response.getheader("Content-Type")=="audio/mp4"
                assert response.read()==bytes(2)
            client.close()
    finally:
        server.shutdown()
print("PASS: entitled guest receives a two-byte 206; denied guest cannot obtain a ticket; forged ticket and owner route return 403")
