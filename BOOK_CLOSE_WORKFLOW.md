# BOOK CLOSE — Single-Root Canonical Workflow

This is the required workflow for **BUCH ABSCHLIESSEN – KOMPLETT**.

## One canonical Drive root

There is exactly one book root:

**Alis Books**  
Drive root ID: `1wCKKVMexGWRPTWx2yQrnb2b4-fLhKLAU`

Every book has exactly one canonical folder:

```
/Alis Books/<Book title>/
  metadata.json
  Manuskript/<LANG>/
    FINAL_<Book title>.docx
    EPUB_<Book title>.epub
    KLAPPENTEXT_<Book title>.txt|docx
  Bilder/
    Cover/<final cover>
    Alt-Cover/
  Intern/
  Extern/
  Video/
  Release Package/
    01_FINAL_BOOK/
    02_FRONT_BACKMATTER/
    03_SUBMISSION/
    04_MARKETING/
    05_INTERNAL_AUDITS/
    06_REFERENCE_ASSETS/
    README / inventory / checksums / final ZIP as applicable
```

The folder name must match the website title exactly.

## Important rule

**No second production/archive root is allowed.**

The former folder `AJ Khan Bücher` has been retired and renamed
`_LEGACY_SYSTEM – NICHT FÜR BÜCHER`. It must never receive final book files.

## Required close sequence

1. Freeze prose/publication master.
2. Build and QA final EPUB.
3. Build the complete release package locally.
4. Place/import the complete package into
   `Alis Books/<Book title>/Release Package`.
5. Mirror/select the canonical live files inside the same book folder:
   - final manuscript
   - EPUB
   - blurb
   - metadata
   - final cover
6. Run `syncDriveForAllBooks()`.
7. Verify `BooksData` contains exactly one row for the title and that all
   asset IDs resolve to files inside the same `Alis Books/<Book title>` folder.
8. Verify the cover is publicly readable (`anyone -> reader`) and its URL
   returns an actual image.
9. Verify the EPUB URL resolves to the final EPUB.
10. Verify `DriveSyncLog` contains a successful current sync for the title.
11. Perform the website smoke test:
    - book card appears
    - cover renders
    - title/genre/word count/chapter count are correct
    - Read works when permitted
    - EPUB works
12. Only then report **WEBSITE COMPLETE**.

## Hard completion gate

A Drive upload, a GitHub commit, a Pages deployment, or a BooksData row by
itself is never sufficient.

A title may be called `WEBSITE COMPLETE` only when all of these are true:

- one canonical folder exists under `Alis Books`,
- the full production package is inside that same folder,
- `BooksData` points only to assets inside that folder,
- the cover is publicly readable and renders,
- the EPUB resolves,
- and the live website card has passed the smoke test.

## Migration note

On 24 September 2026, the production archives for the existing completed
titles were moved from the former `AJ Khan Bücher` root into their canonical
book folders under `Alis Books`. The old root now contains only non-book
legacy/test material and is not part of the publishing workflow.
