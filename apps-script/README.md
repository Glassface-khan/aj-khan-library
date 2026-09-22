# Apps Script backend — Source of Truth

This directory is the canonical, version-controlled source for the Google Apps Script backend used by the A. J. Khan author site.

## Canonical files

- `Code.gs` — main web-app API, Drive sync, books/poems/access, EPUB handling **and the AudioAccess module**
- `BookmarkSync.gs` — cross-device EPUB reading position sync
- `RevisionModule.gs` — manuscript style-revision module

The older `reference/apps-script/` directory is historical/reference material only.

## Deployment rule

1. Make and review backend changes here first.
2. For the current audio upgrade, replace the live `Code.gs` with this complete `apps-script/Code.gs`; the AudioAccess functions are already inlined, so no extra `.gs` file is required.
3. For other changes, copy the changed `.gs` file(s) into the Google Apps Script project.
4. Save.
5. Deploy **New version** of the web app. Updating code without a new deployment version does not update the public endpoint.
6. Run `syncDriveForAllBooks()` (or the admin “sync now” action) when book metadata/files changed.
7. Verify `DriveSyncLog` and one real book in the live site.

GitHub is the source of truth; Apps Script is the deployment target.

## Security note

The protected EPUB reader/download path is `action=getEpubData`. EPUB files should not be intentionally shared as “Anyone with the link”.

If the parent Drive folder is itself public, Google Drive permissions are inherited and cannot be reduced on a child file. In that case set the **Alis Books** root folder to **Restricted** once; cover/video/alternate-cover assets that must be public are shared individually by the sync code.

## metadata.json fields consumed

The sync reads:

- `genre.primary`
- first two values of `genre.secondary`
- `word_count`
- `chapter_count`
- optional `page_count` (only when a real print page count exists)
- preferred blurb fields: `back_cover_text`, `blurb`, `klappentext`, `description`, `short_description`
- `logline` as fallback only

`files.klappentext` is only a path in a production package. It is not the blurb text itself. A separately uploaded `KLAPPENTEXT_...` document still has priority.


## One-ZIP book-close workflow

The backend now supports the mobile-friendly **BUCH ABSCHLIESSEN** workflow.

1. Produce one canonical release ZIP whose name contains `RELEASE_PACKAGE` and whose package contains `metadata.json` plus the standard production folders (`01_FINAL_BOOK`, `02_FRONT_BACKMATTER`, `03_SUBMISSION`, `04_MARKETING`, `05_INTERNAL_AUDITS`, `06_REFERENCE_ASSETS`).
2. Upload only that ZIP to the library Drive root or to any **direct child folder** of the root (for example a temporary phone-upload folder).
3. The normal `syncDriveForAllBooks()` run scans for new release ZIPs before doing the ordinary Drive sync.
4. The importer reads title/language/file paths from `metadata.json`, creates the canonical book folder, archives the complete package under `Release Package/<package-version>/`, and mirrors the operational assets into the existing author-site folders:
   - `metadata.json` -> book root
   - publication master -> `Manuskript/<LANG>/FINAL_<title>.*`
   - Premium EPUB -> `Manuskript/<LANG>/EPUB_<title>.epub`
   - back-cover copy -> `Manuskript/<LANG>/KLAPPENTEXT_<title>.*`
   - final cover -> `Bilder/Cover/`
5. If the title does not yet exist in `BooksData`, a minimal book record is created automatically; the ordinary Drive sync then fills cover, word count, blurb and EPUB URLs.
6. After a successful import, the source ZIP is moved into the archived release package under `_SOURCE_ZIP` and renamed with the `IMPORTED_` prefix so it will not be processed twice.

For an immediate manual test in the Apps Script editor, run `runBookCloseImportNow()`. The web API also exposes admin-protected actions `importReleaseZip` (with `zipFileId`) and `scanReleasePackages`.

No extra trigger is required: the existing hourly `syncDriveForAllBooks` trigger performs the scan automatically after the updated Code.gs has been deployed as a **New version**.
