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


// AJK PRIVATE BOOK ASSET PROXY
// Manuscript/Read, background, video and Drive-based alternate covers never
// use a raw Drive href. Full-access readers/admin request a server-side
// manifest and then the selected file bytes.
if (!s.includes('openPrivateBookAsset = (title, assetType')) {
  s = s.split("readHref: (canRead && effPdfUrl) ? effPdfUrl : '#',").join("readHref: '#',");
  s = s.split("bgHref: (canRead && b.bgUrl) ? b.bgUrl : '#',").join("bgHref: '#',");
  s = s.split("videoHref: (canRead && b.videoUrl) ? b.videoUrl : '#',").join("videoHref: '#',");
  s = s.split("altHref: effAltCovers.length ? '#' : ((canRead && b.altUrl) ? b.altUrl : '#'),").join("altHref: '#',");

  const oldOpenHandler = String.raw`        onOpen: (e) => {\n          if (canRead) {\n            if (bookIsFinished && effEpubUrl && typeof ePub !== 'undefined') { e.preventDefault(); this.openReader(b.title, effEpubUrl, effLangCode); }\n            else if (!effPdfUrl) { e.preventDefault(); window.alert(this.tr('Noch kein Lesezugriff hinterlegt.', 'No reading access set up yet.')); }\n          } else {\n            e.preventDefault();\n            if (bookIsFinished && effEpubUrl && restrictedEpubPerm.read && typeof ePub !== 'undefined') { this.openReader(b.title, effEpubUrl, effLangCode); }\n            else window.alert(this.tr('Für dieses Buch hast du (noch) keinen Lesezugriff.', 'You don\\u2019t have reading access to this book (yet).'));\n          }\n        },`;
  const newOpenHandler = String.raw`        onOpen: (e) => {\n          e.preventDefault();\n          if (canRead) {\n            if (bookIsFinished && effEpubUrl && typeof ePub !== 'undefined') this.openReader(b.title, effEpubUrl, effLangCode);\n            else if (effPdfUrl) this.openPrivateBookAsset(b.title, 'manuscript', effLangCode, 0, effPdfUrl);\n            else window.alert(this.tr('Noch kein Lesezugriff hinterlegt.', 'No reading access set up yet.'));\n          } else {\n            if (bookIsFinished && effEpubUrl && restrictedEpubPerm.read && typeof ePub !== 'undefined') this.openReader(b.title, effEpubUrl, effLangCode);\n            else window.alert(this.tr('Für dieses Buch hast du (noch) keinen Lesezugriff.', 'You don\\u2019t have reading access to this book (yet).'));\n          }\n        },`;
  if(s.includes(oldOpenHandler)) s=s.replace(oldOpenHandler,newOpenHandler);

  const oldBg = String.raw`        onBg: (e) => {\n          if (!canRead) { e.preventDefault(); window.alert(this.tr('Nicht verfügbar.', 'Not available.')); }\n          else if (!b.bgUrl) { e.preventDefault(); window.alert(this.tr('Noch keine Hintergrundmaterialien hinterlegt.', 'No background materials available yet.')); }\n        },`;
  const newBg = String.raw`        onBg: (e) => {\n          e.preventDefault();\n          if (!canRead) window.alert(this.tr('Nicht verfügbar.', 'Not available.'));\n          else if (!b.bgUrl) window.alert(this.tr('Noch keine Hintergrundmaterialien hinterlegt.', 'No background materials available yet.'));\n          else this.openPrivateAssetBrowser(b.title, 'background', '', b.bgUrl);\n        },`;
  if(s.includes(oldBg)) s=s.replace(oldBg,newBg);

  const oldVideo = String.raw`        onVideo: (e) => {\n          if (!canRead) { e.preventDefault(); window.alert(this.tr('Nicht verfügbar.', 'Not available.')); }\n          else if (!b.videoUrl) { e.preventDefault(); window.alert(this.tr('Noch kein Video hinterlegt.', 'No video available yet.')); }\n        },`;
  const newVideo = String.raw`        onVideo: (e) => {\n          e.preventDefault();\n          if (!canRead) window.alert(this.tr('Nicht verfügbar.', 'Not available.'));\n          else if (!b.videoUrl) window.alert(this.tr('Noch kein Video hinterlegt.', 'No video available yet.'));\n          else this.openPrivateAssetBrowser(b.title, 'video', '', b.videoUrl);\n        },`;
  if(s.includes(oldVideo)) s=s.replace(oldVideo,newVideo);

  const oldAlt = String.raw`        onAlt: (e) => {\n          if (effAltCovers.length) { e.preventDefault(); this.openAltGallery(effAltCovers, b.title); }\n          else if (!canRead) { e.preventDefault(); window.alert(this.tr('Nicht verfügbar.', 'Not available.')); }\n          else if (!b.altUrl) { e.preventDefault(); window.alert(this.tr('Noch keine alternativen Cover hinterlegt.', 'No alternate covers available yet.')); }\n        },`;
  const newAlt = String.raw`        onAlt: (e) => {\n          e.preventDefault();\n          if (effAltCovers.length) this.openAltGallery(effAltCovers, b.title);\n          else if (!canRead) window.alert(this.tr('Nicht verfügbar.', 'Not available.'));\n          else if (!b.altUrl) window.alert(this.tr('Noch keine alternativen Cover hinterlegt.', 'No alternate covers available yet.'));\n          else this.openPrivateAssetBrowser(b.title, 'alt', '', b.altUrl);\n        },`;
  if(s.includes(oldAlt)) s=s.replace(oldAlt,newAlt);

  const methodAnchor='  openReader = (title, epubRef, langCode) => {';
  const pos=s.indexOf(methodAnchor);
  if(pos<0) throw new Error('private asset method anchor not found');
  const methods=String.raw`  privateAssetRequestParams = (action, title, assetType, langCode, index) => new URLSearchParams({\n    action: action,\n    bookTitle: title || '',\n    assetType: assetType || '',\n    langCode: langCode || '',\n    index: String(index || 0),\n    code: this.state.visitorAccessCode || '',\n    adminToken: this.state.adminToken || ''\n  });\n  closePrivateAssetOverlay = () => {\n    const el = document.getElementById('ajk-private-asset-overlay');\n    if (el && el.parentNode) el.parentNode.removeChild(el);\n  };\n  openPrivateAssetFile = (title, assetType, langCode, index, legacyRef) => {\n    const params = this.privateAssetRequestParams('getPrivateBookAsset', title, assetType, langCode, index);\n    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (data && !data.ok && /unknown action/i.test(String(data.error || '')) && /^https?:\\/\\/(?:drive|docs)\\.google\\.com\\//i.test(String(legacyRef || ''))) {\n          window.open(legacyRef, '_blank', 'noopener');\n          return;\n        }\n        if (!data || !data.ok) { window.alert((data && data.error) || 'Datei konnte nicht geladen werden.'); return; }\n        const raw = atob(data.dataBase64 || '');\n        const bytes = new Uint8Array(raw.length);\n        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);\n        const blob = new Blob([bytes], { type: data.mimeType || 'application/octet-stream' });\n        const url = URL.createObjectURL(blob);\n        const mime = String(data.mimeType || '').toLowerCase();\n        if (mime.indexOf('image/') === 0 || mime.indexOf('video/') === 0 || mime === 'application/pdf') {\n          const w = window.open(url, '_blank', 'noopener');\n          if (!w) window.location.href = url;\n          setTimeout(() => URL.revokeObjectURL(url), 60000);\n        } else {\n          const a = document.createElement('a');\n          a.href = url; a.download = data.fileName || 'datei';\n          document.body.appendChild(a); a.click(); document.body.removeChild(a);\n          setTimeout(() => URL.revokeObjectURL(url), 5000);\n        }\n      })\n      .catch(() => window.alert('Verbindung fehlgeschlagen — bitte erneut versuchen.'));\n  };\n  openPrivateAssetBrowser = (title, assetType, langCode, legacyRef) => {\n    const params = this.privateAssetRequestParams('listPrivateBookAssets', title, assetType, langCode, 0);\n    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (data && !data.ok && /unknown action/i.test(String(data.error || '')) && /^https?:\\/\\/(?:drive|docs)\\.google\\.com\\//i.test(String(legacyRef || ''))) {\n          window.open(legacyRef, '_blank', 'noopener');\n          return;\n        }\n        if (!data || !data.ok) { window.alert((data && data.error) || 'Dateien konnten nicht geladen werden.'); return; }\n        const items = Array.isArray(data.items) ? data.items : [];\n        if (!items.length) { window.alert(this.tr('Keine Dateien vorhanden.', 'No files available.')); return; }\n        if (items.length === 1) { this.openPrivateAssetFile(title, assetType, langCode, items[0].index || 0, legacyRef); return; }\n        this.closePrivateAssetOverlay();\n        const overlay=document.createElement('div'); overlay.id='ajk-private-asset-overlay';\n        overlay.style.cssText='position:fixed;inset:0;background:rgba(22,20,15,.92);z-index:99999;padding:24px;overflow:auto;color:#eee5d2;font-family:Arial,sans-serif';\n        const panel=document.createElement('div'); panel.style.cssText='max-width:720px;margin:40px auto;background:#201d17;border:1px solid #5b5040;padding:22px';\n        const head=document.createElement('div'); head.style.cssText='display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:18px';\n        const h=document.createElement('div'); h.textContent=title; h.style.cssText='font-size:20px'; head.appendChild(h);\n        const close=document.createElement('button'); close.textContent=this.tr('Schließen','Close'); close.onclick=this.closePrivateAssetOverlay; close.style.cssText='padding:8px 12px;background:none;color:#eee5d2;border:1px solid #756750'; head.appendChild(close); panel.appendChild(head);\n        items.forEach(item => {\n          const b=document.createElement('button');\n          b.type='button'; b.textContent=item.name || ('Datei '+(item.index+1));\n          b.style.cssText='display:block;width:100%;text-align:left;margin:8px 0;padding:12px;background:#171510;color:#eee5d2;border:1px solid #51483a';\n          b.onclick=()=>this.openPrivateAssetFile(title, assetType, langCode, item.index || 0, legacyRef);\n          panel.appendChild(b);\n        });\n        overlay.appendChild(panel); overlay.onclick=(e)=>{if(e.target===overlay)this.closePrivateAssetOverlay();}; document.body.appendChild(overlay);\n      })\n      .catch(() => window.alert('Verbindung fehlgeschlagen — bitte erneut versuchen.'));\n  };\n  openPrivateBookAsset = (title, assetType, langCode, index, legacyRef) => this.openPrivateAssetFile(title, assetType, langCode, index || 0, legacyRef);\n`;
  s=s.slice(0,pos)+methods+s.slice(pos);
}


