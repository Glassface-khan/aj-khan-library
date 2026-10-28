# CARAVANSERAI MP3 transfer — completed 2026-10-28

32 missing MP3 source files (209,719,872 bytes) copied to the user-specified existing Drive folder. All 33 destination files were fully read back and SHA-256 matched against the original Supabase source receipts. No duplicates. The pre-existing 32_CHAPTER_THIRTY.mp3 retained its original ID, size and modifiedTime and matched the source hash. Supabase names, sizes and eTags were unchanged.

Nine offline safety tests and eight existing backup-worker tests passed. The initial isolated GitHub runner preflight failed before any upload: OAuth refresh succeeded, but drive.file access to the requested folder returned HTTP 404. The connected Drive upload path was used instead. The first MP3 passed full readback before batch copying.

Two uploads (14_CHAPTER_TWELVE.mp3 and 25_CHAPTER_TWENTY-THREE.mp3) were truncated. A final comparison against the immutable original source receipts caught the intermediate check's use of mutable local files. Those two newly created Drive files were repaired in place; no existing user file was overwritten. The verifier now compares against original source receipts and rejects truncated content. Both repairs passed fresh full Drive readback. The remaining 31 full readbacks also match original receipts.

No synthesis, M4B creation, source deletion, destination deletion, permission changes, or production-workflow changes. The temporary source signer is closed and rejects all requests; the isolated one-off workflow is disabled. Main was not modified. Existing production backup infrastructure is M4B-oriented; its OAuth client still lacks access to this target folder and was not broadened.

