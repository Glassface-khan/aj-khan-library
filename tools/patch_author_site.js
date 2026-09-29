const fs = require('fs');

const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

function once(oldText, newText, label) {
  const first = s.indexOf(oldText);
  const second = first < 0 ? -1 : s.indexOf(oldText, first + oldText.length);
  if (first < 0) throw new Error(label + ': marker not found');
  if (second >= 0) throw new Error(label + ': marker occurs more than once');
  s = s.slice(0, first) + newText + s.slice(first + oldText.length);
}

// Repair the malformed cover regex emitted by the previous patcher version.
// index.html stores the component source inside a JSON string. The broken
// version contains FOUR backslashes at this layer; the correct encoded form
// contains TWO, which JSON.parse turns into the single backslashes needed by
// the JavaScript regex literal.
const badEncodedCoverRegex = String.raw`/(^|\\\\/)cover\\\\.xhtml(?:$|[?#])/`;
const goodEncodedCoverRegex = String.raw`/(^|\\/)cover\\.xhtml(?:$|[?#])/`;
if (s.includes(badEncodedCoverRegex)) {
  s = s.split(badEncodedCoverRegex).join(goodEncodedCoverRegex);
}

// Existing metadata/download patches. Keep them idempotent because this
// workflow may be re-run when later website patches are added.
if (!s.includes('const effChapterCount =')) {
  once(
    'const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;',
    String.raw`const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;\n      const effChapterCount = (langInfo && langInfo.chapterCount) || b.chapterCount;\n      const effPageCount = (langInfo && langInfo.pageCount) || b.pageCount;`,
    'effective metadata'
  );
}

if (!s.includes('const statParts = [];')) {
  once(
    'const wc = Number(effWordCount) || 0;',
    String.raw`const wc = Number(effWordCount) || 0;\n      const cc = Number(effChapterCount) || 0;\n      const pc = Number(effPageCount) || 0;\n      const statLocale = s.uiLang === 'en' ? 'en-US' : 'de-DE';\n      const statParts = [];\n      if (wc) statParts.push(wc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' words' : ' Wörter'));\n      if (pc) statParts.push(pc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' pages' : ' Seiten'));\n      else if (cc) statParts.push(cc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' chapters' : ' Kapitel'));`,
    'stats calculation'
  );
}

if (!s.includes("wordCountLabel: statParts.join(' · ')")) {
  const labelStart = s.indexOf('        wordCountLabel:');
  const labelEnd = s.indexOf('        bandLabel:', labelStart);
  if (labelStart < 0 || labelEnd < 0) throw new Error('stats label boundaries not found');
  s = s.slice(0, labelStart) + String.raw`        wordCountLabel: statParts.join(' · '),\n        hasWordCount: statParts.length > 0,\n` + s.slice(labelEnd);
}

if (!s.includes("epubHref: '#'")) {
  once(
    "epubHref: (canRead && effEpubUrl && bookIsFinished) ? effEpubUrl : '#',",
    "epubHref: '#',",
    'epub href'
  );
}

if (!s.includes('else this.downloadEpub(b.title, effEpubUrl);')) {
  const handlerStart = s.indexOf('onEpub: (e) => {');
  const handlerEnd = s.indexOf('        onBg: (e) => {', handlerStart);
  if (handlerStart < 0 || handlerEnd < 0) throw new Error('EPUB click handler boundaries not found');
  const handler = String.raw`onEpub: (e) => {\n          // Always use the permission-checked Apps Script endpoint.\n          e.preventDefault();\n          if (canRead) {\n            if (!bookIsFinished) window.alert(this.tr('EPUB gibt es erst, sobald das Buch als Fertig markiert ist — bis dahin über Read lesbar.', 'The EPUB becomes available once the book is marked finished — until then it can be read via Read.'));\n            else if (!effEpubUrl) window.alert(this.tr('Noch keine EPUB-Datei hinterlegt — entsteht automatisch, sobald das Manuskript synchronisiert ist.', 'No EPUB file yet — it is created automatically once the manuscript is synced.'));\n            else this.downloadEpub(b.title, effEpubUrl);\n          } else {\n            if (bookIsFinished && effEpubUrl && restrictedEpubPerm.download) this.downloadEpub(b.title, effEpubUrl);\n            else window.alert(this.tr('Für dieses Buch hast du (noch) keinen Download-Zugriff.', 'You don’t have download access to this book yet.'));\n          }\n        },\n`;
  s = s.slice(0, handlerStart) + handler + s.slice(handlerEnd);
}