// AJK PRIVATE EPUB PROXY
// Public browser data now contains only opaque private-epub markers. Resolve
// the real Drive file server-side by book title + language; never send a Drive
// ID or URL to the browser.
if (!s.includes("action: 'getPrivateEpub'")) {
  once(
    String.raw`      const effEpubUrl = (langInfo && langInfo.epubUrl) || b.epubUrl;\n      const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;`,
    String.raw`      const effEpubUrl = (langInfo && langInfo.epubUrl) || b.epubUrl;\n      const effLangCode = activeLang || (langCodes.length === 1 ? langCodes[0] : '');\n      const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;`,
    'private epub effective language'
  );

  s = s.split("this.openReader(b.title, effEpubUrl);").join("this.openReader(b.title, effEpubUrl, effLangCode);");
  s = s.split("this.downloadEpub(b.title, effEpubUrl);").join("this.downloadEpub(b.title, effEpubUrl, effLangCode);");

  const openStart = s.indexOf('  openReader = (title, epubUrl) => {');
  const mountStart = s.indexOf('  mountEpubReader = (base64, serverCfi) => {', openStart);
  if (openStart < 0 || mountStart < 0) throw new Error('private epub method boundaries not found');

  const methods = String.raw`  openReader = (title, epubRef, langCode) => {\n    // No Drive URL is kept client-side. This opaque key is only for bookmarks.\n    const privateKey = 'private-epub:' + title + ':' + (langCode || '');\n    this.currentEpubUrl = privateKey;\n    this.setState({ readerOpen: true, readerBookTitle: title, readerLoading: true, readerError: '' });\n    const code = this.state.visitorAccessCode || '';\n    const epubParams = new URLSearchParams({ action: 'getPrivateEpub', bookTitle: title, langCode: langCode || '', intent: 'read', code: code, adminToken: this.state.adminToken || '' });\n    const bookmarkFetch = code\n      ? fetch(this.SCRIPT_URL, { method: 'POST', body: new URLSearchParams({ action: 'getBookmark', epubUrl: privateKey, code: code }) }).then(r => r.json()).catch(() => ({ ok: false }))\n      : Promise.resolve({ ok: false });\n    Promise.all([\n      fetch(this.SCRIPT_URL, { method: 'POST', body: epubParams }).then(r => r.json()),\n      bookmarkFetch\n    ])\n      .then(([epubData, bookmarkData]) => {\n        if (epubData.ok) this.setState({ readerLoading: false }, () => this.mountEpubReader(epubData.dataBase64, (bookmarkData && bookmarkData.ok && bookmarkData.cfi) || ''));\n        else this.setState({ readerLoading: false, readerError: epubData.error || 'EPUB konnte nicht geladen werden.' });\n      })\n      .catch(() => this.setState({ readerLoading: false, readerError: 'Verbindung fehlgeschlagen — bitte erneut versuchen.' }));\n  };\n  downloadEpub = (title, epubRef, langCode) => {\n    const params = new URLSearchParams({ action: 'getPrivateEpub', bookTitle: title, langCode: langCode || '', intent: 'download', code: this.state.visitorAccessCode || '', adminToken: this.state.adminToken || '' });\n    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (!data.ok) { window.alert(data.error || 'Download nicht möglich.'); return; }\n        const raw = atob(data.dataBase64);\n        const bytes = new Uint8Array(raw.length);\n        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);\n        const blob = new Blob([bytes], { type: data.mimeType || 'application/epub+zip' });\n        const url = URL.createObjectURL(blob);\n        const a = document.createElement('a');\n        a.href = url; a.download = data.fileName || ((title || 'buch').replace(/[^\\w\\-. ]+/g, '') + '.epub');\n        document.body.appendChild(a); a.click(); document.body.removeChild(a);\n        setTimeout(() => URL.revokeObjectURL(url), 5000);\n      })\n      .catch(() => window.alert('Verbindung fehlgeschlagen — bitte erneut versuchen.'));\n  };\n`;

  s = s.slice(0, openStart) + methods + s.slice(mountStart);
}


