"""Cloudflare R2 transport for PRIVATE audiobook V2 CPU runners.

Portable across user-owned VM, an authorized production service or development
environment. It does NOT invoke GitHub Actions or create a serverless service.

Files stay in the private R2 bucket and an ephemeral worker's temp directory.
Credentials only from environment variables, not command line or source.
No object listing, public URLs, deletions, overwrites or arbitrary object keys.
"""
import os
from pathlib import Path
import re

ACCOUNT_ID = "b5a96acb430918e9b39890a63f863349"
BUCKET = "ajk-private-audiobooks-v2-test"
S3_ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

ALLOWED_SAMPLES = (
    "beginning.wav", "middle.wav", "end.wav",
    "private_manifest.json", "preliminary_qc.json",
)
MAX_DOCX = 15_000_000
MAX_VOICE_WAV = 12_000_000
MAX_OUTPUT = 32_000_000

class PrivateTransportError(ValueError):
    pass

def validate_job_id(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}",
        value,
    ):
        raise PrivateTransportError("invalid_pilot_job_id")
    return value.lower()

def source_key(job_id):
    return f"sources/{validate_job_id(job_id)}/manuscript.docx"

def voice_key(voice_id):
    from voice_registry import VOICE_FILES
    if voice_id not in VOICE_FILES:
        raise PrivateTransportError("unsupported_voice_id")
    return "private-voices/" + VOICE_FILES[voice_id]

def result_key(job_id, voice_id, filename):
    if filename not in ALLOWED_SAMPLES:
        raise PrivateTransportError("unsupported_sample_filename")
    from voice_registry import VOICE_FILES
    if voice_id not in VOICE_FILES:
        raise PrivateTransportError("unsupported_voice_id")
    return f"pilots/{validate_job_id(job_id)}/results/{voice_id}/{filename}"

def client_from_environment():
    """Only the V2 R2 S3 keys. NOT the Cloudflare account deploy API token."""
    access = os.environ.get("AJK_V2_R2_ACCESS_KEY_ID", "").strip()
    secret = os.environ.get("AJK_V2_R2_SECRET_ACCESS_KEY", "").strip()
    if not access or not secret:
        raise PrivateTransportError("private_r2_access_missing")
    # boto3 is intentionally not loaded in safe/offline CI tests.
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 2}),
    )

def fetch_limited(client, key, max_bytes):
    """Fail closed: no arbitrary object, known max size, no plaintext logging."""
    if not (key.startswith("sources/") or key.startswith("private-voices/")):
        raise PrivateTransportError("unapproved_r2_read")
    if not isinstance(max_bytes, int) or max_bytes <= 0:
        raise PrivateTransportError("invalid_limit")
    response = client.get_object(Bucket=BUCKET, Key=key)
    body = response["Body"]
    try:
        if int(response.get("ContentLength", max_bytes + 1)) > max_bytes:
            raise PrivateTransportError("private_object_too_large")
        blob = body.read(max_bytes + 1)
        if len(blob) == 0 or len(blob) > max_bytes:
            raise PrivateTransportError("private_object_invalid_size")
        return blob
    finally:
        body.close()

def fetch_source(client, job_id):
    return fetch_limited(client, source_key(job_id), MAX_DOCX)

def fetch_voice(client, voice_id):
    return fetch_limited(client, voice_key(voice_id), MAX_VOICE_WAV)

def save_result(client, job_id, voice_id, filename, data):
    """Write once: no duplicate writes; never delete private user files.

    For production concurrency safety, also coordinate job status in D1;
    S3 conditional writes alone do not represent a complete transaction.
    """
    key = result_key(job_id, voice_id, filename)
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_OUTPUT:
        raise PrivateTransportError("invalid_output_payload")
    mime = "audio/wav" if filename.endswith(".wav") else "application/json"
    try:
        client.put_object(
            Bucket=BUCKET, Key=key, Body=data, ContentType=mime,
            IfNoneMatch="*",
        )
    except Exception:
        # Provider API errors must not expose any private object details or auth.
        raise PrivateTransportError("r2_conditional_upload_failed") from None
    return key
