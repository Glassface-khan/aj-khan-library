# BOOK CLOSE — Canonical Final Archive + Website Runtime

This is the required workflow for **BUCH ABSCHLIESSEN – KOMPLETT**.

## Human-facing source of truth

There is exactly one canonical location for all final book materials:

**AJ Khan Bücher – FINAL ARCHIVE**  
Drive folder ID: `16PeaOkpvZuxDOTCYm23D0XSK43adlQw0`

Every completed title has one private book folder there containing the complete final package:

```
/AJ Khan Bücher – FINAL ARCHIVE/<BOOK TITLE>/
  01_FINAL_BOOK/
  02_FRONT_BACKMATTER/
  03_SUBMISSION/
  04_MARKETING/
  05_INTERNAL_AUDITS/
  06_REFERENCE_ASSETS/
  Release ZIP / README / inventory / checksums
  any additional final production files
```

This is the only authoritative location for final documents.

## Website runtime cache

The folder with ID `1wCKKVMexGWRPTWx2yQrnb2b4-fLhKLAU` is named:

**_WEBSITE_RUNTIME – AUTO (NICHT BEARBEITEN)**

It is public and exists only because the website needs browser-readable assets.

It may contain only generated/runtime copies required by the site:

```
/_WEBSITE_RUNTIME – AUTO (NICHT BEARBEITEN)/<Book title>/
  metadata.json
  Manuskript/<LANG>/
    FINAL_<Book title>.docx
    EPUB_<Book title>.epub
    KLAPPENTEXT_<Book title>.txt|docx
  Bilder/
    Cover/<final cover>
    Alt-Cover/
  Intern/      # runtime placeholder only; no confidential audit package
  Extern/      # only material intentionally exposed via Background
  Video/
```

Never place submission packs, internal audits, checksums, full release packages,
private reference assets, or other confidential production documents in the
website runtime.

The runtime cache is disposable and is **not** a second archive or source of truth.

## Required close sequence

1. Freeze the prose/publication master.
2. Build and QA the final EPUB.
3. Build the complete release package locally.
4. Store **all authoritative final files** only in
   `AJ Khan Bücher – FINAL ARCHIVE/<BOOK TITLE>`.
5. Create/update only the minimum website runtime copies in
   `_WEBSITE_RUNTIME – AUTO (NICHT BEARBEITEN)/<Book title>`.
6. Verify the runtime cover is public (`anyone -> reader`).
7. Update `BooksData` using only runtime asset IDs.
8. Keep `books-live.json` synchronized as fallback using the same runtime IDs.
9. Run/allow `syncDriveForAllBooks()` and verify the current `DriveSyncLog`.
10. Run the live-asset diagnostic:
    - exactly one BooksData row for the title
    - cover URL returns an actual image
    - EPUB URL resolves
11. Perform the website smoke test:
    - book card appears
    - cover renders
    - title/genre/word count/chapter count are correct
    - Read works when permitted
    - EPUB works
12. Only then report **WEBSITE COMPLETE**.

## Hard completion gate

A Drive upload, GitHub commit, Pages deployment, or BooksData row alone is never
sufficient.

A title may be called `WEBSITE COMPLETE` only when:

- the complete private final package exists in the FINAL ARCHIVE,
- the runtime contains only the minimum public delivery copies,
- BooksData points to those runtime copies,
- the cover is publicly readable and renders,
- the EPUB resolves,
- and the live website card passes the smoke test.

## Safety rule

The private final archive and the public website runtime must never be confused.

If a file contains internal audit material, submission strategy, checksums,
private reference material, or a full release package, it belongs in
**AJ Khan Bücher – FINAL ARCHIVE**, not in the runtime cache.

## Migration status — 24 September 2026

- Existing production archives are back in the private FINAL ARCHIVE.
- `The Mountain That Doesn't Answer` was promoted from the old book-close test
  location into the normal FINAL ARCHIVE.
- Complete `Release Package` folders were removed from the public runtime for
  `The Pen Was Still Warm` and `The Mountain That Doesn't Answer`.
- The runtime currently contains no complete `Release Package` folders.
