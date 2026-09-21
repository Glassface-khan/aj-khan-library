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
  'const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;',
  String.raw`const effWordCount = (langInfo && langInfo.wordCount) || b.wordCount;\n      const effChapterCount = (langInfo && langInfo.chapterCount) || b.chapterCount;\n      const effPageCount = (langInfo && langInfo.pageCount) || b.pageCount;`,
  'effective metadata'
);

once(
  'const wc = Number(effWordCount) || 0;',
  String.raw`const wc = Number(effWordCount) || 0;\n      const cc = Number(effChapterCount) || 0;\n      const pc = Number(effPageCount) || 0;\n      const statLocale = s.uiLang === 'en' ? 'en-US' : 'de-DE';\n      const statParts = [];\n      if (wc) statParts.push(wc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' words' : ' Wörter'));\n      if (pc) statParts.push(pc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' pages' : ' Seiten'));\n      else if (cc) statParts.push(cc.toLocaleString(statLocale) + (s.uiLang === 'en' ? ' chapters' : ' Kapitel'));`,
  'stats calculation'
);

const labelStart = s.indexOf('        wordCountLabel:');
const labelEnd = s.indexOf('        bandLabel:', labelStart);
if (labelStart < 0 || labelEnd < 0) throw new Error('stats label boundaries not found');
s = s.slice(0, labelStart) + String.raw`        wordCountLabel: statParts.join(' · '),\n        hasWordCount: statParts.length > 0,\n` + s.slice(labelEnd);

once(
  "epubHref: (canRead && effEpubUrl && bookIsFinished) ? effEpubUrl : '#',",
  "epubHref: '#',",
  'epub href'
);

const handlerStart = s.indexOf('onEpub: (e) => {');
const handlerEnd = s.indexOf('        onBg: (e) => {', handlerStart);
if (handlerStart < 0 || handlerEnd < 0) throw new Error('EPUB click handler boundaries not found');
const handler = String.raw`onEpub: (e) => {\n          // Always use the permission-checked Apps Script endpoint.\n          e.preventDefault();\n          if (canRead) {\n            if (!bookIsFinished) window.alert(this.tr('EPUB gibt es erst, sobald das Buch als Fertig markiert ist — bis dahin über Read lesbar.', 'The EPUB becomes available once the book is marked finished — until then it can be read via Read.'));\n            else if (!effEpubUrl) window.alert(this.tr('Noch keine EPUB-Datei hinterlegt — entsteht automatisch, sobald das Manuskript synchronisiert ist.', 'No EPUB file yet — it is created automatically once the manuscript is synced.'));\n            else this.downloadEpub(b.title, effEpubUrl);\n          } else {\n            if (bookIsFinished && effEpubUrl && restrictedEpubPerm.download) this.downloadEpub(b.title, effEpubUrl);\n            else window.alert(this.tr('Für dieses Buch hast du (noch) keinen Download-Zugriff.', 'You don’t have download access to this book yet.'));\n          }\n        },\n`;
s = s.slice(0, handlerStart) + handler + s.slice(handlerEnd);

for (const marker of [
  'const effChapterCount =',
  "wordCountLabel: statParts.join(' · ')",
  "epubHref: '#'",
  'else this.downloadEpub(b.title, effEpubUrl);'
]) {
  if (!s.includes(marker)) throw new Error('Post-patch marker missing: ' + marker);
}

const templateMatch = s.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
if (!templateMatch) throw new Error('Bundler template not found');
JSON.parse(templateMatch[1]);

fs.writeFileSync(path, s, 'utf8');
console.log('Patched and JSON-validated index.html:', s.length, 'characters');
