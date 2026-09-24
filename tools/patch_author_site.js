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
// Third books view: cover-only thumbnail wall. Frontend-only; it reuses each
// book's existing onOpen handler, so Apps Script does not need to change.
if (!s.includes('bookCoverGridMode: false')) {
  once(
    'bookTocOpen: false, bookMobileListMode: false, settingsSaveMsg:',
    'bookTocOpen: false, bookMobileListMode: false, bookCoverGridMode: false, settingsSaveMsg:',
    'cover grid state'
  );
}
if (!s.includes('toggleBookCoverGrid =')) {
  once(
    'toggleBookViewMode = () => this.setState(s => ({ bookMobileListMode: !s.bookMobileListMode }));',
    String.raw\`toggleBookViewMode = () => this.setState(s => ({ bookMobileListMode: !s.bookMobileListMode, bookCoverGridMode: false }));\n  toggleBookCoverGrid = () => this.setState(s => ({ bookCoverGridMode: !s.bookCoverGridMode }));\`,
    'cover grid toggle'
  );
}
if (!s.includes('cover-grid-hidden')) {
  once(
    "const bookListWrapClass = 'book-list-wrap' + (s.bookMobileListMode ? ' list-mode' : '');",
    "const bookListWrapClass = 'book-list-wrap' + (s.bookMobileListMode ? ' list-mode' : '') + (s.bookCoverGridMode ? ' cover-grid-hidden' : '');",
    'cover grid list visibility'
  );
}
if (!s.includes("viewAsCovers: 'Cover'")) {
  once(
    "viewAsList: 'Als Liste', viewAsCarousel: 'Als Karussell' },",
    "viewAsList: 'Als Liste', viewAsCarousel: 'Als Karussell', viewAsCovers: 'Cover' },",
    'German cover label'
  );
  once(
    "viewAsList: 'As list', viewAsCarousel: 'As carousel' }",
    "viewAsList: 'As list', viewAsCarousel: 'As carousel', viewAsCovers: 'Covers' }",
    'English cover label'
  );
}
if (!s.includes('const bookCoverGridButtonStyle =')) {
  once(
    "const bookViewToggleLabel = s.bookMobileListMode ? ui.viewAsCarousel : ui.viewAsList;",
    String.raw\`const bookViewToggleLabel = s.bookMobileListMode ? ui.viewAsCarousel : ui.viewAsList;\n    const bookCoverGridButtonLabel = ui.viewAsCovers;\n    const bookCoverGridButtonStyle = s.bookCoverGridMode\n      ? "white-space:nowrap; background:rgba(212,175,55,.08); border:1px solid var(--gold); color:var(--gold); font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; padding:10px 14px; cursor:pointer;"\n      : "white-space:nowrap; background:none; border:1px solid var(--rule); color:var(--ink-2); font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; padding:10px 14px; cursor:pointer;";\`,
    'cover grid button state'
  );
}
if (!s.includes('bookCoverItems: books')) {
  once(
    'bookSearchQuery: s.bookSearchQuery, setBookSearchQuery: this.setBookSearchQuery, bookSearchHasNoResults, bookTocEntries, bookTocOpenClass, toggleBookToc: this.toggleBookToc, bookListWrapClass, bookViewToggleLabel, toggleBookViewMode: this.toggleBookViewMode,',
    'bookSearchQuery: s.bookSearchQuery, setBookSearchQuery: this.setBookSearchQuery, bookSearchHasNoResults, bookTocEntries, bookTocOpenClass, toggleBookToc: this.toggleBookToc, bookListWrapClass, bookViewToggleLabel, toggleBookViewMode: this.toggleBookViewMode, bookCoverGridMode: s.bookCoverGridMode, bookCoverItems: books, bookCoverGridButtonLabel, bookCoverGridButtonStyle, toggleBookCoverGrid: this.toggleBookCoverGrid,',
    'cover grid render values'
  );
}
if (!s.includes('class=\\"book-cover-grid-toggle\\"')) {
  once(
    String.raw\`      <button type=\\"button\\" class=\\"book-view-toggle\\" sc-camel-on-click=\\"{{ toggleBookViewMode }}\\" style=\\"white-space:nowrap; background:none; border:1px solid var(--rule); color:var(--ink-2); font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; padding:10px 14px; cursor:pointer;\\">{{ bookViewToggleLabel }}</button>\n    </div>\n    <div class=\\"{{ bookListWrapClass }}\\"\`,
    String.raw\`      <button type=\\"button\\" class=\\"book-view-toggle\\" sc-camel-on-click=\\"{{ toggleBookViewMode }}\\" style=\\"white-space:nowrap; background:none; border:1px solid var(--rule); color:var(--ink-2); font-family:'Archivo',sans-serif; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; padding:10px 14px; cursor:pointer;\\">{{ bookViewToggleLabel }}</button>\n      <button type=\\"button\\" class=\\"book-cover-grid-toggle\\" sc-camel-on-click=\\"{{ toggleBookCoverGrid }}\\" style=\\"{{ bookCoverGridButtonStyle }}\\">{{ bookCoverGridButtonLabel }}</button>\n    </div>\n    <sc-if value=\\"{{ bookCoverGridMode }}\\" hint-placeholder-val=\\"{{ false }}\\">\n      <div class=\\"book-cover-grid\\" style=\\"display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:24px 16px; padding:24px 0 36px; align-items:start;\\">\n        <sc-for list=\\"{{ bookCoverItems }}\\" as=\\"coverBook\\" hint-placeholder-count=\\"14\\">\n          <button type=\\"button\\" sc-camel-on-click=\\"{{ coverBook.onOpen }}\\" aria-label=\\"{{ coverBook.title }}\\" title=\\"{{ coverBook.title }}\\" style=\\"display:block; width:100%; padding:0; border:0; background:none; cursor:pointer; text-align:left;\\">\n            <sc-if value=\\"{{ coverBook.coverUrl }}\\" hint-placeholder-val=\\"{{ false }}\\">\n              <span style=\\"display:block; width:100%; aspect-ratio:2/3; overflow:hidden; border:1px solid var(--rule); box-shadow:0 8px 24px rgba(43,36,28,.08);\\"><img src=\\"{{ coverBook.coverUrl }}\\" alt=\\"{{ coverBook.title }} cover\\" loading=\\"lazy\\" style=\\"display:block; width:100%; height:100%; object-fit:cover;\\"></span>\n            </sc-if>\n            <sc-if value=\\"{{ coverBook.noCover }}\\" hint-placeholder-val=\\"{{ true }}\\">\n              <span style=\\"display:flex; width:100%; aspect-ratio:2/3; box-sizing:border-box; align-items:center; justify-content:center; padding:12px; border:1px solid var(--rule); background:var(--bone-deep); font-family:'Cormorant Garamond',serif; font-size:14px; line-height:1.25; color:var(--ink-3); text-align:center;\\">{{ coverBook.title }}</span>\n            </sc-if>\n          </button>\n        </sc-for>\n      </div>\n    </sc-if>\n    <div class=\\"{{ bookListWrapClass }}\\"\`,
    'cover grid template'
  );
}
if (!s.includes('.cover-grid-hidden{display:none!important}')) {
  once(
    '</head>',
    String.raw\`<style>.cover-grid-hidden{display:none!important}@media(max-width:640px){.book-cover-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:20px 14px!important}}</style>\n</head>\`,
    'cover grid css'
  );
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
