/**
 * SNAPSHOT — vom Nutzer am 09.09.2026 im Chat eingefügt, hier als
 * Referenz-Kopie abgelegt (kein automatischer Sync — die Live-Quelle ist
 * weiterhin ausschließlich der Apps-Script-Editor im Google-Konto des
 * Autors, siehe ARCHITECTURE.md §2). Kann bei künftigen Backend-Änderungen
 * als Ausgangspunkt für exakte, geprüfte Patches dienen, statt bei jeder
 * Session erneut blind zu raten. Kann von der Live-Version abweichen, wenn
 * seither direkt im Editor weitergearbeitet wurde, ohne diese Kopie
 * nachzuziehen.
 */

function doGet(e) {
  return handle(e);
}
function doPost(e) {
  return handle(e);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Admin-Tokens werden jetzt in PropertiesService gespeichert (wie
// ADMIN_PASSWORD auch), nicht mehr in CacheService — zuverlässiger.
// Eigene 24h-Ablauflogik statt der eingebauten Cache-Ablaufzeit.
function checkAdmin(e) {
  const token = e.parameter.adminToken || '';
  if (!token) return { ok: false, token: token, cached: null };
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('admintoken_' + token);
  if (!stored) return { ok: false, token: token, cached: null };
  const issuedAt = Number(stored);
  const valid = (Date.now() - issuedAt) < 24 * 60 * 60 * 1000;
  return { ok: valid, token: token, cached: stored };
}

// null = alle Bücher sichtbar (Standard); sonst Array erlaubter Titel.
function parseVisibleBooks_(cellValue) {
  const raw = String(cellValue || '').trim();
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return (Array.isArray(arr) && arr.length) ? arr : null;
  } catch (e) {
    return null;
  }
}

// true = Gedichte (Heartfelt) sichtbar (Standard, auch wenn die Zelle leer
// ist — rückwärtskompatibel zu allen Zugängen ohne diese Spalte); nur ein
// expliziter FALSE-Wert blendet die Gedichte für diesen Zugang aus.
function parseShowPoems_(cellValue) {
  if (cellValue === '' || cellValue === null || cellValue === undefined) return true;
  return cellValue === true || String(cellValue).toUpperCase() === 'TRUE';
}

// {} = kein feingranularer EPUB-Zugriff (Standard — wichtig: anders als bei
// VisibleBooks/ShowPoems ist der Default hier "kein Zugriff", nicht "alles
// erlaubt", weil das eine bewusste Freigabe pro Buch sein soll, kein
// nachtraeglich abgeschaltetes Feature). Form: { "Buchtitel": { read: bool,
// download: bool } }. Betrifft nur Nutzer OHNE vollen Lesezugriff
// (CanDownload=false) — bei CanDownload=true ist das komplett irrelevant,
// die duerfen ohnehin alles.
function parseEpubAccess_(cellValue) {
  const raw = String(cellValue || '').trim();
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch (e) {
    return {};
  }
}

function generateAccessCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Liest den Volltext eines Google Docs, .docx/.doc (Umweg über eine
// temporäre Google-Docs-Kopie) oder einer reinen Textdatei (.md/.txt)
// und gibt den reinen Text zurück, oder null bei nicht unterstützten
// Dateitypen. Wird sowohl von der manuellen "Wortzahl synchronisieren"-
// Aktion im Admin-Panel als auch vom automatischen Drive-Sync-Trigger
// unten verwendet.
function docTextById(fileId) {
  const file = DriveApp.getFileById(fileId);
  const mime = file.getMimeType();
  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/x-markdown' || mime === 'application/json') {
    return file.getBlob().getDataAsString();
  }
  let tempDocId = null;
  try {
    let docId;
    if (mime === MimeType.GOOGLE_DOCS) {
      docId = fileId;
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword'
    ) {
      const copy = Drive.Files.copy({ mimeType: MimeType.GOOGLE_DOCS, title: 'tmp-sync' }, fileId, { convert: true });
      tempDocId = copy.id;
      docId = tempDocId;
    } else {
      return null;
    }
    return DocumentApp.openById(docId).getBody().getText();
  } finally {
    if (tempDocId) { try { DriveApp.getFileById(tempDocId).setTrashed(true); } catch (e2) {} }
  }
}

function countWordsInDriveFile(fileId) {
  const text = docTextById(fileId);
  if (text === null) {
    const mime = DriveApp.getFileById(fileId).getMimeType();
    throw new Error('Nicht unterstützter Dateityp (' + mime + ') — bitte Google Doc oder .docx verlinken.');
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ───────────────────────── Drive-Automatisierung ─────────────────────────
//
// Ordnerstruktur pro Buch (Ordnername = exakt der Buchtitel), unter der
// Root-ID unten:
//
//   /<Buchtitel>/
//     /Manuskript/<Sprachcode>/       z.B. DE, EN, BS — nur Ordner für
//         ENTWURF_...                 relevante Sprachen anlegen
//         FINAL_...
//         KLAPPENTEXT_...
//     /Intern/                        Checkliste Teil 1 A (nur Ablage)
//     /Extern/                        Checkliste Teil 1 B (nur Ablage)
//     /Bilder/Cover/                  erstes Bild darin → Buch-Cover
//     /Bilder/Alt-Cover/              (vorbereitet, noch nicht ans UI
//                                      angebunden)
//
// Status je Sprache: kein Ordner → nicht relevant (kein Chip) · Ordner
// ohne FINAL_-Datei → "in Arbeit" · FINAL_-Datei vorhanden → "fertig".
//
// Bei mehreren fertigen Sprachen gleichzeitig wird für Wortzahl und
// Klappentext des Buches standardmäßig EN genommen, sonst die einzige
// fertige Sprache, sonst alphabetisch die erste fertige.

const DRIVE_ROOT_FOLDER_ID = '1wCKKVMexGWRPTWx2yQrnb2b4-fLhKLAU';
const SYNC_PREFERRED_LANGUAGE = 'EN';

function getOrCreateSubfolder(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function findFileByPrefix(folder, prefix) {
  const it = folder.getFiles();
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(prefix) === 0) {
      if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
    }
  }
  return best;
}

function firstImageFile(folder) {
  const it = folder.getFiles();
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType().indexOf('image/') === 0) {
      if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
    }
  }
  return best;
}