// AJK PRIVATE EPUB LEGACY FALLBACK
// During the one deployment window in which the frontend is newer than the
// Apps Script backend, retry the already permission-checked legacy endpoint
// only when the backend reports "unknown action" and the current catalogue
// still supplied a legacy Drive EPUB URL. Once getPrivateEpub is deployed,
// this branch is never used.
if (!s.includes('AJK private EPUB legacy fallback')) {
  const oldOpenFetch = String.raw`    Promise.all([\n      fetch(this.SCRIPT_URL, { method: 'POST', body: epubParams }).then(r => r.json()),\n      bookmarkFetch\n    ])`;
  const newOpenFetch = String.raw`    const privateFetch = fetch(this.SCRIPT_URL, { method: 'POST', body: epubParams }).then(r => r.json()).then(data => {\n      // AJK private EPUB legacy fallback\n      if (data && !data.ok && /unknown action/i.test(String(data.error || '')) && /^https?:\\/\\/(?:drive|docs)\\.google\\.com\\//i.test(String(epubRef || ''))) {\n        const legacy = new URLSearchParams({ action: 'getEpubData', epubUrl: epubRef, bookTitle: title, intent: 'read', code: code, adminToken: this.state.adminToken || '' });\n        return fetch(this.SCRIPT_URL, { method: 'POST', body: legacy }).then(r => r.json());\n      }\n      return data;\n    });\n    Promise.all([\n      privateFetch,\n      bookmarkFetch\n    ])`;
  if (s.includes(oldOpenFetch)) s = s.replace(oldOpenFetch, newOpenFetch);

  const oldDownloadFetch = String.raw`    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {`;
  const newDownloadFetch = String.raw`    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (data && !data.ok && /unknown action/i.test(String(data.error || '')) && /^https?:\\/\\/(?:drive|docs)\\.google\\.com\\//i.test(String(epubRef || ''))) {\n          const legacy = new URLSearchParams({ action: 'getEpubData', epubUrl: epubRef, bookTitle: title, intent: 'download', code: this.state.visitorAccessCode || '', adminToken: this.state.adminToken || '' });\n          return fetch(this.SCRIPT_URL, { method: 'POST', body: legacy }).then(r => r.json());\n        }\n        return data;\n      })\n      .then(data => {`;
  const pos=s.indexOf('  downloadEpub = (title, epubRef, langCode) => {');
  if(pos>=0){
    const tail=s.slice(pos);
    const rel=tail.indexOf(oldDownloadFetch);
    if(rel>=0) s=s.slice(0,pos+rel)+newDownloadFetch+s.slice(pos+rel+oldDownloadFetch.length);
  }
}



