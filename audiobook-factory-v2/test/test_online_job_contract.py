"""Pure offline safety tests for an iPhone-started remote factory job.
No network, tokens, manuscripts, audio, TTS models, or billable compute.
"""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "online_compute"))
from job_contract import (plan_private_three_sample_job, dispatch_online,
                          NotAuthorizedForCloud, VOICE_IDS)
JOB = "ea369218-c6db-462d-a43f-5b24f84c8fed"
SOURCE = f"sources/{JOB}/manuscript.docx"

class RemotePlanTests(unittest.TestCase):
    def test_jessica_first_fails_closed_and_limits_audio(self):
        plan = plan_private_three_sample_job(JOB, "jessica_en", SOURCE, provider="modal_trial")
        self.assertEqual(plan.voice_id,"jessica_en")
        self.assertEqual(plan.sample_labels,("beginning","middle","end"))
        self.assertLessEqual(plan.max_words_per_sample,180)
        self.assertEqual(plan.max_parallel_jobs,1)
        self.assertTrue(plan.author_admin_only)
        self.assertFalse(plan.publishing_enabled)
        self.assertFalse(plan.cost_authorized)
        self.assertFalse(plan.ready_to_dispatch)
        for kwargs in (
            {}, {"author_approved_costs":True},
            {"author_approved_costs":True, "trusted_backend":True, "validated_provider_contract":True},
        ):
            with self.assertRaises(NotAuthorizedForCloud):
                dispatch_online(plan,**kwargs)

    def test_four_authored_languages_only(self):
        self.assertEqual(VOICE_IDS,{"jessica_en","jessica_de","gandalf_en","gandalf_de"})
        for voice in VOICE_IDS:
            self.assertEqual(plan_private_three_sample_job(JOB,voice,SOURCE).voice_id,voice)
        for voice in ("maggie","jessica","visitor","random","gandalf_en;DROP"):
            with self.assertRaises(ValueError):
                plan_private_three_sample_job(JOB,voice,SOURCE)

    def test_job_source_must_be_matching_private_object(self):
        with self.assertRaises(ValueError):
            plan_private_three_sample_job(JOB,"jessica_en","https://public.example/book.docx")
        with self.assertRaises(ValueError):
            plan_private_three_sample_job(JOB,"jessica_en","sources/bad/manuscript.docx")
        with self.assertRaises(ValueError):
            plan_private_three_sample_job(JOB,"jessica_en","sources/03cd8d34-7e98-4e7b-a8d9-1683fdf13f50/manuscript.docx")
        with self.assertRaises(ValueError):
            plan_private_three_sample_job(JOB,"jessica_en",SOURCE,provider="public_demo")

if __name__=="__main__":
    unittest.main()