// Alle Bilddateien eines Ordners (fuer die Alt-Cover-Galerie, im Unterschied
// zu firstImageFile oben, das nur das neueste Cover-Bild braucht) — aelteste
// zuerst, damit die Reihenfolge in der Galerie stabil bleibt statt bei jedem
// Sync durcheinanderzuspringen.
function allImageFiles_(folder) {
  const it = folder.getFiles();
  const files = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType().indexOf('image/') === 0) files.push(f);
  }
  files.sort(function(a, b) { return a.getLastUpdated() - b.getLastUpdated(); });
  return files;
}

function publicViewUrlFor(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // Freigabe evtl. durch Domain-Richtlinie eingeschränkt — Cover-URL
    // wird trotzdem gesetzt, könnte dann aber ohne Zugriffsrecht sein.
  }
  // lh3.googleusercontent.com/d/… — sowohl uc?export=view als auch
  // thumbnail?id= haben bei eingebetteten <img>-Tags in der Praxis
  // kaputte Bilder geliefert. lh3 ist Googles eigene Bild-CDN-Domain,
  // liefert direkt die Rohdaten ohne Zwischenseite.
  return 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w1000';
}

function ensureBookFolders(rootFolder, bookTitle) {
  const bookFolder = getOrCreateSubfolder(rootFolder, bookTitle);
  const manuskriptFolder = getOrCreateSubfolder(bookFolder, 'Manuskript');
  getOrCreateSubfolder(bookFolder, 'Intern');
  const externFolder = getOrCreateSubfolder(bookFolder, 'Extern');
  const videoFolder = getOrCreateSubfolder(bookFolder, 'Video');
  const bilderFolder = getOrCreateSubfolder(bookFolder, 'Bilder');
  const coverFolder = getOrCreateSubfolder(bilderFolder, 'Cover');
  const altCoverFolder = getOrCreateSubfolder(bilderFolder, 'Alt-Cover');
  return {
    bookFolder: bookFolder,
    manuskriptFolder: manuskriptFolder,
    coverFolder: coverFolder,
    altCoverFolder: altCoverFolder,
    externFolder: externFolder,
    videoFolder: videoFolder
  };
}

function folderHasFiles_(folder) {
  return folder.getFiles().hasNext();
}

function firstVideoFile_(folder) {
  const it = folder.getFiles();
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType().indexOf('video/') === 0) {
      if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
    }
  }
  return best;
}

// Drive-eigene Ansichtsseite (nicht der Direkt-Download-Link wie bei EPUB) —
// spielt Videos direkt im eingebauten Drive-Player im Browser ab, statt sie
// herunterzuladen.
function videoViewUrlFor_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {}
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

// Verlinkt (statt einzelne Bilder einzubetten) den ganzen Alt-Cover-Ordner —
// der bestehende "Alt. covers"-Button auf der Website ist ein simpler
// Link-Button, kein Bild-Karussell, das passt also direkt.
function publicFolderUrlFor_(folder) {
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // wie bei publicViewUrlFor — Freigabe evtl. durch Domain-Richtlinie
    // eingeschränkt, Link wird trotzdem gesetzt.
  }
  return 'https://drive.google.com/drive/folders/' + folder.getId();
}

function scanBookLanguages(manuskriptFolder) {
  const langs = {};
  const it = manuskriptFolder.getFolders();
  while (it.hasNext()) {
    const langFolder = it.next();
    const code = langFolder.getName().trim().toUpperCase();
    if (!code) continue;
    const finalFile = findFileByPrefix(langFolder, 'FINAL_');
    const entwurfFile = findFileByPrefix(langFolder, 'ENTWURF_');
    const klappentextFile = findFileByPrefix(langFolder, 'KLAPPENTEXT_');
    langs[code] = {
      status: finalFile ? 'fertig' : (entwurfFile ? 'in-arbeit' : 'offen'),
      finalFile: finalFile,
      klappentextFile: klappentextFile,
      folder: langFolder
    };
  }
  return langs;
}

function buildTranslationsText(langs) {
  const label = { fertig: 'fertig', 'in-arbeit': 'in Arbeit', offen: 'offen' };
  return Object.keys(langs).sort().map(function(code) {
    return code + ': ' + label[langs[code].status];
  }).join(', ');
}

function pickSyncSourceLanguage(langs) {
  const done = Object.keys(langs).filter(function(c) { return langs[c].status === 'fertig'; });
  if (!done.length) return null;
  if (done.indexOf(SYNC_PREFERRED_LANGUAGE) >= 0) return SYNC_PREFERRED_LANGUAGE;
  return done.sort()[0];
}

function logDriveSync(sheet, bookTitle, message) {
  sheet.appendRow([new Date(), bookTitle, message]);
}

// ───────────────────────── EPUB-Export ─────────────────────────
//
// Baut aus dem reinen Manuskripttext (bereits über docTextById gelesen) eine
// echte, in Apple Books/Google Play Books/Kindle-Import etc. lauffähige
// EPUB-Datei — ganz ohne externe Bibliothek, nur mit Apps Scripts
// eingebauter Utilities.zip(). Läuft automatisch bei jedem Drive-Sync mit,
// sobald sich der Manuskripttext einer fertigen Sprache ändert; kein
// Zusatzklick nötig.