// ADMIN BOOK ORDER PERSISTENCE
// Arrow moves in the Admin panel use a dedicated lightweight endpoint so a
// reorder cannot accidentally overwrite metadata or trigger Drive cleanup.
if (!s.includes('persistBookOrder = () => {')) {
  once(
    String.raw`moveBookUp = (i) => {\n    if (i <= 0) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i - 1]; books[i - 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBooks());\n  };\n  moveBookDown = (i) => {\n    if (i >= this.state.books.length - 1) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i + 1]; books[i + 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBooks());\n  };`,
    String.raw`persistBookOrder = () => {\n    // AJK saveBookOrder fallback to saveBooks\n    const books = this.state.books || [];\n    const order = books.map(b => ({ id: b.id || '', title: b.title || '' }));\n    try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}\n    const saveLegacy = () => {\n      const legacyParams = new URLSearchParams({ action: 'saveBooks', books: JSON.stringify(books), adminToken: this.state.adminToken });\n      return fetch(this.SCRIPT_URL, { method: 'POST', body: legacyParams })\n        .then(r => r.json())\n        .then(data => {\n          if (!data || !data.ok) throw new Error((data && data.error) || 'saveBooks fehlgeschlagen');\n          this.showSavedToast('Reihenfolge gespeichert ✓');\n        });\n    };\n    const params = new URLSearchParams({ action: 'saveBookOrder', order: JSON.stringify(order), adminToken: this.state.adminToken });\n    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (data && data.ok) {\n          this.showSavedToast('Reihenfolge gespeichert ✓');\n          return;\n        }\n        const err = (data && data.error) || 'unbekannt';\n        if (/unknown action/i.test(err)) return saveLegacy();\n        throw new Error(err);\n      })\n      .catch(err => {\n        window.alert('Reihenfolge konnte nicht zentral gespeichert werden: ' + err.message + '. Die Server-Reihenfolge wird neu geladen.');\n        this.fetchBooks();\n      });\n  };\n  moveBookUp = (i) => {\n    if (i <= 0) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i - 1]; books[i - 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBookOrder());\n  };\n  moveBookDown = (i) => {\n    if (i >= this.state.books.length - 1) return;\n    this.setState(s => {\n      const books = s.books.slice();\n      const tmp = books[i + 1]; books[i + 1] = books[i]; books[i] = tmp;\n      return { books };\n    }, () => this.persistBookOrder());\n  };`,
    'admin book order persistence'
  );
}