## SHA-256 readback receipts

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| 01_CARAVANSERAI.mp3 | 134253 | 284d01fa30e8c04d9c4ed4959f0398350e7930d7e3090193d6f57d0a7841529e |
| 02_PROLOGUE.mp3 | 6694029 | 15ce1952b0bb6f6eeb619983debc50828b9cf86c8bce37a6cc55df2e4a4a86ed |
| 03_CHAPTER_ONE.mp3 | 7217613 | 2ba353e6d9646b1c02f3137302a75e76c674004e17146ff7d3b8718c0441aba8 |
| 04_CHAPTER_TWO.mp3 | 8098893 | fa05efb1b6d1951b08e6d31507f2b589bbf79eb02e97d1588663285e0c81edb7 |
| 05_CHAPTER_THREE.mp3 | 4791501 | c1383b96633c61f43e256dcbad217205ba9aa719aec9c5883f91350d1b57eac4 |
| 06_CHAPTER_FOUR.mp3 | 5571405 | b0946ebaf7c7f386d47480984d5d104f60aa1fb485a9f8c6c5aa1d616b43bf43 |
| 07_CHAPTER_FIVE.mp3 | 5462829 | b4f4050a4774d772ec9dbab63ce7f20f8d8a62269090b4ddc4a0b7b88d643bcf |
| 08_CHAPTER_SIX.mp3 | 6681933 | 98e1a0e16827dc43881e598661e67b7fe55f230da250668e576b8676f38d6997 |
| 09_CHAPTER_SEVEN.mp3 | 4270797 | 7562830caf43d03f3136f5ddf11fe90475dde7dfe7a5819d482f37bb27fac12e |
| 10_CHAPTER_EIGHT.mp3 | 5258925 | 1ed5d9390cf6187eb871db9bac23911444e80cad1e65c3eeaffa7d96dc963438 |
| 11_CHAPTER_NINE.mp3 | 5487021 | 095177ebe0f852aa34a2cc2a3c0af4a2e2b06a8002d9eb8d388ba2d26a2ed8da |
| 12_CHAPTER_TEN.mp3 | 4779693 | f7d74214ff72ce6f6ca39894338632c7c9df8f60726a1c08762973471ae598ed |
| 13_CHAPTER_ELEVEN.mp3 | 7465005 | 4210ce036fb6c7c6bd7e468922b0b0a7b10c42ecee83e4da278c691492ccf392 |
| 14_CHAPTER_TWELVE.mp3 | 9699309 | bdaaf84129f62e8cef8b0b25098f711606e2c7774e9be8e07a183a44c59c9e06 |
| 15_CHAPTER_THIRTEEN.mp3 | 8653581 | 4a2bda315d4aed6f87b56a33690e6b19d812d7ab53e26ddcd5e2e5d010be349d |
| 16_CHAPTER_FOURTEEN.mp3 | 7744077 | 6bc5454d826cde0a9b9d979da133900875560109d10f466201b38a1c0d6d56c8 |
| 17_CHAPTER_FIFTEEN.mp3 | 7177581 | 5edcf972431dc72668617d68f7c081f55880a07b9c4e1ad51a14fe4f3dd3e9a3 |
| 18_CHAPTER_SIXTEEN.mp3 | 10243917 | c70ea642b280efad87f9ae58ee49c21590d8b5b607ad7da0f0d98c7338367e07 |
| 19_CHAPTER_SEVENTEEN.mp3 | 7124877 | 25b47ed717562350c807b5995cb3f975c7736496144ee38a4fc9ef6a382f2860 |
| 20_CHAPTER_EIGHTEEN.mp3 | 5930253 | 21d18e2852b51d7a97ab146d8b15256394d7146681ff98ed3b647c7f0258ab1b |
| 21_CHAPTER_NINETEEN.mp3 | 7448013 | d3a055830a12da9e67cdd6ef057725bb7af5a33f1c0cee381bc77d9f5be75bf8 |
| 22_CHAPTER_TWENTY.mp3 | 7241517 | 99dbd87d376167f54e4e5a00d7be6fd5aacd6284d9685200cc724218d3b7bc99 |
| 23_CHAPTER_TWENTY-ONE.mp3 | 7160877 | 10b02614c8d07c38f54fac8572892be1b935c9da079e7ebfeb7310b287f30530 |
| 24_CHAPTER_TWENTY-TWO.mp3 | 6825069 | 0d92490b11278d37bdd937a0059f9ca2d0d2d56daa1e12b1de7ad0dc6d91dcd0 |
| 25_CHAPTER_TWENTY-THREE.mp3 | 9049869 | 64d66534d874fdd5c9691bc8af40a7ac2919cc77be54e0ccbd1ba0d97387c28b |
| 26_CHAPTER_TWENTY-FOUR.mp3 | 5400621 | 7cb2a5d5303cff1d5e1e023d39ad05dd8b96e568fe222ab5b42404551b0d486c |
| 27_CHAPTER_TWENTY-FIVE.mp3 | 7655085 | 78ae9596d9e40c3a9c9a53acc689d07ba0b3f33ea3c2aed49cfc25f46b4f3505 |
| 28_CHAPTER_TWENTY-SIX.mp3 | 7834221 | 59717e4479ffc2b36b21d35f15ab6addf83782a3c1b31a8856d3abe2d78560a5 |
| 29_CHAPTER_TWENTY-SEVEN.mp3 | 6387309 | afae9529af6484c7456f9fa2f2a4fa5a5490a2f8f3bdf3b7fd96388e612c7e44 |
| 30_CHAPTER_TWENTY-EIGHT.mp3 | 7952301 | e004fa4e25106cdc2ceafc00840c231ab2f5417ec1dbd62bf35dcd529d06f754 |
| 31_CHAPTER_TWENTY-NINE.mp3 | 6935085 | 4a11116e29ea895d8cc76b0df627d17445147be2708f830043656c26c27f0251 |
| 32_CHAPTER_THIRTY.mp3 | 44400237 | 5320a306acb62628e1aac97b0101adb5a587128a05d24fb52011ab26ba60064c |
| 33_CODA.mp3 | 1342413 | 364e2facf7b137d6b8b6e0bee732223c749b69ad8ca3a7f44dff4db33308ec49 |