function escapeXml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Erkennt Kapitelüberschriften anhand gängiger Muster (Kapitel 1, Chapter
// One, Teil III, Prolog, Epilog …) — nur wenn die ganze Zeile (kurz, nichts
// anderes drumherum) darauf passt, um keine Erwähnungen mitten im Fließtext
// fälschlich als Überschrift zu werten. Findet sich gar kein Muster, bleibt
// das ganze Buch ein einziges durchlaufendes Kapitel (sicherer Fallback,
// funktioniert immer, nur ohne Kapitel-Sprungmarken).
function splitIntoChapters_(text) {
  const headingRe = /^(chapter|chapitre|kapitel|teil|part|prolog(?:ue)?|epilog(?:ue)?)\b\.?\s*([0-9]+|[ivxlcdm]+)?\.?\s*[:\-–—]?\s*(.{0,60})$/i;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chapters = [];
  let current = { heading: '', lines: [] };
  let foundAny = false;
  lines.forEach(function(line) {
    const trimmed = line.trim();
    const m = (trimmed.length && trimmed.length < 90) ? trimmed.match(headingRe) : null;
    if (m) {
      foundAny = true;
      if (current.heading || current.lines.join('').trim()) chapters.push(current);
      current = { heading: trimmed, lines: [] };
    } else {
      current.lines.push(line);
    }
  });
  if (current.heading || current.lines.join('').trim()) chapters.push(current);
  if (!foundAny) return [{ heading: '', lines: text.replace(/\r\n/g, '\n').split('\n') }];
  return chapters;
}

// Formt Zeilen zu <p>-Absätzen (Leerzeile = Absatzgrenze) — erster Absatz
// eines Kapitels ohne Einzug, alle weiteren mit, wie im klassischen
// Buchsatz üblich.
function linesToXhtmlParagraphs_(lines) {
  const paras = [];
  let buf = [];
  lines.forEach(function(l) {
    if (l.trim() === '') {
      if (buf.length) { paras.push(buf.join(' ')); buf = []; }
    } else {
      buf.push(l.trim());
    }
  });
  if (buf.length) paras.push(buf.join(' '));
  return paras.map(function(p, idx) {
    const cls = idx === 0 ? ' class="first"' : '';
    return '<p' + cls + '>' + escapeXml_(p) + '</p>';
  }).join('\n');
}

const EPUB_CSS =
  'body{font-family:Georgia,"Times New Roman",serif; line-height:1.6; margin:0 6%; color:#1a1a1a;}\n' +
  'h1{font-size:1.35em; font-weight:normal; text-align:center; letter-spacing:.06em; text-transform:uppercase; margin:3em 0 2em;}\n' +
  'p{margin:0; text-indent:1.3em; text-align:justify;}\n' +
  'p.first{text-indent:0;}\n' +
  '.titlepage{text-align:center; margin-top:38%;}\n' +
  '.titlepage h1{font-size:1.9em; text-transform:none; letter-spacing:0; margin-bottom:.3em;}\n' +
  '.titlepage .byline{font-size:1.05em; font-style:italic; color:#555;}\n' +
  '.titlepage hr{width:3em; border:none; border-top:1px solid #999; margin:1.4em auto;}\n' +
  '.coverpage{margin:0; padding:0; text-align:center;}\n' +
  '.coverpage img{max-width:100%; height:auto;}';

// title/author/langCode/chapters wie gehabt; coverBlob optional (Blob des
// Cover-Bilds aus Drive, oder null falls noch kein Cover hinterlegt ist).
function buildEpub_(title, author, langCode, chapters, coverBlob) {
  const uid = 'urn:uuid:' + Utilities.getUuid();
  const blobs = [];

  blobs.push(Utilities.newBlob('application/epub+zip', 'text/plain', 'mimetype'));

  const containerXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
    '  <rootfiles>\n' +
    '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
    '  </rootfiles>\n' +
    '</container>';
  blobs.push(Utilities.newBlob(containerXml, 'application/xml', 'META-INF/container.xml'));
  blobs.push(Utilities.newBlob(EPUB_CSS, 'text/css', 'OEBPS/styles.css'));

  const manifestItems = [];
  const spineItems = [];
  const navItems = [];
  const navPoints = [];
  let playOrder = 1;

  // Cover-Bild + eigene Cover-Seite ganz vorn, falls ein Cover hinterlegt ist.
  let coverMetaTag = '';
  if (coverBlob) {
    const ct = coverBlob.getContentType() || 'image/jpeg';
    const ext = ct.indexOf('png') >= 0 ? 'png' : (ct.indexOf('webp') >= 0 ? 'webp' : 'jpg');
    blobs.push(coverBlob.copyBlob().setName('OEBPS/images/cover.' + ext));
    manifestItems.push('<item id="cover-img" href="images/cover.' + ext + '" media-type="' + ct + '" properties="cover-image"/>');
    coverMetaTag = '<meta name="cover" content="cover-img"/>\n';
    const coverXhtml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + langCode + '">\n' +
      '<head><title>Cover</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>\n' +
      '<body class="coverpage"><img src="images/cover.' + ext + '" alt="Cover"/></body></html>';
    blobs.push(Utilities.newBlob(coverXhtml, 'application/xhtml+xml', 'OEBPS/cover.xhtml'));
    manifestItems.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
    spineItems.push('<itemref idref="cover" linear="yes"/>');
  }

  // Schlichte Titelseite (Titel + Autor) direkt nach dem Cover.
  const titleXhtml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + langCode + '">\n' +
    '<head><title>' + escapeXml_(title) + '</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>\n' +
    '<body><div class="titlepage"><h1>' + escapeXml_(title) + '</h1><hr/><p class="byline">' + escapeXml_(author) + '</p></div></body></html>';
  blobs.push(Utilities.newBlob(titleXhtml, 'application/xhtml+xml', 'OEBPS/title.xhtml'));
  manifestItems.push('<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>');
  spineItems.push('<itemref idref="titlepage" linear="yes"/>');

  chapters.forEach(function(ch, idx) {
    const id = 'chap' + (idx + 1);
    const fname = id + '.xhtml';
    const headingHtml = ch.heading ? '<h1>' + escapeXml_(ch.heading) + '</h1>\n' : '';
    const body = linesToXhtmlParagraphs_(ch.lines);
    const xhtml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + langCode + '">\n' +
      '<head><title>' + escapeXml_(ch.heading || title) + '</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>\n' +
      '<body>\n' + headingHtml + body + '\n</body></html>';
    blobs.push(Utilities.newBlob(xhtml, 'application/xhtml+xml', 'OEBPS/' + fname));
    manifestItems.push('<item id="' + id + '" href="' + fname + '" media-type="application/xhtml+xml"/>');
    spineItems.push('<itemref idref="' + id + '"/>');
    const navLabel = escapeXml_(ch.heading || ('Teil ' + (idx + 1)));
    navItems.push('<li><a href="' + fname + '">' + navLabel + '</a></li>');
    navPoints.push('<navPoint id="np' + playOrder + '" playOrder="' + playOrder + '"><navLabel><text>' + navLabel + '</text></navLabel><content src="' + fname + '"/></navPoint>');
    playOrder++;
  });

  const navXhtml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' + langCode + '">\n' +
    '<head><title>Inhalt</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>\n' +
    '<body><nav epub:type="toc" id="toc"><h1>Inhalt</h1><ol>\n' + navItems.join('\n') + '\n</ol></nav></body></html>';
  blobs.push(Utilities.newBlob(navXhtml, 'application/xhtml+xml', 'OEBPS/nav.xhtml'));

  const ncx =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
    '<head><meta name="dtb:uid" content="' + uid + '"/></head>\n' +
    '<docTitle><text>' + escapeXml_(title) + '</text></docTitle>\n' +
    '<navMap>\n' + navPoints.join('\n') + '\n</navMap></ncx>';
  blobs.push(Utilities.newBlob(ncx, 'application/x-dtbncx+xml', 'OEBPS/toc.ncx'));

  const opf =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '<dc:identifier id="bookid">' + uid + '</dc:identifier>\n' +
    '<dc:title>' + escapeXml_(title) + '</dc:title>\n' +
    '<dc:creator>' + escapeXml_(author) + '</dc:creator>\n' +
    '<dc:language>' + langCode + '</dc:language>\n' +
    coverMetaTag +
    '</metadata>\n' +
    '<manifest>\n' +
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
    '<item id="css" href="styles.css" media-type="text/css"/>\n' +
    manifestItems.join('\n') + '\n' +
    '</manifest>\n' +
    '<spine toc="ncx">\n' + spineItems.join('\n') + '\n</spine>\n' +
    '</package>';
  blobs.push(Utilities.newBlob(opf, 'application/oebps-package+xml', 'OEBPS/content.opf'));

  const zipBlob = Utilities.zip(blobs, 'manuscript.epub');
  return zipBlob.setContentType('application/epub+zip');
}

// Ersetzt (statt anzuhäufen) die EPUB-Datei im jeweiligen Sprachordner —
// fester Dateiname, unabhängig vom Buchtitel, damit ein Titel-Umbenennen
// die Datei nicht verwaist.
function saveEpubToFolder_(folder, blob) {
  const fname = 'manuscript.epub';
  const it = folder.getFilesByName(fname);
  while (it.hasNext()) { it.next().setTrashed(true); }
  return folder.createFile(blob.setName(fname));
}

function epubDownloadUrlFor_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // wie bei publicViewUrlFor — Freigabe evtl. durch Domain-Richtlinie
    // eingeschränkt, Link wird trotzdem gesetzt.
  }
  return 'https://drive.google.com/uc?export=download&id=' + file.getId();
}

