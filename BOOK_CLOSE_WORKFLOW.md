# BOOK CLOSE — Canonical Production → Live Workflow

This is the required workflow for the command **BUCH ABSCHLIESSEN – KOMPLETT**.

## Two Drive roots with different roles

### 1. Production archive
**AJ Khan Bücher**

Purpose:
- full release package
- publication master
- submission/internal/marketing/QA material
- checksums and reference assets

This is an archive/workspace root. It is **not** the live website source.

### 2. Live operational root
**Alis Books**

This is the folder monitored by `syncDriveForAllBooks()` and used by the author website pipeline.

Every completed book must also have an operational mirror here:

```
/<Book title>/
  metadata.json
  Manuskript/<LANG>/
    FINAL_<Book title>.docx
    EPUB_<Book title>.epub
    KLAPPENTEXT_<Book title>.txt|docx
  Bilder/Cover/<cover image>
  Bilder/Alt-Cover/
  Intern/
  Extern/
  Video/
```

The title folder name must match the website title exactly.

## Required close sequence

1. Freeze prose/publication master.
2. Build and QA EPUB.
3. Build complete production package in **AJ Khan Bücher**.
4. Mirror website-operational files to **Alis Books**.
5. Verify the live cover file inherits/publicly has `anyone -> reader`.
6. Update `BooksData` using the **live-root file IDs**, never private archive IDs.
7. Keep `books-live.json` synchronized as fallback using the same live-root IDs.
8. Run/allow `syncDriveForAllBooks()` and verify `DriveSyncLog` for the book.
9. Perform a website smoke test:
   - book card appears
   - cover actually renders
   - title/genre/word count/chapter count are correct
   - Read works when permitted
   - EPUB link points to the live file
10. Only then report **WEBSITE COMPLETE**.

## Hard completion gate

A successful Drive upload or GitHub Pages deployment alone is **not** sufficient.

Never mark a title `WEBSITE COMPLETE` until:
- the book exists in `BooksData`,
- its cover source is publicly readable,
- the website card renders the cover,
- and the live asset IDs point to **Alis Books**.

## Why this exists

A private Drive image can still produce a syntactically valid
`https://lh3.googleusercontent.com/d/<id>=w1000` URL. The URL may then render as a
broken image for visitors. The production archive and live website root must
therefore never be treated as interchangeable.
