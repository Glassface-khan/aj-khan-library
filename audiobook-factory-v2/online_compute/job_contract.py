"""Provider-independent, FAIL-CLOSED online TTS job contract for private AJK V2.

A cloud-capable stage/dispatch plan only; it does NOT perform network requests.
Do NOT send private DOCX/text/voice samples to GitHub or public hosting.
Actual provider, secrets, budgets, R2 transfers and remote auth are unconfigured.
"""
from dataclasses import dataclass, asdict
import re

VOICE_IDS = frozenset({"jessica_en", "jessica_de", "gandalf_en", "gandalf_de"})
SEGMENTS = ("beginning", "middle", "end")
MAX_SAMPLE_WORDS = 180
MAX_SAMPLE_SECONDS = 240
MAX_PARALLEL_JOBS = 1
CLOUD_TTS_ENABLED = False  # never change in a CI-only PR to begin real production


class NotAuthorizedForCloud(Exception):
    pass


@dataclass(frozen=True)
class JobSpecification:
    job_id: str
    voice_id: str
    source_object_key: str
    sample_labels: tuple
    max_words_per_sample: int
    max_seconds_per_sample: int
    max_parallel_jobs: int
    author_admin_only: bool
    publishing_enabled: bool
    cloud_provider: str
    cost_authorized: bool
    ready_to_dispatch: bool


def plan_private_three_sample_job(job_id, voice_id, source_object_key, *,
                                  provider="not_selected"):
    """Permit only private R2 source locations and known voice IDs.

    This returns only opaque IDs and storage keys; never text or audio bytes.
    The provider cannot be used for real calls until separately authorized.
    """
    if not isinstance(job_id, str) or not re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", job_id, re.I
    ):
        raise ValueError("invalid_job_id")
    if voice_id not in VOICE_IDS:
        raise ValueError("unapproved_voice_reference")
    if not isinstance(source_object_key, str) or not re.fullmatch(
        r"sources/[0-9a-f-]{36}/manuscript\.docx", source_object_key, re.I
    ):
        raise ValueError("source_must_remain_private_r2")
    if source_object_key.split("/")[1].lower() != job_id.lower():
        raise ValueError("source_job_mismatch")
    if provider not in ("not_selected", "modal_trial", "oracle_always_free", "hf_zerogpu_trial"):
        raise ValueError("unknown_provider")
    return JobSpecification(
        job_id=job_id,
        voice_id=voice_id,
        source_object_key=source_object_key,
        sample_labels=SEGMENTS,
        max_words_per_sample=MAX_SAMPLE_WORDS,
        max_seconds_per_sample=MAX_SAMPLE_SECONDS,
        max_parallel_jobs=MAX_PARALLEL_JOBS,
        author_admin_only=True,
        publishing_enabled=False,
        cloud_provider=provider,
        cost_authorized=False,
        ready_to_dispatch=False,
    )


def dispatch_online(job, *, author_approved_costs=False, trusted_backend=False,
                    validated_provider_contract=False):
    """ALWAYS BLOCKED until a completely new reviewed dispatch implementation.

    Returning an explicit exception is deliberate. This is not a free compute API.
    """
    if not CLOUD_TTS_ENABLED or not (author_approved_costs and trusted_backend and validated_provider_contract):
        raise NotAuthorizedForCloud("online_tts_dispatch_disabled")
    raise NotAuthorizedForCloud("remote_backend_not_implemented")