// ───────────────────────── BooksData-Speicherung ─────────────────────────
//
// Ein Buch pro ZEILE (Spalte A: Titel, Spalte B: JSON des Buchs) statt
// wie ursprünglich alle Bücher zusammen als ein JSON-Blob in Zelle A1 —
// Google Sheets begrenzt eine einzelne Zelle auf 50.000 Zeichen, was bei
// wachsender Bibliothek (30+ Bücher, immer mehr Felder pro Buch) früher
// oder später gerissen wäre. Liest transparent auch noch das alte
// Einzelzellen-Format (Rückwärtskompatibilität für den allerersten aktuellen
// Bestand), migriert aber beim nächsten Speichern automatisch ins neue
// Format. Die Web-App-Schnittstelle (getBooks/saveBooks) bleibt für den
// Client unverändert — books wird weiterhin als ein JSON-String geliefert
// bzw. entgegengenommen.
function getBooksArray() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('BooksData');
  if (!sheet || sheet.getLastRow() < 1) return [];
  if (sheet.getLastRow() === 1) {
    // Könnte die alte Einzelzellen-Struktur sein (kompletter JSON-Blob in
    // A1) — oder schlicht nur die neue Kopfzeile ohne Bücher.
    const legacy = sheet.getRange('A1').getValue();
    try {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) return arr;
    } catch (e) {}
    return [];
  }
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const books = [];
  rows.forEach(function(r) {
    if (!r[1]) return;
    try { books.push(JSON.parse(r[1])); } catch (e) {}
  });
  return books;
}

function setBooksArray(books) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('BooksData') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('BooksData');
  sheet.clear();
  sheet.getRange(1, 1, 1, 2).setValues([['Title', 'BookJSON']]);
  if (books.length) {
    const rows = books.map(function(b) { return [b.title || '', JSON.stringify(b)]; });
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}

// ───────────────────────── PoemsData-Speicherung ─────────────────────────
//
// Exakt dasselbe Muster wie BooksData (ein Gedicht pro Zeile: Spalte A
// Titel, Spalte B JSON), aus demselben Grund — einzelne Zellen sind bei
// Google Sheets auf 50.000 Zeichen begrenzt, und mit 80+ Gedichten würde
// ein einzelner JSON-Blob irgendwann daran scheitern. Zeilenreihenfolge in
// der Tabelle = Anzeigereihenfolge auf der Website (kein separates
// Sortierfeld nötig, siehe DriveSyncLog-Kommentar bei den Büchern für den
// gleichen Gedanken).
function getPoemsArray() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PoemsData');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const poems = [];
  rows.forEach(function(r) {
    if (!r[1]) return;
    try { poems.push(JSON.parse(r[1])); } catch (e) {}
  });
  return poems;
}

function setPoemsArray(poems) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PoemsData') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('PoemsData');
  sheet.clear();
  sheet.getRange(1, 1, 1, 2).setValues([['Title', 'PoemJSON']]);
  if (poems.length) {
    const rows = poems.map(function(p) { return [p.title || '', JSON.stringify(p)]; });
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}

