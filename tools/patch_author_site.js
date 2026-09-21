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

once(
  "const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;",
  "const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;\\n      const effChapterCount = (langInfo && langInfo.chapterCount) || b.chapterCount;\\n      const effPageCount = (langInfo && langInfo.pageCount) || b.pageCount;",
  'effective metadata'
);

once(
  "const wc = Number(effWordCount) || 0;",
  "const wc = Number(effWordCount) || 0;\\n      const cc = Number(effChapterCount) || 0;\\n      const pc = Number(effPageCount) || 0;\\n      const statLocale = s.uiLang === 'en' ? 'en-US' : 'de-DE';\\n      const statParts = [];\\n      if (wc) statParts.push(wc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' words' : ' W\\\\u00f6rter'));\\n      if (pc) statParts.push(pc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' pages' : ' Seiten'));\\n      else if (cc) statParts.push(cc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' chapters' : ' Kapitel'));",
  'stats calculation'
);

once(
  "wordCountLabel: wc ? (wc.toLocaleString('de-DE') + ' W\\u00f6rter') : '',\\n        hasWordCount: wc > 0,",
  "wordCountLabel: statParts.join(' · '),\\n        hasWordCount: statParts.length > 0,",
  'stats label'
);

once(
  "epubHref: (canRead && effEpubUrl && bookIsFinished) ? effEpubUrl : '#',",
  "epubHref: '#',",
  'epub href'
);

const start = s.indexOf("onEpub: (e) => {");
const end = s.indexOf("        onBg: (e) => {", start);
if (start < 0 || end < 0) throw new Error('EPUB click handler markers not found');

const handler =
"onEpub: (e) => {\\n"+
"          // Always download through the permission-checked Apps Script endpoint.\\n"+
"          e.preventDefault();\\n"+
"          if (canRead) {\\n"+
"            if (!bookIsFinished) window.alert(this.tr('EPUB gibt es erst, sobald das Buch als \\\\"Fertig\\\\" markiert ist \\\\u2014 bis dahin \\\\u00fcber \\\\"Read\\\\" lesbar.', 'The EPUB becomes available once the book is marked \\\\"finished\\\\" \\\\u2014 until then it can be read via \\\\"Read\\\\".'));\\n"+
"            else if (!effEpubUrl) window.alert(this.tr('Noch keine EPUB-Datei hinterlegt \\\\u2014 entsteht automatisch, sobald das Manuskript synchronisiert ist.', 'No EPUB file yet \\\\u2014 it is created automatically once the manuscript is synced.'));\\n"+
"            else this.downloadEpub(b.title, effEpubUrl);\\n"+
"          } else {\\n"+
"            if (bookIsFinished && effEpubUrl && restrictedEpubPerm.download) this.downloadEpub(b.title, effEpubUrl);\\n"+
"            else window.alert(this.tr('F\\\\u00fcr dieses Buch hast du (noch) keinen Download-Zugriff.', 'You don\\\\u2019t have download access to this book (yet).'));\\n"+
"          }\\n"+
"        },\\n";

s = s.slice(0, start) + handler + s.slice(end);

// Lightweight safety checks for the bundled JSON/script text.
for (const marker of [
  "const effChapterCount =",
  "wordCountLabel: statParts.join(' · ')",
  "epubHref: '#'",
  "else this.downloadEpub(b.title, effEpubUrl);"
]) {
  if (!s.includes(marker)) throw new Error('Post-patch marker missing: ' + marker);
}

fs.writeFileSync(path, s, 'utf8');
console.log('Patched index.html successfully:', s.length, 'bytes/chars');