// ADMIN BOOK ORDER FALLBACK
// Older live Apps Script deployments do not yet know saveBookOrder. In that
// case fall back to the long-standing saveBooks endpoint so arrow moves already
// persist centrally before the next Apps Script deployment.
if (!s.includes('AJK saveBookOrder fallback to saveBooks')) {
  const oldPersistBookOrder = String.raw`persistBookOrder = () => {\n    const books = this.state.books || [];\n    const order = books.map(b => ({ id: b.id || '', title: b.title || '' }));\n    try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}\n    const params = new URLSearchParams({ action: 'saveBookOrder', order: JSON.stringify(order), adminToken: this.state.adminToken });\n    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (data && data.ok) {\n          this.showSavedToast('Reihenfolge gespeichert ✓');\n        } else {\n          window.alert('Reihenfolge konnte nicht zentral gespeichert werden: ' + ((data && data.error) || 'unbekannt') + '. Die Server-Reihenfolge wird neu geladen.');\n          this.fetchBooks();\n        }\n      })\n      .catch(err => {\n        window.alert('Verbindung fehlgeschlagen: ' + err.message + '. Die Server-Reihenfolge wird neu geladen.');\n        this.fetchBooks();\n      });\n  };`;
  const newPersistBookOrder = String.raw`persistBookOrder = () => {\n    // AJK saveBookOrder fallback to saveBooks\n    const books = this.state.books || [];\n    const order = books.map(b => ({ id: b.id || '', title: b.title || '' }));\n    try { localStorage.setItem('ajk_author_books_draft', JSON.stringify({ books })); } catch (e) {}\n    const saveLegacy = () => {\n      const legacyParams = new URLSearchParams({ action: 'saveBooks', books: JSON.stringify(books), adminToken: this.state.adminToken });\n      return fetch(this.SCRIPT_URL, { method: 'POST', body: legacyParams })\n        .then(r => r.json())\n        .then(data => {\n          if (!data || !data.ok) throw new Error((data && data.error) || 'saveBooks fehlgeschlagen');\n          this.showSavedToast('Reihenfolge gespeichert ✓');\n        });\n    };\n    const params = new URLSearchParams({ action: 'saveBookOrder', order: JSON.stringify(order), adminToken: this.state.adminToken });\n    fetch(this.SCRIPT_URL, { method: 'POST', body: params })\n      .then(r => r.json())\n      .then(data => {\n        if (data && data.ok) {\n          this.showSavedToast('Reihenfolge gespeichert ✓');\n          return;\n        }\n        const err = (data && data.error) || 'unbekannt';\n        if (/unknown action/i.test(err)) return saveLegacy();\n        throw new Error(err);\n      })\n      .catch(err => {\n        window.alert('Reihenfolge konnte nicht zentral gespeichert werden: ' + err.message + '. Die Server-Reihenfolge wird neu geladen.');\n        this.fetchBooks();\n      });\n  };`;
  if (s.includes(oldPersistBookOrder)) once(oldPersistBookOrder, newPersistBookOrder, 'admin book order fallback upgrade');
}


