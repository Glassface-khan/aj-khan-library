"""Guest-only loopback listener. Use the private V17 modules via PYTHONPATH."""
import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from drive_stream_gateway import VerifiedEdition, serve

ROUTE = re.compile(r"/guest-m4b/([A-Za-z0-9_-]{1,512})\.([0-9a-f]{64})")
SLOTS = threading.BoundedSemaphore(4)


def read_ticket(path, key):
    match = ROUTE.fullmatch(path)
    if not match:
        raise ValueError("invalid ticket")
    payload, signature = match.groups()
    expected = hmac.new(key, payload.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("invalid ticket")
    purpose, slug, part, digest, expires, nonce = json.loads(
        base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    now = int(time.time())
    if not (purpose == "guest-m4b-v1" and re.fullmatch("[a-z0-9-]{1,80}", slug)
            and type(part) is int and 1 <= part <= 500 and re.fullmatch("[0-9a-f]{64}",digest)
            and type(expires) is int and now < expires <= now + 305):
        raise ValueError("invalid ticket")
    return slug, part, digest


def media_handler(registry, provider, budget, key):
    class GuestMedia(BaseHTTPRequestHandler):
        # Do not log bearer URLs, exceptions or Drive metadata.
        def log_message(self, *_):
            pass

        def empty(self, status):
            self.send_response(status)
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def media(self):
            try:
                slug, number, digest = read_ticket(self.path,key)
            except (ValueError,TypeError):
                return self.empty(403)
            if not SLOTS.acquire(blocking=False):
                return self.empty(429)
            started = False
            try:
                self.connection.settimeout(15)
                row = registry.get(slug)
                if not row or row["state"] != "ready":
                    return self.empty(403)
                doc = json.loads(row["document"])
                parts = doc.get("parts") or [doc]
                if number > len(parts):
                    return self.empty(403)
                edition = VerifiedEdition(**parts[number-1]["edition"])
                if edition.sha256 != digest:
                    return self.empty(403)
                if not budget.allowed():
                    return self.empty(429)
                ranges = self.headers.get_all("Range", [])
                if len(ranges) > 1:
                    return self.empty(416)
                reply = serve(edition, authorized=True, method=self.command,
                              range_header=ranges[0] if ranges else None, transport=provider)
                self.send_response(reply.code)
                for k,v in reply.headers.items():
                    self.send_header(k,v)
                if "Content-Length" not in reply.headers:
                    self.send_header("Content-Length","0")
                self.end_headers()
                started = True
                for block in reply.chunks:
                    if not registry.is_ready(slug):
                        break
                    reservation = budget.reserve(len(block),"player")
                    self.wfile.write(block)
                    budget.observed(reservation,len(block))
            except Exception:
                if not started:
                    self.empty(503)
            finally:
                self.close_connection = True
                SLOTS.release()

        do_HEAD = do_GET = media
    return GuestMedia


if __name__ == "__main__":
    from af3_book_registry_v17 import BookRegistry
    from af3_drive_inventory_v17 import FolderInventory
    from drive_guard_v15 import Budget
    from tailscale_drive_mount import private_config

    os.umask(0o077)
    key = os.environ["V17_GUEST_TICKET_KEY"]
    if not re.fullmatch("[a-f0-9]{64}", key):
        raise ValueError("invalid guest key")
    db = Path(os.environ["V17_REGISTRY"]).resolve(strict=True)
    registry = BookRegistry(db)
    budget = Budget(registry)
    handler = media_handler(registry,FolderInventory(private_config(),budget),budget,bytes.fromhex(key))
    ThreadingHTTPServer(("127.0.0.1",int(os.environ["V17_GUEST_PORT"])),handler).serve_forever()