// AJK refresh stored visitor access permissions on every page load.
// Older sessions cached visibleBooks in localStorage, so a code that now has
// access to all books could keep hiding newly published titles indefinitely.
// Re-check the same stored access code server-side and refresh only the
// permission snapshot; no code is exposed or changed.
if (!s.includes('AJK refresh stored visitor access permissions')) {
  once(
    String.raw`    this.fetchBooks();\n    this.fetchSettings();\n    this.fetchPoems();\n`,
    String.raw`    this.fetchBooks();\n    this.fetchSettings();\n    this.fetchPoems();\n    // AJK refresh stored visitor access permissions: keep long-lived browser/PWA\n    // sessions in sync with the current Access sheet so newly published books\n    // are not hidden by an old cached visibleBooks list.\n    if (access && access.code) {\n      const accessParams = new URLSearchParams({ action: 'checkAccess', code: access.code });\n      fetch(this.SCRIPT_URL, { method: 'POST', body: accessParams })\n        .then(r => r.json())\n        .then(data => {\n          if (!data || !data.ok) return;\n          const freshAccess = {\n            name: data.name || access.name || '',\n            canDownload: !!data.canDownload,\n            canCopy: !!data.canCopy,\n            visibleBooks: Array.isArray(data.visibleBooks) ? data.visibleBooks : null,\n            showPoems: data.showPoems !== false,\n            code: access.code,\n            epubAccess: (data.epubAccess && typeof data.epubAccess === 'object') ? data.epubAccess : {}\n          };\n          try { localStorage.setItem('ajk_visitor_access', JSON.stringify(freshAccess)); } catch (e) {}\n          this.setState({\n            visitorName: freshAccess.name,\n            visitorCanDownload: freshAccess.canDownload,\n            visitorCanCopy: freshAccess.canCopy,\n            visitorVisibleBooks: freshAccess.visibleBooks,\n            visitorShowPoems: freshAccess.showPoems,\n            visitorAccessCode: freshAccess.code,\n            visitorEpubAccess: freshAccess.epubAccess\n          });\n        })\n        .catch(() => {});\n    }\n`,
    'visitor access refresh'
  );
}

// iOS/Safari premium-EPUB black-screen fix.
// Premium files may contain their own prefers-color-scheme dark CSS and a
// black cover page. The inline reader should remain readable regardless of
// the EPUB's dark-mode styling. The downloaded EPUB itself is untouched.
if (!s.includes("themes.register('ajk-reader'")) {
  once(
    String.raw`      const book = ePub(bytes.buffer);\n      this.epubBook = book;\n      this.epubRendition = book.renderTo('epub-reader-viewport', { width: '100%', height: '100%', flow: 'scrolled-doc', manager: 'continuous' });\n      // Schriftgroesse: zuletzt gewaehlte Groesse (localStorage, geraeteweit\n`,
    String.raw`      const book = ePub(bytes.buffer);\n      this.epubBook = book;\n      this.epubRendition = book.renderTo('epub-reader-viewport', { width: '100%', height: '100%', flow: 'scrolled-doc', manager: 'continuous' });\n      // Reader-Farbmodus bewusst von der EPUB entkoppeln. Premium-EPUBs koennen\n      // eigene @media (prefers-color-scheme: dark)-Regeln oder schwarze Cover-\n      // Seiten enthalten. Auf iOS Safari fuehrte das dazu, dass der Titel kurz\n      // sichtbar war und danach die Leseflaeche schwarz erschien. Die Datei\n      // selbst bleibt unveraendert; nur die Inline-Ansicht bekommt ein stabiles\n      // helles Lesethema.\n      try {\n        this.epubRendition.themes.register('ajk-reader', {\n          'html, body': { 'background': '#fbf7ef !important', 'color': '#27221e !important' },\n          'h1, h2, h3, h4, h5, h6, p, li, blockquote, dt, dd': { 'color': 'inherit !important' },\n          '.cover-page': { 'background': '#fbf7ef !important' }\n        });\n        this.epubRendition.themes.select('ajk-reader');\n      } catch (e) {}\n      // Schriftgroesse: zuletzt gewaehlte Groesse (localStorage, geraeteweit\n`,
    'reader light theme'
  );
}

