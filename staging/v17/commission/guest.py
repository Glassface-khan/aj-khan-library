"""Start the existing media listener using the existing V17 runtime and ledger."""
import json, os, sys, sqlite3
from http.server import ThreadingHTTPServer
from pathlib import Path
from owner import DB, MODULES, WORK, find_live, require

def main():
    os.umask(0o077)
    find_live()
    sys.path.insert(0,str(MODULES))
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from guest_media import media_handler
    from drive_guard_v15 import Budget, SafeRegistry
    from af3_drive_inventory_v17 import FolderInventory
    from tailscale_drive_mount import private_config
    # Attach to ready live editions without invoking startup recovery.
    class Live:
        def db(self):
            db=sqlite3.connect(DB.as_uri()+'?mode=rw',uri=True,timeout=10)
            db.row_factory=sqlite3.Row
            return db
        get=SafeRegistry.get
        is_ready=SafeRegistry.is_ready
    registry=Live()
    key=bytes.fromhex((WORK/'guest-ticket.key').read_text().strip())
    require(len(key)==32,'Invalid guest signing key')
    budget=Budget(registry)
    server=ThreadingHTTPServer(('127.0.0.1',int(os.environ['V17_GUEST_PORT'])),
            media_handler(registry,FolderInventory(private_config(),budget),budget,key))
    server.serve_forever()

if __name__=='__main__': main()