function syncDriveForAllBooks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('DriveSyncLog') || ss.insertSheet('DriveSyncLog');
  if (logSheet.getLastRow() === 0) logSheet.appendRow(['Zeit', 'Buch', 'Ereignis']);

  const books = getBooksArray();
  if (!books.length) return;

  // Mehrfach vorkommende Buchtitel würden sich sonst denselben
  // Drive-Ordner teilen (oder ihn, je nach Drive-Timing, sogar doppelt
  // anlegen) — einmalig warnen, damit doppelte Bucheinträge im
  // Admin-Panel auffallen und bereinigt werden können.
  const titleCounts = {};
  books.forEach(function(b) {
    if (!b.title) return;
    titleCounts[b.title] = (titleCounts[b.title] || 0) + 1;
  });
  Object.keys(titleCounts).forEach(function(t) {
    if (titleCounts[t] > 1) {
      logDriveSync(logSheet, t, 'Achtung: Titel kommt ' + titleCounts[t] + '× in den Buchdaten vor — evtl. doppelter Bucheintrag im Admin-Panel.');
    }
  });

  const rootFolder = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  const folderCache = {}; // verhindert doppelte Ordner, wenn ein Titel mehrfach in einem Lauf vorkommt
  let changed = false;

  books.forEach(function(b) {
    if (!b.title) return;
    let folders = folderCache[b.title];
    if (!folders) {
      try {
        folders = ensureBookFolders(rootFolder, b.title);
        folderCache[b.title] = folders;
      } catch (err) {
        logDriveSync(logSheet, b.title, 'Ordner-Fehler: ' + err.message);
        return;
      }
    }

    // Cover-Datei wird jetzt schon hier ermittelt (statt erst ganz am Ende
    // wie vorher) — wird gleich unten auch für den EPUB-Export als
    // Titelbild gebraucht.
    let coverFile = null;
    try {
      coverFile = firstImageFile(folders.coverFolder);
    } catch (err) {
      logDriveSync(logSheet, b.title, 'Cover-Fehler: ' + err.message);
    }

    const langs = scanBookLanguages(folders.manuskriptFolder);
    if (Object.keys(langs).length) {
      const newTranslations = buildTranslationsText(langs);
      if (newTranslations !== (b.translations || '')) {
        b.translations = newTranslations;
        changed = true;
        logDriveSync(logSheet, b.title, 'Übersetzungsstatus aktualisiert: ' + newTranslations);
      }

      // Für JEDE fertige Sprache (nicht nur eine "bevorzugte") Wortzahl und
      // Klappentext einlesen und in b.langs[code] ablegen — füllt den
      // Sprach-Umschalter auf der Website automatisch. Die alten
      // Top-Level-Felder (b.wordCount/b.hook) bleiben zusätzlich gepflegt,
      // abgeleitet aus der bevorzugten Sprache — rückwärtskompatibel für
      // Bücher ohne Sprach-Umschalter.
      const completedCodes = Object.keys(langs).filter(function(c) { return langs[c].status === 'fertig'; }).sort();
      const newLangs = Object.assign({}, b.langs || {});
      completedCodes.forEach(function(code) {
        const info = langs[code];
        const entry = Object.assign({}, newLangs[code] || {});
        let entryChanged = false;
        let manuscriptText = '';
        try {
          const text = docTextById(info.finalFile.getId());
          if (text) {
            manuscriptText = text;
            const words = text.trim().split(/\s+/).filter(Boolean).length;
            if (words && words !== entry.wordCount) { entry.wordCount = words; entryChanged = true; }
          }
        } catch (err) {
          logDriveSync(logSheet, b.title, 'Wortzahl-Fehler (' + code + '): ' + err.message);
        }
        if (info.klappentextFile) {
          try {
            const blurb = docTextById(info.klappentextFile.getId());
            if (blurb && blurb.trim()) {
              let text = blurb.trim();
              const MAX_HOOK_LENGTH = 4000;
              let note = '';
              if (text.length > MAX_HOOK_LENGTH) {
                text = text.slice(0, MAX_HOOK_LENGTH) + '…';
                note = ' — ACHTUNG: gekürzt, vermutlich kein echter Klappentext, bitte Datei prüfen.';
              }
              if (text !== entry.hook) { entry.hook = text; entryChanged = true; }
              if (note) logDriveSync(logSheet, b.title, 'Klappentext (' + code + ')' + note);
            }
          } catch (err) {
            logDriveSync(logSheet, b.title, 'Klappentext-Fehler (' + code + '): ' + err.message);
          }
        }

        // EPUB neu bauen — nur wenn sich der Manuskripttext gerade geändert
        // hat (entryChanged aus dem Wortzahl-Block) oder noch gar keine
        // EPUB existiert. So läuft der Zip-Bau nicht bei jedem stündlichen
        // Sync unnötig erneut, nur wenn tatsächlich eine neue FINAL_-
        // Fassung erkannt wurde. Liest gut auf Handy/iPad (verstellbare
        // Schrift, Kapitel-Navigation) statt nur PDF/Drive-Link.
        if (manuscriptText && (entryChanged || !entry.epubUrl)) {
          try {
            const chapters = splitIntoChapters_(manuscriptText);
            const epubBlob = buildEpub_(b.title, 'A. J. Khan', code.toLowerCase(), chapters, coverFile ? coverFile.getBlob() : null);
            const epubFile = saveEpubToFolder_(info.folder, epubBlob);
            const epubUrl = epubDownloadUrlFor_(epubFile);
            if (epubUrl !== entry.epubUrl) {
              entry.epubUrl = epubUrl;
              entryChanged = true;
              logDriveSync(logSheet, b.title, 'EPUB aktualisiert (' + code + '): ' + chapters.length + ' Kapitel');
            }
          } catch (err) {
            logDriveSync(logSheet, b.title, 'EPUB-Fehler (' + code + '): ' + err.message);
          }
        }

        if (entryChanged) {
          newLangs[code] = entry;
          changed = true;
          logDriveSync(logSheet, b.title, 'Sprachfassung aktualisiert (' + code + '): ' + (entry.wordCount || '?') + ' Wörter');
        }
      });
      if (completedCodes.length) b.langs = newLangs;

      const sourceLang = pickSyncSourceLanguage(langs);
      if (sourceLang && newLangs[sourceLang]) {
        const sourceEntry = newLangs[sourceLang];
        if (sourceEntry.wordCount && sourceEntry.wordCount !== b.wordCount) {
          b.wordCount = sourceEntry.wordCount;
          changed = true;
        }
        if (sourceEntry.hook && sourceEntry.hook !== (b.hook || '')) {
          b.hook = sourceEntry.hook;
          changed = true;
        }
        if (sourceEntry.epubUrl && sourceEntry.epubUrl !== (b.epubUrl || '')) {
          b.epubUrl = sourceEntry.epubUrl;
          changed = true;
        }
      }
    }

    if (coverFile) {
      try {
        const url = publicViewUrlFor(coverFile);
        if (url !== b.coverUrl) {
          b.coverUrl = url;
          changed = true;
          logDriveSync(logSheet, b.title, 'Cover übernommen: ' + coverFile.getName());
        }
      } catch (err) {
        logDriveSync(logSheet, b.title, 'Cover-Fehler: ' + err.message);
      }
    }

    // Alt-Cover-Ordner: b.altUrl (Ordner-Link) bleibt als Fallback bestehen,
    // zusaetzlich jetzt b.altCovers — Array einzelner Bild-URLs (gleiche
    // lh3.googleusercontent.com-CDN-Links wie beim normalen Cover), damit die
    // Website die Alt-Cover direkt inline zeigen kann statt zu Drive
    // weiterzuleiten.
    if (folders.altCoverFolder) {
      try {
        if (folderHasFiles_(folders.altCoverFolder)) {
          const altUrl = publicFolderUrlFor_(folders.altCoverFolder);
          if (altUrl !== b.altUrl) {
            b.altUrl = altUrl;
            changed = true;
            logDriveSync(logSheet, b.title, 'Alt-Cover-Ordner verlinkt.');
          }
          const altImageFiles = allImageFiles_(folders.altCoverFolder);
          const newAltCovers = altImageFiles.map(function(f) { return publicViewUrlFor(f); });
          const oldAltCovers = Array.isArray(b.altCovers) ? b.altCovers : [];
          if (newAltCovers.join('|') !== oldAltCovers.join('|')) {
            b.altCovers = newAltCovers;
            changed = true;
            logDriveSync(logSheet, b.title, 'Alt-Cover-Bilder aktualisiert: ' + newAltCovers.length + ' Bild(er).');
          }
        }
      } catch (err) {
        logDriveSync(logSheet, b.title, 'Alt-Cover-Fehler: ' + err.message);
      }
    }

    // "Extern"-Ordner (bisher nur Ablage ohne Website-Anbindung) verlinken,
    // sobald mindestens eine Datei drinliegt — wird zum "Background"-Button.
    if (folders.externFolder) {
      try {
        if (folderHasFiles_(folders.externFolder)) {
          const bgUrl = publicFolderUrlFor_(folders.externFolder);
          if (bgUrl !== b.bgUrl) {
            b.bgUrl = bgUrl;
            changed = true;
            logDriveSync(logSheet, b.title, 'Background-Link (Extern-Ordner) aktualisiert.');
          }
        }
      } catch (err) {
        logDriveSync(logSheet, b.title, 'Background-Fehler: ' + err.message);
      }
    }

    // Video-Ordner: erste Videodatei drin -> als "Video"-Button verlinken
    // (Drive-eigener Player, kein Download).
    if (folders.videoFolder) {
      try {
        const videoFile = firstVideoFile_(folders.videoFolder);
        if (videoFile) {
          const videoUrl = videoViewUrlFor_(videoFile);
          if (videoUrl !== b.videoUrl) {
            b.videoUrl = videoUrl;
            changed = true;
            logDriveSync(logSheet, b.title, 'Video übernommen: ' + videoFile.getName());
          }
        }
      } catch (err) {
        logDriveSync(logSheet, b.title, 'Video-Fehler: ' + err.message);
      }
    }

    // Genre: bevorzugt aus einer vollständigen "metadata.json" im
    // Buch-Wurzelordner (kanonische Quelle aus dem separaten Buch-
    // Vorbereitungs-Workflow — Query Letter/Synopsis/Klappentext etc.,
    // enthält genre.primary/secondary neben vielen weiteren Feldern).
    // Falls keine metadata.json vorliegt: Fallback auf eine einfache Datei
    // mit Präfix GENRE_, deren erste Zeile das Genre ist.
    try {
      const metaFile = findFileByPrefix(folders.bookFolder, 'metadata.json');
      let kind = null;
      if (metaFile) {
        const metaText = docTextById(metaFile.getId());
        if (metaText) {
          try {
            const meta = JSON.parse(metaText);
            if (meta.genre && meta.genre.primary) {
              const secondary = Array.isArray(meta.genre.secondary) ? meta.genre.secondary.slice(0, 2) : [];
              kind = meta.genre.primary + (secondary.length ? ' · ' + secondary.join(', ') : '');
            }
          } catch (parseErr) {
            logDriveSync(logSheet, b.title, 'metadata.json ungültig (kein gültiges JSON): ' + parseErr.message);
          }
        }
      } else {
        const genreFile = findFileByPrefix(folders.bookFolder, 'GENRE_');
        if (genreFile) {
          const genreText = docTextById(genreFile.getId());
          if (genreText && genreText.trim()) kind = genreText.trim().split('\n')[0].trim();
        }
      }
      if (kind && kind !== b.kind) {
        b.kind = kind;
        changed = true;
        logDriveSync(logSheet, b.title, 'Genre übernommen: ' + kind);
      }
    } catch (err) {
      logDriveSync(logSheet, b.title, 'Genre-Fehler: ' + err.message);
    }
  });

  if (changed) {
    setBooksArray(books);
  }
}

