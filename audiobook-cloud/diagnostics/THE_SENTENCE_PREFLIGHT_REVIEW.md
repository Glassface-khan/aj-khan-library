# THE SENTENCE — isolated preflight diagnostic (no production changes)

Target job: `d9083e10-ac7a-44f3-bc53-faa4d87782c6` only.

## Observed failure
The existing QC summary shows the final section's first 16–17 words include Arabic transliteration and a historical date. Whisper base.en reports 0.5263 word recall versus the normal 0.58 minimum. Audio signal metrics pass. This does **not** establish that the generated audio is accurate.

## Safe diagnostic procedure
1. Obtain the private EPUB through the existing authenticated worker mechanism, without publishing it or placing it in GitHub artifacts.
2. Parse the 39 sections using the existing production parser and inspect the last section's prose locally.
3. Select an alternative 30–60-word continuous passage from section index 38 that has no transliterated proper names, dates, or numerical expressions. Keep the original passage unchanged for a separate pronunciation review.
4. Synthesize only the alternative sample using the exact Gandalf EN model configuration, and run the existing audio signal and ASR gates **without changing thresholds**.
5. Record local word recall, sequence similarity, WER similarity, duration, silence and clipping. Compare the original and alternative text against their actual audio; do not infer accurate pronunciation from ASR alone.
6. If the alternative passes, propose a narrowly scoped sample-selection improvement, plus regression tests; do not mark the original sample as passed automatically.
7. If it fails, stop and report the precise failures. Do not requeue or synthesize any book sections.

## Deployment safeguards
- This branch is diagnostic only; no worker code, production queue, QC status, or settings are changed.
- A reviewed code change and successful isolated test are required before any merge or requeue.
- Do not dispatch the Cloud Worker, Queue Watchdog or any other audiobook job from this branch.
