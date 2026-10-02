# BOOK CLOSE — Canonical Final Archive + Website Runtime

This is the required workflow for **BUCH ABSCHLIESSEN – KOMPLETT**.

## Trigger

When the author says **"bitte abschließen"**, **"Buch abschließen"**, **"finalisieren"**,
or an equivalent unambiguous instruction to close/finalize a book, this full workflow
is mandatory unless the author explicitly excludes a step.

A manuscript/package is **not** considered fully closed merely because the prose,
DOCX, EPUB, ZIP, Drive archive, catalogue row, or GitHub commit exists.

---

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

---

## Website delivery architecture

### Public cover

The website cover is a deliberately public, non-sensitive delivery asset.

For every closed book, the final approved cover must be copied into this repository:

```
assets/covers/<stable-slug>.<jpg|png|webp>
```

The public catalogue must reference the **same-origin GitHub Pages path**, e.g.:

```
assets/covers/the-ledger-of-the-dead.png
```

### Hard cover rule

**Never use a Google Drive / Google Docs / Drive thumbnail URL as `coverUrl`.**

Forbidden public-cover patterns include:

```
drive.google.com/...
docs.google.com/...
https://drive.google.com/thumbnail?id=...
drive-private://...
```

The cover must not depend on Drive sharing state, Google authentication, or a
browser-specific Drive thumbnail endpoint.

### Private book content

EPUBs, manuscripts, internal files, audits, production packages and private
reference material remain private and must be accessed only through the protected
private-asset architecture.

The website must not expose direct private Drive IDs/URLs for these assets.

---

## Website runtime cache

The folder with ID `1wCKKVMexGWRPTWx2yQrnb2b4-fLhKLAU` is named:

**_WEBSITE_RUNTIME – AUTO (NICHT BEARBEITEN)**

It is a generated/runtime staging area only. It is **not** the source of truth and
must not be used as the public cover-delivery mechanism.

It may contain only generated/runtime copies required by backend/private delivery:

```
/_WEBSITE_RUNTIME – AUTO (NICHT BEARBEITEN)/<Book title>/
  metadata.json
  Manuskript/<LANG>/
    FINAL_<Book title>.docx
    EPUB_<Book title>.epub
    KLAPPENTEXT_<Book title>.txt|docx
  Bilder/
    Cover/        # optional runtime/reference copy; NOT the website cover URL
    Alt-Cover/
  Intern/         # runtime placeholder only; no confidential audit package
  Extern/         # only material intentionally exposed via Background
  Video/
```

Never place submission packs, internal audits, checksums, full release packages,
private reference assets, or other confidential production documents in the
website runtime.

The runtime cache is disposable and is **not** a second archive or source of truth.

---

## Required close sequence

1. Freeze the prose/publication master.
2. Run final continuity/timeline/logic/theology/craft checks required by the project.
3. Build and QA the final DOCX / manuscript deliverables.
4. Build and QA the final premium EPUB.
5. Build the complete release package locally, including required front/backmatter,
   metadata, JSON, cover, notes and supporting documents.
6. Store **all authoritative final files** only in
   `AJ Khan Bücher – FINAL ARCHIVE/<BOOK TITLE>`.
7. Create/update only the minimum private website-runtime copies required for
   protected EPUB/manuscript/background delivery.
8. Copy the **final approved cover** to GitHub under `assets/covers/` with a stable,
   title-derived slug.
9. Set the book's public `coverUrl` to that same-origin `assets/covers/...` path.
   Do **not** publish a Drive cover URL.
10. Update/synchronize `BooksData` and `books-live.json` while preserving the
    privacy boundary:
    - public metadata and local public cover path may be visible;
    - private EPUB/manuscript/background locations must not be exposed as direct
      Drive URLs or IDs.
11. Ensure the new title is present exactly once in the public catalogue.
12. If catalogue/shell assets changed, bump or invalidate the PWA/service-worker
    generation as needed so iPhone/Safari cannot keep a stale cover/catalogue.
13. Run the privacy/security diagnostic. It must confirm that public catalogue data
    contains **zero** `drive.google.com`, `docs.google.com`, and
    `drive-private://` references.
14. Run the live-asset diagnostic:
    - exactly one catalogue row for the title;
    - local cover path exists in the repository;
    - cover URL returns an actual image;
    - protected EPUB route resolves for an authorized reader;
    - unauthenticated private-asset requests remain denied.
15. Perform the live website smoke test:
    - book card appears;
    - cover renders on desktop and mobile/iPhone;
    - cover view/grid renders without a broken-image icon;
    - title/genre/word count/chapter count are correct;
    - Read works when permitted;
    - EPUB opens when permitted.
16. Only then report **WEBSITE COMPLETE** and **BOOK CLOSED**.

---

## Hard completion gate

A Drive upload, GitHub commit, Pages deployment, BooksData row, final DOCX, EPUB,
or ZIP alone is never sufficient.

A title may be called `BOOK CLOSED` / `WEBSITE COMPLETE` only when:

- the complete private final package exists in the FINAL ARCHIVE;
- the protected runtime contains only the minimum necessary delivery copies;
- the final cover exists under `assets/covers/`;
- the public catalogue uses the local GitHub cover path and contains no Drive cover URL;
- public catalogue data exposes no private Drive locations;
- the cover renders on the live site, including mobile/iPhone;
- the protected EPUB route works for authorized access;
- unauthorized private access is denied;
- and the live website card passes the smoke test.

---

## Safety rule

The private final archive, protected runtime, and public website assets must never
be confused.

- **FINAL ARCHIVE:** complete authoritative private package.
- **Protected runtime/backend:** minimum private delivery copies.
- **GitHub `assets/covers/`:** final approved public cover only.
- **Public catalogue:** sanitized metadata + same-origin public cover path; never
  direct private Drive locations.

If a file contains internal audit material, submission strategy, checksums,
private reference material, or a full release package, it belongs in
**AJ Khan Bücher – FINAL ARCHIVE**, not in the public website.

---

## Migration status — 2 October 2026

- Legacy Drive-thumbnail cover delivery has been removed from `books-live.json`.
- All current catalogue covers resolve through same-origin GitHub assets or embedded
  public image data.
- The public catalogue contains no Drive cover references.
- The service-worker generation was bumped to force clients away from stale
  Drive-based cover data.
- Future book closes must follow the GitHub-cover rule above so this regression
  cannot recur.