// Einmalig manuell im Apps-Script-Editor ausführen: Funktion oben im
// Dropdown auf "setupDriveSyncTrigger" stellen → ▷ Run. Legt den
// stündlichen Trigger an (räumt einen evtl. vorher bestehenden zuerst
// auf, damit er nicht doppelt läuft) und stößt sofort einen ersten
// Sync-Durchlauf an, damit man das Ergebnis gleich im DriveSyncLog-Tab
// sieht.
function setupDriveSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncDriveForAllBooks') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncDriveForAllBooks').timeBased().everyHours(1).create();
  syncDriveForAllBooks();
}

function handle(e) {
  // --- Stil-Revisions-Modul: NEU hinzugefügt, siehe RevisionModule.gs ---
  const revisionResponse = handleRevisionAction(e);
  if (revisionResponse) return revisionResponse;
  // --- Ende Stil-Revisions-Modul-Ergänzung ---

  // --- Lese-Bookmark-Sync: NEU hinzugefügt, siehe BookmarkSync.gs ---
  const bookmarkResponse = handleBookmarkAction(e);
  if (bookmarkResponse) return bookmarkResponse;
  // --- Ende Lese-Bookmark-Sync-Ergänzung ---

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Ratings') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Ratings');
  const action = (e.parameter.action || '').trim();

  if (action === 'submit') {
    sheet.appendRow([
      new Date(),
      e.parameter.person || '',
      e.parameter.itemType || '',
      e.parameter.itemId || '',
      e.parameter.stars || '',
      e.parameter.comment || ''
    ]);
    return jsonOut({ ok: true });
  }

  if (action === 'list') {
    const rows = sheet.getDataRange().getValues();
    const data = rows.map(r => ({
      time: r[0], person: r[1], itemType: r[2], itemId: r[3], stars: r[4], comment: r[5]
    }));
    return jsonOut({ ok: true, data });
  }

  if (action === 'saveBooks') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    let books;
    try {
      books = JSON.parse(e.parameter.books || '[]');
    } catch (err) {
      return jsonOut({ ok: false, error: 'Ungültiges Bücher-JSON: ' + err.message });
    }
    if (!Array.isArray(books)) return jsonOut({ ok: false, error: 'Bücher-Daten sind kein Array.' });
    setBooksArray(books);
    return jsonOut({ ok: true });
  }

  if (action === 'getBooks') {
    return jsonOut({ ok: true, books: JSON.stringify(getBooksArray()) });
  }

  if (action === 'savePoems') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    let poems;
    try {
      poems = JSON.parse(e.parameter.poems || '[]');
    } catch (err) {
      return jsonOut({ ok: false, error: 'Ungültiges Gedichte-JSON: ' + err.message });
    }
    if (!Array.isArray(poems)) return jsonOut({ ok: false, error: 'Gedichte-Daten sind kein Array.' });
    setPoemsArray(poems);
    return jsonOut({ ok: true });
  }

  if (action === 'getPoems') {
    return jsonOut({ ok: true, poems: JSON.stringify(getPoemsArray()) });
  }

  // Seiten-Einstellungen (aktuell: Part-Bilder für die Poems-Sektion),
  // gleiches Muster wie BooksData — einzelner JSON-Blob in Zelle A1 eines
  // eigenen Sheet-Tabs. Lesen ist bewusst ohne Admin-Token, damit auch
  // normale Besucher die aktuellen Bilder laden.
  if (action === 'saveSettings') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    const settingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SettingsData') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('SettingsData');
    settingsSheet.getRange('A1').setValue(e.parameter.settings || '{}');
    return jsonOut({ ok: true });
  }

  if (action === 'getSettings') {
    const settingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SettingsData');
    const json = settingsSheet ? settingsSheet.getRange('A1').getValue() : '{}';
    return jsonOut({ ok: true, settings: json || '{}' });
  }

  if (action === 'checkPassword') {
    const role = (e.parameter.role || '').trim();
    const props = PropertiesService.getScriptProperties();
    const expected = role === 'admin' ? props.getProperty('ADMIN_PASSWORD') : null;
    const ok = !!expected && e.parameter.password === expected;
    const result = { ok: ok };
    if (ok) {
      const token = Utilities.getUuid();
      props.setProperty('admintoken_' + token, String(Date.now()));
      result.adminToken = token;
    }
    return jsonOut(result);
  }

  if (action === 'checkAccess') {
    const code = (e.parameter.code || '').trim();
    const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
    if (!accessSheet || !code) return jsonOut({ ok: false });
    const rows = accessSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]).trim() === code) {
        return jsonOut({
          ok: true,
          name: rows[i][0],
          canDownload: rows[i][2] === true || String(rows[i][2]).toUpperCase() === 'TRUE',
          canCopy: rows[i][3] === true || String(rows[i][3]).toUpperCase() === 'TRUE',
          // Spalte 5 (VisibleBooks): leer/fehlt = alle Bücher sichtbar (Standard,
          // rückwärtskompatibel zu alten Zugängen ohne diese Spalte), sonst
          // JSON-Array erlaubter Buchtitel.
          visibleBooks: parseVisibleBooks_(rows[i][4]),
          // Spalte 6 (ShowPoems): leer/fehlt = Gedichte sichtbar (Standard,
          // rückwärtskompatibel), nur explizites FALSE blendet sie aus.
          showPoems: parseShowPoems_(rows[i][5]),
          // Spalte 7 (EpubAccess): pro Buch { read, download } — nur relevant,
          // wenn CanDownload=false ist.
          epubAccess: parseEpubAccess_(rows[i][6])
        });
      }
    }
    return jsonOut({ ok: false });
  }

  if (action === 'getAccessList') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
    if (!accessSheet || accessSheet.getLastRow() < 2) return jsonOut({ ok: true, people: [] });
    const rows = accessSheet.getDataRange().getValues();
    const people = rows.slice(1).filter(r => r[1]).map(r => ({
      name: r[0], code: r[1],
      canDownload: r[2] === true || String(r[2]).toUpperCase() === 'TRUE',
      canCopy: r[3] === true || String(r[3]).toUpperCase() === 'TRUE',
      visibleBooks: parseVisibleBooks_(r[4]),
      showPoems: parseShowPoems_(r[5]),
      epubAccess: parseEpubAccess_(r[6])
    }));
    return jsonOut({ ok: true, people: people });
  }

  if (action === 'addAccess') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Access');
    if (accessSheet.getLastRow() === 0) accessSheet.appendRow(['Name', 'Code', 'CanDownload', 'CanCopy', 'VisibleBooks', 'ShowPoems', 'EpubAccess']);
    const code = generateAccessCode();
    accessSheet.appendRow([
      e.parameter.name || 'Unbenannt',
      code,
      e.parameter.canDownload === 'true',
      e.parameter.canCopy === 'true',
      e.parameter.visibleBooks || '',
      e.parameter.showPoems === undefined ? true : e.parameter.showPoems === 'true',
      e.parameter.epubAccess || '{}'
    ]);
    return jsonOut({ ok: true, code: code });
  }

  // Ändert nachträglich Download/Kopieren-Rechte UND sichtbare Bücher eines
  // bestehenden Zugangscodes — ohne den Code selbst neu zu erzeugen (der ja
  // schon weitergegeben sein kann). Leerer String/leeres Array bei
  // visibleBooks = wieder alle Bücher sichtbar.
  if (action === 'updateAccess') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
    if (!accessSheet) return jsonOut({ ok: false, error: 'Kein Access-Sheet vorhanden.' });
    const data = accessSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === e.parameter.code) {
        accessSheet.getRange(i + 1, 3, 1, 5).setValues([[
          e.parameter.canDownload === 'true',
          e.parameter.canCopy === 'true',
          e.parameter.visibleBooks || '',
          e.parameter.showPoems === undefined ? true : e.parameter.showPoems === 'true',
          e.parameter.epubAccess || '{}'
        ]]);
        return jsonOut({ ok: true });
      }
    }
    return jsonOut({ ok: false, error: 'Zugangscode nicht gefunden.' });
  }

  if (action === 'removeAccess') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
    if (accessSheet) {
      const data = accessSheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][1]) === e.parameter.code) { accessSheet.deleteRow(i + 1); break; }
      }
    }
    return jsonOut({ ok: true });
  }

  // Liefert die Rohbytes einer EPUB-Datei Base64-codiert an den Browser —
  // noetig fuer den Inline-Reader (epub.js), weil ein direkter Cross-Origin-
  // fetch() auf den Drive-Download-Link an CORS scheitert; dieser Umweg
  // ueber denselben Apps-Script-Endpunkt, den die Seite ohnehin fuer alles
  // andere benutzt, funktioniert zuverlaessig. Kein Admin-Token noetig (das
  // ist ein oeffentlicher Lese-Endpunkt, genau wie getBooks), aber zur
  // Sicherheit wird die angefragte Datei-ID gegen die tatsaechlich in den
  // Buchdaten hinterlegten EPUB-URLs geprueft — sonst liesse sich darueber
  // im Prinzip jede beliebige, dem Angreifer bekannte Drive-Datei-ID
  // abrufen, nicht nur EPUBs.
  if (action === 'getEpubData') {
    const epubUrl = e.parameter.epubUrl || '';
    const idMatch = epubUrl.match(/[-\w]{25,}/);
    if (!idMatch) return jsonOut({ ok: false, error: 'Keine gültige EPUB-URL.' });
    const requestedId = idMatch[0];
    const bookTitle = e.parameter.bookTitle || '';
    const intent = e.parameter.intent === 'download' ? 'download' : 'read';
    const requestCode = (e.parameter.code || '').trim();

    // Zugriffspruefung: voller Lesezugriff (CanDownload) darf immer alles —
    // unabhaengig vom Buchstatus. Alle anderen brauchen fuer GENAU dieses
    // Buch und GENAU diese Aktion (lesen/downloaden) eine explizite
    // Freigabe in EpubAccess; ohne gueltigen Code oder ohne Freigabe: kein
    // Zugriff. Gleiche Access-Sheet-Logik wie bei 'checkAccess'.
    // Admin-Login (adminToken) zaehlt ebenfalls als voller Zugriff — analog
    // zu "Admin sieht immer alle Buecher" bei der Sichtbarkeit, sonst
    // braeuchte der Autor zusaetzlich zum Admin-Login noch einen separaten
    // Gast-Zugangscode nur zum Lesen im Inline-Reader.
    const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
    let hasFullAccess = checkAdmin(e).ok;
    let epubAccess = {};
    if (!hasFullAccess && accessSheet && requestCode) {
      const accessRows = accessSheet.getDataRange().getValues();
      for (let i = 1; i < accessRows.length; i++) {
        if (String(accessRows[i][1]).trim() === requestCode) {
          hasFullAccess = accessRows[i][2] === true || String(accessRows[i][2]).toUpperCase() === 'TRUE';
          epubAccess = parseEpubAccess_(accessRows[i][6]);
          break;
        }
      }
    }
    if (!hasFullAccess) {
      const perm = epubAccess[bookTitle] || {};
      const allowed = intent === 'download' ? !!perm.download : !!perm.read;
      if (!allowed) return jsonOut({ ok: false, error: 'Kein Zugriff auf dieses Buch.' });
    }

    // Sicherheits-Check wie bisher: die angefragte Datei-ID muss tatsaechlich
    // zu einem hinterlegten EPUB gehoeren, sonst waere dieser Endpunkt ein
    // Oracle fuer beliebige Drive-Datei-IDs.
    const books = getBooksArray();
    let known = false;
    books.forEach(function(b) {
      if (b.epubUrl && b.epubUrl.indexOf(requestedId) >= 0) known = true;
      if (b.langs) {
        Object.keys(b.langs).forEach(function(code) {
          const entry = b.langs[code];
          if (entry && entry.epubUrl && entry.epubUrl.indexOf(requestedId) >= 0) known = true;
        });
      }
    });
    if (!known) return jsonOut({ ok: false, error: 'Unbekannte EPUB-Datei.' });
    try {
      const file = DriveApp.getFileById(requestedId);
      const bytes = file.getBlob().getBytes();
      return jsonOut({ ok: true, dataBase64: Utilities.base64Encode(bytes) });
    } catch (err) {
      return jsonOut({ ok: false, error: err.message });
    }
  }

  if (action === 'syncWordCount') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    const docUrl = e.parameter.docUrl || '';
    const idMatch = docUrl.match(/[-\w]{25,}/);
    if (!idMatch) return jsonOut({ ok: false, error: 'Keine gültige Google-Drive-URL erkannt.' });
    try {
      const words = countWordsInDriveFile(idMatch[0]);
      return jsonOut({ ok: true, wordCount: words });
    } catch (err) {
      return jsonOut({ ok: false, error: err.message });
    }
  }

  if (action === 'syncDriveNow') {
    // Manuelles Sofort-Auslösen des Drive-Scans über die Web-App (z.B.
    // zum Testen), zusätzlich zum stündlichen Zeit-Trigger. Aktuell noch
    // nicht an ein Admin-Panel-Icon angebunden — bei Bedarf einfach
    // ergänzen.
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized', debugTokenReceived: admin.token, debugCacheValue: admin.cached });
    try {
      syncDriveForAllBooks();
      return jsonOut({ ok: true });
    } catch (err) {
      return jsonOut({ ok: false, error: err.message });
    }
  }

  return jsonOut({ ok: false, error: 'unknown action' });
}
