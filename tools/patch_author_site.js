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


// COVER GRID VIEW PATCH
// Keep this feature outside the bundled template: the generated page contains
// a JSON-encoded component source, so a standalone progressive-enhancement
// script is safer and leaves the existing carousel/list/detail logic untouched.
if (!s.includes('src="cover-grid.js"')) {
  const bodyEnd = s.lastIndexOf('</body>');
  if (bodyEnd < 0) throw new Error('cover grid script: closing body not found');
  s = s.slice(0, bodyEnd) + '<script src="cover-grid.js"></script>\\n' + s.slice(bodyEnd);
}

for (const marker of [
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