// Drop stale bookmarks that resolve to a non-linear cover section. Those old
// CFIs were produced by earlier reader failures and can make iOS jump from a
// briefly visible title page to an apparently empty/black cover surface.
if (!s.includes('Alte Bookmarks aus frueheren Reader-Fehlern')) {
  once(
    String.raw`      const bookmarkKey = 'ajk_epub_bookmark_' + (this.currentEpubUrl || '');\n      let savedCfi = serverCfi || null;\n      if (!savedCfi) { try { savedCfi = localStorage.getItem(bookmarkKey); } catch (e) {} }\n      this.epubRendition.on('relocated', (location) => {\n`,
    String.raw`      const bookmarkKey = 'ajk_epub_bookmark_' + (this.currentEpubUrl || '');\n      let savedCfi = serverCfi || null;\n      if (!savedCfi) { try { savedCfi = localStorage.getItem(bookmarkKey); } catch (e) {} }\n      // Alte Bookmarks aus frueheren Reader-Fehlern koennen auf einer nicht-\n      // linearen Cover-Seite landen. Genau dann blitzt erst die Titelseite auf\n      // und danach bleibt auf iOS nur die schwarze Cover-Flaeche stehen. Solche\n      // CFIs nicht wiederherstellen; der naechste relocated-Event schreibt\n      // automatisch eine neue gueltige Position.\n      if (savedCfi) {\n        try {\n          const savedSection = book.spine && book.spine.get ? book.spine.get(savedCfi) : null;\n          const savedHref = String(savedSection && savedSection.href || '').toLowerCase();\n          const isCover = /(^|\\/)cover\\.xhtml(?:$|[?#])/.test(savedHref);\n          if (!savedSection || savedSection.linear === 'no' || isCover) {\n            savedCfi = null;\n            try { localStorage.removeItem(bookmarkKey); } catch (e) {}\n          }\n        } catch (e) {\n          savedCfi = null;\n          try { localStorage.removeItem(bookmarkKey); } catch (e2) {}\n        }\n      }\n      this.epubRendition.on('relocated', (location) => {\n`,
    'reader bookmark validation'
  );
}

if (!s.includes('const firstReadable = spineItems.find')) {
  once(
    String.raw`      this.epubRendition.display(savedCfi || undefined).catch(() => this.epubRendition.display());\n`,
    String.raw`      let initialTarget = savedCfi || undefined;\n      if (!initialTarget) {\n        try {\n          const spineItems = (book.spine && (book.spine.spineItems || book.spine.items)) || [];\n          const firstReadable = spineItems.find(function(item) {\n            if (!item || item.linear === 'no') return false;\n            return !/(^|\\/)cover\\.xhtml(?:$|[?#])/.test(String(item.href || '').toLowerCase());\n          });\n          if (firstReadable && firstReadable.href) initialTarget = firstReadable.href;\n        } catch (e) {}\n      }\n      this.epubRendition.display(initialTarget).catch(() => this.epubRendition.display());\n`,
    'reader first readable section'
  );
}