// COVER GRID VIEW PATCH
// Use a new runtime filename so Safari/iOS cannot execute an older cached
// cover-grid implementation. Remove every previous cover-grid script tag
// before appending exactly one current runtime.
const coverGridSrc = 'cover-grid-v3.js?v=20260930e';
s = s.replace(/<script src="cover-grid(?:-v[23])?\.js(?:\?[^"]*)?"><\/script>\s*/g, '');
{
  const bodyEnd = s.lastIndexOf('</body>');
  if (bodyEnd < 0) throw new Error('cover grid script: closing body not found');
  s = s.slice(0, bodyEnd) + '<script src="' + coverGridSrc + '"></script>\n' + s.slice(bodyEnd);
}


// DISPLAY PREFERENCES
// Per-browser text contrast setting. Kept frontend-only on purpose.
const displayPreferencesSrc = 'display-preferences.js?v=20260929c';
s = s.replace(/<script src="display-preferences\.js(?:\?[^"]*)?"><\/script>\s*/g, '');
{
  const bodyEnd = s.lastIndexOf('</body>');
  if (bodyEnd < 0) throw new Error('display preferences: closing body not found');
  s = s.slice(0, bodyEnd) + '<script src="' + displayPreferencesSrc + '"></script>\n' + s.slice(bodyEnd);
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
  "action: 'getPrivateEpub'",
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
