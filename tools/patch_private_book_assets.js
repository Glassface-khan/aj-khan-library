const fs = require('fs');

const path = 'index.html';
let outer = fs.readFileSync(path, 'utf8');
const re = /<script type="__bundler\/template">([\s\S]*?)<\/script>/;
const match = outer.match(re);
if (!match) throw new Error('Bundler template not found');
let app = JSON.parse(match[1]);
if (typeof app !== 'string') throw new Error('Bundler template is not a string');

function replaceBlock(startMarker, endMarker, lines, label) {
  const start = app.indexOf(startMarker);
  if (start < 0) throw new Error(label + ': start marker not found');
  const end = app.indexOf(endMarker, start);
  if (end < 0) throw new Error(label + ': end marker not found');
  app = app.slice(0, start) + lines.join('\n') + '\n' + app.slice(end);
}

app = app.split("this.downloadEpub(b.title, effEpubUrl);")
         .join("this.downloadEpub(b.title, effEpubUrl, effLangCode);");

replaceBlock(
  '        onOpen: (e) => {',
  '        onEpub: (e) => {',
  [
    '        onOpen: (e) => {',
    '          e.preventDefault();',
    '          if (canRead) {',
    "            if (bookIsFinished && effEpubUrl && typeof ePub !== 'undefined') this.openReader(b.title, effEpubUrl, effLangCode);",
    "            else if (effPdfUrl) this.openPrivateBookAsset(b.title, 'manuscript', effLangCode, 0, effPdfUrl);",
    "            else window.alert(this.tr('Noch kein Lesezugriff hinterlegt.', 'No reading access set up yet.'));",
    '          } else {',
    "            if (bookIsFinished && effEpubUrl && restrictedEpubPerm.read && typeof ePub !== 'undefined') this.openReader(b.title, effEpubUrl, effLangCode);",
    "            else window.alert(this.tr('Für dieses Buch hast du (noch) keinen Lesezugriff.', 'You don\\u2019t have reading access to this book (yet).'));",
    '          }',
    '        },'
  ],
  'private Read handler'
);

replaceBlock(
  '        onBg: (e) => {',
  '        onVideo: (e) => {',
  [
    '        onBg: (e) => {',
    '          e.preventDefault();',
    "          if (!canRead) window.alert(this.tr('Nicht verfügbar.', 'Not available.'));",
    "          else if (!b.bgUrl) window.alert(this.tr('Noch keine Hintergrundmaterialien hinterlegt.', 'No background materials available yet.'));",
    "          else this.openPrivateAssetBrowser(b.title, 'background', '', b.bgUrl);",
    '        },'
  ],
  'private Background handler'
);

replaceBlock(
  '        onVideo: (e) => {',
  '        onAlt: (e) => {',
  [
    '        onVideo: (e) => {',
    '          e.preventDefault();',
    "          if (!canRead) window.alert(this.tr('Nicht verfügbar.', 'Not available.'));",
    "          else if (!b.videoUrl) window.alert(this.tr('Noch kein Video hinterlegt.', 'No video available yet.'));",
    "          else this.openPrivateAssetBrowser(b.title, 'video', '', b.videoUrl);",
    '        },'
  ],
  'private Video handler'
);

replaceBlock(
  '        onAlt: (e) => {',
  '        epubColor:',
  [
    '        onAlt: (e) => {',
    '          e.preventDefault();',
    '          if (effAltCovers.length) this.openAltGallery(effAltCovers, b.title);',
    "          else if (!canRead) window.alert(this.tr('Nicht verfügbar.', 'Not available.'));",
    "          else if (!b.altUrl) window.alert(this.tr('Noch keine alternativen Cover hinterlegt.', 'No alternate covers available yet.'));",
    "          else this.openPrivateAssetBrowser(b.title, 'alt', '', b.altUrl);",
    '        },'
  ],
  'private Alt-cover handler'
);

const required = [
  "action: 'getPrivateEpub'",
  "'listPrivateBookAssets'",
  "'getPrivateBookAsset'",
  "openPrivateAssetBrowser(b.title, 'background'",
  "openPrivateAssetBrowser(b.title, 'video'",
  "openPrivateAssetBrowser(b.title, 'alt'",
  "openPrivateBookAsset(b.title, 'manuscript'",
  'downloadEpub(b.title, effEpubUrl, effLangCode)'
];
for (const marker of required) {
  if (!app.includes(marker)) throw new Error('Required secure marker missing: ' + marker);
}

const forbidden = [
  "readHref: (canRead && effPdfUrl) ? effPdfUrl",
  "bgHref: (canRead && b.bgUrl) ? b.bgUrl",
  "videoHref: (canRead && b.videoUrl) ? b.videoUrl",
  "downloadEpub(b.title, effEpubUrl);"
];
for (const marker of forbidden) {
  if (app.includes(marker)) throw new Error('Legacy private-link marker still present: ' + marker);
}

const encoded = JSON.stringify(app).split('</script>').join('<\\/script>');
const newTag = match[0].replace(match[1], encoded);
outer = outer.slice(0, match.index) + newTag + outer.slice(match.index + match[0].length);

const verify = outer.match(re);
if (!verify) throw new Error('Bundler template missing after rewrite');
const decodedVerify = JSON.parse(verify[1]);
if (decodedVerify !== app) throw new Error('Bundler template round-trip mismatch');

fs.writeFileSync(path, outer, 'utf8');
console.log('Private book actions routed through protected backend.');