// ADMIN BOOK ORDER PERSISTENCE
// Arrow moves in the Admin panel use a dedicated lightweight endpoint so a
// reorder cannot accidentally overwrite metadata or trigger Drive cleanup.
if (!s.includes('persistBookOrder = () => {')) {
  once(
    String.raw`moveBookUp = (i) => {\n    if (i <= 0) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i - 1]; books[i - 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBooks());\n  };\n  moveBookDown = (i) => {\n    if (i >= this.state.books.length - 1) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i + 1]; books[i + 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBooks());\n  };`,
    String.raw`persistBookOrder = () => {\n    const books = this.state.books || [];\n    const order = books.map(b => ({ id: b.id || '', title: b.title || '' }));\n    try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}\n    const params = new URLSearchParams({ action: 'saveBookOrder', order: JSON.stringify(order), adminToken: this.state.adminToken });\n    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (data && data.ok) {\n          this.showSavedToast('Reihenfolge gespeichert ✓');\n        } else {\n          window.alert('Reihenfolge konnte nicht zentral gespeichert werden: ' + ((data && data.error) || 'unbekannt') + '. Die Server-Reihenfolge wird neu geladen.');\n          this.fetchBooks();\n        }\n      })\n      .catch(err => {\n        window.alert('Verbindung fehlgeschlagen: ' + err.message + '. Die Server-Reihenfolge wird neu geladen.');\n        this.fetchBooks();\n      });\n  };\n  moveBookUp = (i) => {\n    if (i <= 0) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i - 1]; books[i - 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBookOrder());\n  };\n  moveBookDown = (i) => {\n    if (i >= this.state.books.length - 1) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i + 1]; books[i + 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBookOrder());\n  };`,
    'admin book order persistence'
  );
}


// COVER GRID VIEW PATCH
// Use a new runtime filename so Safari/iOS cannot execute an older cached
// cover-grid implementation. Remove every previous cover-grid script tag
// before appending exactly one current runtime.
const coverGridSrc = 'cover-grid-v3.js?v=20260929b';
s = s.replace(/<script src="cover-grid(?:-v[23])?\.js(?:\?[^"]*)?"><\/script>\s*/g, '');
{
  const bodyEnd = s.lastIndexOf('</body>');
  if (bodyEnd < 0) throw new Error('cover grid script: closing body not found');
  s = s.slice(0, bodyEnd) + '<script src="' + coverGridSrc + '"></script>\n' + s.slice(bodyEnd);
}


// POETRY LAYOUT
// Restore the original poetry presentation. The compact shelf remains in the
// repository as an experiment, but is intentionally not loaded because the
// original four-theme navigation and paper-cut artwork are clearer on mobile.
s = s.split('<script src="poetry-shelf.js"></script>\\n').join('');
s = s.split('<script src="poetry-shelf.js"></script>').join('');

for (const marker of [
  'persistBookOrder = () => {',
  'const effChapterCount =',
  "wordCountLabel: statParts.join(' · ')",
  "epubHref: '#'",
  'else this.downloadEpub(b.title, effEpubUrl);',
  "themes.register('ajk-reader'",
  'Alte Bookmarks aus frueheren Reader-Fehlern',
  'const firstReadable = spineItems.find'
]) {
  if (!s.includes(marker)) throw new Error('Post-patch marker missing: ' + marker);
}

if (s.includes(badEncodedCoverRegex)) {
  throw new Error('Malformed cover regex still present after patch');
}

const templateMatch = s.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
if (!templateMatch) throw new Error('Bundler template not found');
try {
  JSON.parse(templateMatch[1]);
} catch (err) {
  throw new Error('Bundler JSON invalid after patch: ' + err.message);
}

fs.writeFileSync(path, s, 'utf8');
console.log('Patched and JSON-validated index.html:', s.length, 'characters');
