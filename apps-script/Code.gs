/**
 * CANONICAL BACKEND SOURCE — A. J. Khan author site.
 *
 * Seit 21.09.2026 ist die versionierte Datei apps-script/Code.gs im
 * GitHub-Repository die Source of Truth für das Backend. Änderungen werden
 * zuerst dort vorgenommen und geprüft; der Google-Apps-Script-Editor ist das
 * Deployment-Ziel und kann bis zum manuellen „New version“-Deploy hinter dem
 * Repo-Stand zurückliegen. Siehe apps-script/README.md.
 *
 * Basis dieses Stands ist die vom Autor am 21.09.2026 als aktuell bestätigte
 * Live-Datei. Hardening 2026-09-21.1: serverseitige Link-Filterung, private
 * EPUB-Referenzen, LockService gegen Write-Races, Token-Logout und
 * abgesicherte Ratings.
 */

const BACKEND_SOURCE_VERSION = '2026-09-21.1';

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
// Eigene Ablauflogik statt der eingebauten Cache-Ablaufzeit.
// Auf 7 Tage verlängert (14.09.2026) — die alten 24h führten laufend zu
// überraschenden "unauthorized"-Fehlern beim Speichern im Admin-Panel.
const ADMIN_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
function checkAdmin(e) {
  const token = (e && e.parameter && e.parameter.adminToken) || '';
  if (!token) return { ok: false };
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('admintoken_' + token);
  if (!stored) return { ok: false };
  const issuedAt = Number(stored);
  const valid = !!issuedAt && (Date.now() - issuedAt) < ADMIN_TOKEN_LIFETIME_MS;
  return { ok: valid };
}

// Raeumt abgelaufene admintoken_-Eintraege auf. Ohne das sammelt sich pro
// Admin-Login ein neuer Eintrag an, der nie geloescht wird -- am
// 19.09.2026 live aufgefallen: ab 50 Script Properties zeigt die
// Apps-Script-Oberflaeche unter Projekteinstellungen nur noch die ersten
// 50 an und schaltet komplett auf Lesemodus (neue Properties lassen sich
// dann nur noch per Code setzen, nicht mehr ueber die UI). Wird bei jedem
// erfolgreichen Admin-Login mit aufgerufen (siehe action==='checkPassword'
// unten), damit die Liste sich von selbst kurz haelt, statt unbegrenzt zu
// wachsen.
function cleanupExpiredAdminTokens_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('admintoken_') !== 0) return;
    const issuedAt = Number(all[key]);
    if (!issuedAt || (Date.now() - issuedAt) >= ADMIN_TOKEN_LIFETIME_MS) {
      props.deleteProperty(key);
    }
  });
}

// E-Mail-Benachrichtigung an den Autor beim ERSTEN Login eines Zugangscodes
// (Wiedererkennung via PropertiesService, damit es nicht bei jedem erneuten
// Besuch spammt). Empfänger ist automatisch das eigene Google-Konto, in dem
// dieses Skript läuft — keine zusätzliche Konfiguration nötig. Ein Fehler
// beim Mailversand darf den eigentlichen Login-Check niemals blockieren,
// daher komplett in try/catch gekapselt.
function notifyFirstLogin_(code, name) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'firstlogin_' + code;
    if (props.getProperty(key)) return; // schon mal begrüßt
    props.setProperty(key, String(Date.now()));
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: 'Autorenseite: ' + (name || code) + ' hat sich zum ersten Mal eingeloggt',
      body: (name || '(ohne Namen)') + ' (Code: ' + code + ') hat sich soeben zum ersten Mal auf der Autorenseite eingeloggt.'
    });
  } catch (err) {
    // still — nichts weiter zu tun, Login funktioniert trotzdem normal.
  }
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

// Serialisiert kritische Schreibpfade. Ohne ScriptLock konnten ein manueller
// saveBooks-Aufruf und der stündliche Drive-Sync denselben BooksData-Stand
// parallel lesen und anschließend nach dem Prinzip „last write wins“ eine
// neuere Änderung wieder überschreiben.
function withScriptLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(timeoutMs || 15000);
  if (!acquired) throw new Error('Server ist gerade beschäftigt — bitte in wenigen Sekunden erneut versuchen.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function unauthorizedJson_() {
  return jsonOut({ ok: false, error: 'unauthorized' });
}

// Zentrale serverseitige Auswertung eines Besucher-/Admin-Zugangs. Das
// Frontend darf Rechte weiterhin für die Darstellung verwenden, ist aber
// nicht mehr die Sicherheitsgrenze.
function resolveAccessContext_(e) {
  if (checkAdmin(e).ok) {
    return {
      ok: true, isAdmin: true, name: 'Admin', canDownload: true, canCopy: true,
      visibleBooks: null, showPoems: true, epubAccess: {}
    };
  }

  const code = (e && e.parameter && e.parameter.code || '').trim();
  if (!code) {
    return { ok: false, isAdmin: false, name: '', canDownload: false, canCopy: false, visibleBooks: null, showPoems: false, epubAccess: {} };
  }
  const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
  if (!accessSheet || accessSheet.getLastRow() < 2) {
    return { ok: false, isAdmin: false, name: '', canDownload: false, canCopy: false, visibleBooks: null, showPoems: false, epubAccess: {} };
  }
  const rows = accessSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === code) {
      return {
        ok: true, isAdmin: false, name: rows[i][0] || '',
        canDownload: rows[i][2] === true || String(rows[i][2]).toUpperCase() === 'TRUE',
        canCopy: rows[i][3] === true || String(rows[i][3]).toUpperCase() === 'TRUE',
        visibleBooks: parseVisibleBooks_(rows[i][4]),
        showPoems: parseShowPoems_(rows[i][5]),
        epubAccess: parseEpubAccess_(rows[i][6])
      };
    }
  }
  return { ok: false, isAdmin: false, name: '', canDownload: false, canCopy: false, visibleBooks: null, showPoems: false, epubAccess: {} };
}

function bookVisibleForAccess_(book, access) {
  if (!access || !access.ok || access.isAdmin || !Array.isArray(access.visibleBooks)) return true;
  return access.visibleBooks.indexOf(book.title) >= 0;
}

// Entfernt direkte Drive-/Download-Links aus getBooks, wenn der Request
// nicht den dafür nötigen Zugang besitzt. Damit ist „Button verstecken“ im
// Browser nicht mehr die einzige Schutzschicht. Metadaten (Titel, Cover,
// Hook, Wortzahl usw.) bleiben für die bestehende statische Seite lesbar.
function sanitizeBookForAccess_(book, access) {
  const copy = JSON.parse(JSON.stringify(book || {}));
  if (access && access.ok && access.canDownload) return copy;

  delete copy.pdfUrl;
  delete copy.manuscriptDocUrl;
  delete copy.bgUrl;
  delete copy.videoUrl;
  delete copy.altUrl;

  const perm = (access && access.ok && access.epubAccess && access.epubAccess[copy.title]) || {};
  if (!(perm.read || perm.download)) delete copy.epubUrl;

  if (copy.langs && typeof copy.langs === 'object') {
    Object.keys(copy.langs).forEach(function(code) {
      const entry = copy.langs[code];
      if (!entry || typeof entry !== 'object') return;
      delete entry.pdfUrl;
      delete entry.manuscriptDocUrl;
      if (!(perm.read || perm.download)) delete entry.epubUrl;
    });
  }
  return copy;
}

function booksForRequest_(e) {
  const access = resolveAccessContext_(e);
  return getBooksArray()
    .filter(function(book) { return bookVisibleForAccess_(book, access); })
    .map(function(book) { return sanitizeBookForAccess_(book, access); });
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

// Grobe Text-Extraktion aus einer bereits fertigen, direkt hochgeladenen
// EPUB-Datei (nur fuer die Wortzahl-Anzeige gedacht, nicht fuer die
// eigentliche EPUB-Erstellung -- die entfaellt hier ja gerade, siehe
// ARCHITECTURE.md "EPUB anstelle eines Manuskript-Dokuments"). Eine EPUB
// ist einfach ein ZIP, Utilities.unzip() entpackt sie direkt ohne externe
// Bibliothek; aus jeder XHTML/HTML-Datei darin werden die Tags entfernt.
// Reihenfolge/Vollstaendigkeit ist hier nicht kritisch, es geht nur um
// eine ungefaehre Wortzahl fuer die Buchkarte, nicht um exakten Lesetext.
function epubTextExtract_(fileId) {
  const file = DriveApp.getFileById(fileId);
  let entries;
  try {
    entries = Utilities.unzip(file.getBlob());
  } catch (err) {
    return null;
  }
  const parts = [];
  entries.forEach(function(entry) {
    const name = entry.getName().toLowerCase();
    if (name.endsWith('.xhtml') || name.endsWith('.html') || name.endsWith('.htm')) {
      const raw = entry.getDataAsString('UTF-8');
      parts.push(raw.replace(/<[^>]*>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' '));
    }
  });
  return parts.length ? parts.join('\n\n') : null;
}

// Wandelt die paar in EPUB-Metadaten ueblichen XML-Entities zurueck in
// normalen Text (z.B. "&amp;" -> "&") -- absichtlich keine vollstaendige
// XML-Entity-Tabelle, nur die Handvoll, die in Buchtiteln realistisch
// vorkommt.
function decodeXmlEntities_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(Number(code)); });
}

// Liest den Buchtitel (dc:title) direkt aus den EPUB-eigenen Metadaten
// (der .opf-Datei, z.B. "content.opf" oder "package.opf" -- Name variiert
// je nach Erzeuger-Tool, daher per Endung statt festem Namen gesucht,
// gleiches Prinzip wie findMetadataJsonFile_). Arbeitet direkt auf den
// rohen Datei-Bytes, OHNE dass die Datei vorher in Drive gespeichert sein
// muss -- Utilities.unzip() akzeptiert jeden Blob. Wird von der neuen
// Aktion 'detectEpubTitle' genutzt (§52, siehe ARCHITECTURE.md): bevor
// eine EPUB ohne bereits eingetragenen Buchtitel endgueltig hochgeladen
// wird, ermittelt der Client so den Titel direkt aus der Datei, statt ihn
// von Hand eintippen zu muessen.
function epubTitleFromBytes_(bytes) {
  const blob = Utilities.newBlob(bytes, 'application/epub+zip', 'temp.epub');
  let entries;
  try {
    entries = Utilities.unzip(blob);
  } catch (err) {
    return null;
  }
  const opfEntry = entries.filter(function(e) { return e.getName().toLowerCase().endsWith('.opf'); })[0];
  if (!opfEntry) return null;
  const xml = opfEntry.getDataAsString('UTF-8');
  const m = xml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  if (!m) return null;
  const title = decodeXmlEntities_(m[1]).trim();
  return title || null;
}

// Extrahiert das im EPUB eingebettete Cover-Bild direkt aus einer bereits
// als Drive-Datei vorliegenden EPUB (§53) -- ueber das im Manifest als
// properties="cover-image" markierte Item (EPUB3) bzw. als Fallback das
// aeltere <meta name="cover" content="ID"/>-Muster (EPUB2). Attribute
// einzeln per kleiner Regex statt eines grossen kombinierten Musters
// ausgelesen, weil die Reihenfolge von id/href/properties in <item .../>
// zwischen Erzeuger-Tools (Calibre, Pandoc, Vellum, Word-Export ...)
// variiert. Gibt null zurueck, wenn kein Cover gefunden wird -- der
// Aufrufer in syncDriveForAllBooks behandelt das als "kein Cover
// verfuegbar", genau wie bisher ohne EPUB-Cover-Extraktion.
function epubCoverBlobFromFile_(file) {
  let entries;
  try {
    entries = Utilities.unzip(file.getBlob());
  } catch (err) {
    return null;
  }
  const opfEntry = entries.filter(function(e) { return e.getName().toLowerCase().endsWith('.opf'); })[0];
  if (!opfEntry) return null;
  const opfPath = opfEntry.getName();
  const opfDir = opfPath.indexOf('/') >= 0 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const xml = opfEntry.getDataAsString('UTF-8');

  const items = [];
  const itemRe = /<item\b([^>]*)\/?>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const attrs = m[1];
    const id = (attrs.match(/\bid="([^"]*)"/i) || [])[1] || '';
    const href = (attrs.match(/\bhref="([^"]*)"/i) || [])[1] || '';
    const properties = (attrs.match(/\bproperties="([^"]*)"/i) || [])[1] || '';
    if (id || href) items.push({ id: id, href: href, properties: properties });
  }

  let coverHref = null;
  const byProperties = items.filter(function(it) { return /\bcover-image\b/i.test(it.properties); })[0];
  if (byProperties) {
    coverHref = byProperties.href;
  } else {
    const metaMatch = xml.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
    if (metaMatch) {
      const byId = items.filter(function(it) { return it.id === metaMatch[1]; })[0];
      if (byId) coverHref = byId.href;
    }
  }
  if (!coverHref) return null;

  const targetPath = (opfDir + coverHref).replace(/^\.\//, '');
  const targetEntry = entries.filter(function(e) {
    return e.getName() === targetPath || e.getName() === decodeURIComponent(targetPath);
  })[0];
  return targetEntry ? targetEntry.getBlob() : null;
}

// ───────────────────────── KI-Klappentext (optional, §50) ─────────────────
//
// Erzeugt automatisch einen Klappentext-Vorschlag aus dem Manuskript-
// bzw. EPUB-Text, wenn (a) noch kein manueller Klappentext (KLAPPENTEXT_-
// Datei) fuer diese Sprache hinterlegt ist und (b) ein Gemini-API-Key als
// Script Property gesetzt ist ("GEMINI_API_KEY" ueber Apps-Script-
// Projekteinstellungen -> Script Properties, NIE im Code selbst). Google
// Gemini statt Anthropic gewaehlt, weil es einen echten Gratis-Tarif ohne
// Kreditkarte gibt (aistudio.google.com/apikey) -- passt ausserdem zur
// ohnehin komplett auf Google-Infrastruktur laufenden Automatisierung
// hier (Drive/Sheets/Apps Script). Ohne Key bleibt dieser Codepfad
// bewusst inaktiv (kein Fehler, siehe syncDriveForAllBooks-Aufrufer).
// Sobald irgendwann eine echte KLAPPENTEXT_-Datei hochgeladen wird, hat
// die dauerhaft Vorrang (siehe hookSource-Feld im Aufrufer) -- der
// KI-Text ist ein Entwurf, kein endgueltiger Ersatz fuer die eigene
// Stimme des Autors.
//
// Stilvorgaben, destilliert aus zwei Quellen:
// 1) A. J. Khans "Novel Master Standard v5.0": "Propulsion ohne
//    Thrillerisierung" (nicht jedes Buch braucht Countdown/Leiche/Chase --
//    Neugier, Intimitaet, Scham, Pflicht, Beziehung, Entdeckung oder
//    Konsequenz ziehen genauso stark wie Gefahr, WENN es zum Genre passt)
//    und die Forderung, dass Titel/Opening/Cover/Blurb/Comp-Titel
//    demselben Leser dasselbe Erlebnis versprechen muessen (kein falsches
//    Genre-Signal).
// 2) Branchenuebliche Backcover-/Query-Letter-Konventionen kommerzieller
//    Bestseller (Haken-Satz, Hauptfigur + ausloesendes Ereignis,
//    eskalierender Konflikt/Einsatz, offenes Ende ohne Twist-Verrat,
//    aktive statt zusammenfassende Sprache, keine Klischees).
function generateBlurbWithAI_(manuscriptText, bookTitle, genre, langCode) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey || !manuscriptText || !manuscriptText.trim()) return null;

  const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  // Gemini 2.5 Flash traegt ganze Romane im Kontextfenster -- der Deckel
  // schuetzt nur vor Ausreissern (z.B. versehentlich mehrfach
  // verkettetem Text), ist keine bewusste Kuerzung auf "nur den Anfang".
  const MAX_CHARS = 400000;
  const text = manuscriptText.length > MAX_CHARS ? manuscriptText.slice(0, MAX_CHARS) : manuscriptText;

  const langNames = { DE: 'Deutsch', EN: 'English', BS: 'bosanski/hrvatski/srpski' };
  const langName = langNames[(langCode || '').toUpperCase()] || langCode || 'Deutsch';

  const systemPrompt = [
    'Du schreibst professionelle Backcover-Klappentexte fuer Romane, auf dem Niveau internationaler Bestseller-Verlage.',
    '',
    'Stilvorgabe (A. J. Khan Novel Master Standard v5.0):',
    '- "Propulsion ohne Thrillerisierung": nicht jedes Buch braucht Countdown, Leiche, Verfolgungsjagd oder Cliffhanger -- Neugier, Intimitaet, Scham, Pflicht, Beziehung, Entdeckung oder Konsequenz koennen genauso stark ziehen wie Gefahr. Der Ton muss zum tatsaechlichen Genre des Manuskripts passen, niemals generisch "thrillerisiert" wirken, wenn das Buch das nicht ist.',
    '- Titel, Opening, Cover, Klappentext und Comp-Titel muessen demselben Leser dasselbe Leseerlebnis versprechen -- kein falsches Genre-Signal, keine Ueberhoehung.',
    '',
    'Handwerkliche Pflicht-Elemente eines Weltklasse-Klappentexts (Bestseller-Praxis):',
    '1. Ein starker Einstiegssatz/Haken, der sofort eine Frage oder Spannung im Kopf des Lesers erzeugt.',
    '2. Hauptfigur klar benennen, plus das ausloesende Ereignis, das ihr Leben aus der Balance bringt.',
    '3. Den zentralen Konflikt und was auf dem Spiel steht -- eskalierend erzaehlt, nicht als Aufzaehlung.',
    '4. Endet auf einer offenen, ungeloesten Frage oder einem Moment maximaler Spannung -- verraet NIEMALS das Ende, die Aufloesung oder die grosse Wendung des Romans.',
    '5. Aktive, praesente Sprache -- kein "In diesem Roman geht es um...", keine Inhaltsangabe im Schulaufsatz-Stil.',
    '6. Keine abgenutzten Klischees ("In einer Welt, in der...", "Was sie nicht ahnte...", "Nichts ist mehr wie es scheint").',
    '7. Laenge: ca. 120-180 Woerter in 3-5 kurzen Absaetzen, kein Bulletpoint-Format, kein Fettdruck/Markdown.',
    '',
    'Sprache des fertigen Textes: ' + langName + '.',
    '',
    'Gib AUSSCHLIESSLICH den fertigen Klappentext zurueck -- keine Ueberschrift, keine Anfuehrungszeichen drumherum, keine Erklaerung, kein Markdown, keine Meta-Kommentare davor oder danach.'
  ].join('\n');

  const userPrompt = 'Buchtitel: ' + bookTitle + (genre ? ('\nGenre: ' + genre) : '') +
    '\n\nManuskripttext (vollstaendig oder grosser Auszug):\n\n' + text;

  // Gemini kennt keine eigene "system"-Rolle im Message-Array wie
  // Anthropic -- stattdessen der separate Top-Level-Block
  // "systemInstruction", inhaltlich aequivalent.
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { maxOutputTokens: 700 }
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) +
    ':generateContent?key=' + encodeURIComponent(apiKey);
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Gemini-API-Fehler ' + status + ': ' + response.getContentText().slice(0, 300));
  }
  const data = JSON.parse(response.getContentText());
  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  const blurb = (parts && parts.length ? parts.map(function(p) { return p.text || ''; }).join('') : '').trim();
  if (!blurb) return null;
  // Falls das Modell trotz Anweisung Anfuehrungszeichen drumherum setzt.
  return blurb.replace(/^["“„]+|["“”]+$/g, '').trim();
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

// Groß-/Kleinschreibungsunabhaengig (case-insensitive), damit z.B.
// "klappentext_Roman" oder "Final_Roman" genauso erkannt werden wie
// "KLAPPENTEXT_Roman"/"FINAL_Roman" — betrifft alle Aufrufer (FINAL_,
// ENTWURF_, KLAPPENTEXT_, GENRE_). Die metadata.json-Genre-Datei nutzt
// NICHT diese Funktion, sondern findMetadataJsonFile_ (jede .json-Datei
// im Buchordner zaehlt, unabhaengig vom genauen Dateinamen).
function findFileByPrefix(folder, prefix) {
  const it = folder.getFiles();
  let best = null;
  const prefixLower = prefix.toLowerCase();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().toLowerCase().indexOf(prefixLower) === 0) {
      if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
    }
  }
  return best;
}

// Findet die Genre-metadata.json im Buch-Wurzelordner -- bewusst NICHT per
// exaktem Dateinamen-Praefix (wie findFileByPrefix), sondern per Endung:
// jede .json-Datei dort zaehlt, unabhaengig davon, wie sie genau heisst
// (z.B. "metadata.json", aber auch "Der Titel des Romans.json" oder
// "metadata_Der Titel des Romans.json" aus dem separaten Buch-
// Vorbereitungs-Workflow). Der Ordner ist ohnehin schon pro Buch getrennt,
// eine feste Namenskonvention bringt hier also keinen echten Vorteil, nur
// unnoetige Fehlerquellen beim manuellen Ablegen. Bei mehreren .json-
// Dateien wird die zuletzt geaenderte genommen.
function findMetadataJsonFile_(folder) {
  const it = folder.getFiles();
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().toLowerCase().endsWith('.json')) {
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
    // EPUB_-Datei: eine bereits fertige, direkt hochgeladene EPUB anstelle
    // eines Manuskript-Dokuments (siehe ARCHITECTURE.md) -- macht die
    // Sprache ebenfalls "fertig", auch ohne FINAL_-Datei.
    const epubReadyFile = findFileByPrefix(langFolder, 'EPUB_');
    langs[code] = {
      status: (finalFile || epubReadyFile) ? 'fertig' : (entwurfFile ? 'in-arbeit' : 'offen'),
      finalFile: finalFile,
      epubReadyFile: epubReadyFile,
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

function getOrCreateSyncLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('DriveSyncLog') || ss.insertSheet('DriveSyncLog');
  if (sheet.getLastRow() === 0) sheet.appendRow(['Zeit', 'Buch', 'Ereignis']);
  return sheet;
}

// Findet den Drive-Ordner eines Buchs exakt anhand seines Titels (so wird
// er von ensureBookFolders() auch angelegt) -- null, falls (noch) keiner
// existiert, z.B. weil fuer dieses Buch nie etwas hochgeladen wurde.
function findBookFolderByTitle_(rootFolder, title) {
  if (!title) return null;
  const it = rootFolder.getFoldersByName(title);
  return it.hasNext() ? it.next() : null;
}

// Wird beim Loeschen eines Buchs im Admin-Panel aufgerufen (siehe
// action==='saveBooks'): verschiebt den zugehoerigen Drive-Ordner in den
// Papierkorb, statt ihn fuer immer als Karteileiche liegen zu lassen (und
// damit auch als Risiko, dass ein spaeter neu angelegtes Buch mit
// zufaellig demselben Titel automatisch die alten Dateien "erbt", siehe
// ARCHITECTURE.md). setTrashed statt endgueltigem Loeschen, damit ein
// versehentliches Buch-Loeschen im Admin-Panel ueber den normalen
// Drive-Papierkorb rueckgaengig gemacht werden kann.
function trashBookFolderByTitle_(rootFolder, logSheet, title) {
  const folder = findBookFolderByTitle_(rootFolder, title);
  if (folder) {
    folder.setTrashed(true);
    logDriveSync(logSheet, title, 'Buch im Admin-Panel geloescht: zugehoeriger Drive-Ordner in den Papierkorb verschoben.');
  }
}

// Wird beim Umbenennen eines Buchtitels im Admin-Panel aufgerufen: benennt
// den bestehenden Drive-Ordner mit um, statt ihn als Karteileiche unter dem
// alten Titel liegen zu lassen (das war die eigentliche Ursache fuer den
// "New Book"-Karteileichen-Ordner, der zum Bug in ARCHITECTURE.md §44
// gefuehrt hat). Bei einer Titel-Kollision (es existiert bereits ein
// Ordner mit dem neuen Titel) wird bewusst NICHT automatisch umbenannt/
// zusammengefuehrt, sondern nur geloggt -- ein automatisches Zusammenfuehren
// zweier Ordner koennte sonst Dateien ueberschreiben.
function renameBookFolderIfExists_(rootFolder, logSheet, oldTitle, newTitle) {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return;
  const oldFolder = findBookFolderByTitle_(rootFolder, oldTitle);
  if (!oldFolder) return;
  const collision = findBookFolderByTitle_(rootFolder, newTitle);
  if (collision) {
    logDriveSync(logSheet, newTitle, 'Achtung: Buch wurde von "' + oldTitle + '" zu "' + newTitle + '" umbenannt, aber es existiert bereits ein gleichnamiger Drive-Ordner "' + newTitle + '" -- alter Ordner "' + oldTitle + '" wurde NICHT automatisch umbenannt/zusammengefuehrt, bitte manuell pruefen.');
    return;
  }
  oldFolder.setName(newTitle);
  logDriveSync(logSheet, newTitle, 'Drive-Ordner von "' + oldTitle + '" zu "' + newTitle + '" umbenannt (Buchtitel im Admin-Panel geaendert).');
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
  // EPUBs werden ausschließlich über getEpubData ausgeliefert, wo die
  // Access-/Admin-Rechte serverseitig geprüft werden. Ein öffentlicher
  // ANYONE_WITH_LINK-Drive-Link würde diese Prüfung sonst umgehen.
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (err) {
    // In Shared Drives oder bei geerbten Berechtigungen kann die Freigabe
    // nicht immer am Kindobjekt reduziert werden. Der interne Ref wird
    // trotzdem verwendet; in diesem Fall die Eltern-Freigabe in Drive prüfen.
  }
  return 'epub-ref:' + file.getId();
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
  return withScriptLock_(function() {
    return syncDriveForAllBooksUnlocked_();
  }, 25000);
}

function syncDriveForAllBooksUnlocked_() {
  const logSheet = getOrCreateSyncLogSheet_();

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
        // Separat von manuscriptText: nur fuer den KI-Klappentext gedacht.
        // manuscriptText steuert weiter unten den EPUB-Eigenbau
        // (buildEpub_) und darf im epubReadyFile-Fall NICHT gesetzt werden
        // (sonst wuerde eine bereits fertige, hochgeladene EPUB durch eine
        // selbstgebaute aus dem grob tag-gestripten Extraktionstext
        // ueberschrieben). blurbSourceText traegt in beiden Faellen den
        // bestmoeglichen Volltext fuer generateBlurbWithAI_.
        let blurbSourceText = '';
        if (info.finalFile) {
          try {
            const text = docTextById(info.finalFile.getId());
            if (text) {
              manuscriptText = text;
              blurbSourceText = text;
              const words = text.trim().split(/\s+/).filter(Boolean).length;
              if (words && words !== entry.wordCount) { entry.wordCount = words; entryChanged = true; }
            }
          } catch (err) {
            logDriveSync(logSheet, b.title, 'Wortzahl-Fehler (' + code + '): ' + err.message);
          }
        } else if (info.epubReadyFile) {
          // Kein Manuskript-Dokument vorhanden, aber eine fertige,
          // direkt hochgeladene EPUB -- Wortzahl grob aus deren
          // Textinhalt schaetzen, statt komplett leer zu bleiben.
          try {
            const text = epubTextExtract_(info.epubReadyFile.getId());
            if (text) {
              blurbSourceText = text;
              const words = text.trim().split(/\s+/).filter(Boolean).length;
              if (words && words !== entry.wordCount) { entry.wordCount = words; entryChanged = true; }
            }
          } catch (err) {
            logDriveSync(logSheet, b.title, 'Wortzahl-Fehler aus EPUB (' + code + '): ' + err.message);
          }
          // Cover aus der EPUB uebernehmen (§53), aber NUR wenn noch kein
          // eigenes Cover im Bilder/Cover-Ordner liegt -- ein dort manuell
          // abgelegtes Bild hat immer Vorrang und wird nie ersetzt. coverFile
          // ist eine Variable aus dem umgebenden Scope (oben im forEach ueber
          // alle Buecher deklariert) -- wird sie hier gesetzt, greift der
          // bestehende Cover-URL-Block weiter unten im selben Buchdurchlauf
          // automatisch mit, ohne eigenen Code dafuer.
          if (!coverFile) {
            try {
              const coverBlob = epubCoverBlobFromFile_(info.epubReadyFile);
              if (coverBlob) {
                const ct = coverBlob.getContentType() || 'image/jpeg';
                const ext = ct.indexOf('png') >= 0 ? 'png' : (ct.indexOf('webp') >= 0 ? 'webp' : (ct.indexOf('gif') >= 0 ? 'gif' : 'jpg'));
                coverFile = folders.coverFolder.createFile(coverBlob.copyBlob().setName('cover_from_epub.' + ext));
                logDriveSync(logSheet, b.title, 'Cover aus EPUB uebernommen (' + code + ').');
              }
            } catch (err) {
              logDriveSync(logSheet, b.title, 'Cover-aus-EPUB-Fehler (' + code + '): ' + err.message);
            }
          }
        }
        if (info.klappentextFile) {
          try {
            const blurb = docTextById(info.klappentextFile.getId());
            // Diagnose-Log: laeuft IMMER, nicht nur bei Fehlern/Kuerzung --
            // ohne das war bisher unsichtbar, ob z.B. eine leere/kaputte
            // Klappentext-Datei ueberhaupt erkannt wurde (Ursachenfindung
            // fuer den Fehlerbericht vom 17.09.2026, siehe ARCHITECTURE.md).
            logDriveSync(logSheet, b.title, 'Klappentext-Datei (' + code + ') gelesen: "' + info.klappentextFile.getName() + '", ' + (blurb ? blurb.length : 0) + ' Zeichen, bisheriger entry.hook-Anfang: "' + (entry.hook || '').slice(0, 40) + '"');
            if (blurb && blurb.trim()) {
              let text = blurb.trim();
              const MAX_HOOK_LENGTH = 4000;
              let note = '';
              if (text.length > MAX_HOOK_LENGTH) {
                text = text.slice(0, MAX_HOOK_LENGTH) + '…';
                note = ' — ACHTUNG: gekürzt, vermutlich kein echter Klappentext, bitte Datei prüfen.';
              }
              // hookSource='file' markiert: ein manueller Klappentext hat
              // Vorrang und darf vom KI-Vorschlag unten nie mehr
              // ueberschrieben werden. Auch bei unveraendertem Text
              // gesetzt, damit sich alte Eintraege ohne dieses Feld
              // (vor §50) beim naechsten Sync selbst heilen.
              if (entry.hookSource !== 'file') { entry.hookSource = 'file'; entryChanged = true; }
              if (text !== entry.hook) {
                entry.hook = text;
                entryChanged = true;
                logDriveSync(logSheet, b.title, 'Klappentext (' + code + ') übernommen, neuer Anfang: "' + text.slice(0, 60) + '"' + note);
              } else if (note) {
                logDriveSync(logSheet, b.title, 'Klappentext (' + code + ')' + note);
              }
            } else {
              logDriveSync(logSheet, b.title, 'Klappentext-Datei (' + code + ') liefert leeren Text (blurb leer oder nur Leerzeichen) — entry.hook bleibt unveraendert.');
            }
          } catch (err) {
            logDriveSync(logSheet, b.title, 'Klappentext-Fehler (' + code + '): ' + err.message);
          }
        } else {
          logDriveSync(logSheet, b.title, 'Kein Klappentext-Datei-Objekt (' + code + ') gefunden (info.klappentextFile ist leer) — entry.hook bleibt unveraendert.');
          // Kein manueller Klappentext hinterlegt: KI-Vorschlag generieren,
          // aber nur wenn (a) noch kein manueller Text vorher gesetzt war
          // (hookSource !== 'file') und (b) der zuletzt per KI erzeugte
          // Text nicht schon zur aktuellen Manuskriptfassung passt (Hash-
          // Vergleich, verhindert unnoetige API-Aufrufe bei jedem
          // stuendlichen Sync). Ohne GEMINI_API_KEY (Script Property)
          // bleibt generateBlurbWithAI_ ein reines No-op, siehe dort.
          if (blurbSourceText && entry.hookSource !== 'file') {
            try {
              const srcHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blurbSourceText));
              if (entry.hookSourceHash !== srcHash || !entry.hook) {
                const aiBlurb = generateBlurbWithAI_(blurbSourceText, b.title, b.kind, code);
                if (aiBlurb) {
                  entry.hook = aiBlurb;
                  entry.hookSource = 'ai';
                  entry.hookSourceHash = srcHash;
                  entryChanged = true;
                  logDriveSync(logSheet, b.title, 'Klappentext (' + code + ') per KI generiert, neuer Anfang: "' + aiBlurb.slice(0, 60) + '"');
                }
              }
            } catch (err) {
              logDriveSync(logSheet, b.title, 'KI-Klappentext-Fehler (' + code + '): ' + err.message);
            }
          }
        }

        // EPUB neu bauen — nur wenn sich der Manuskripttext gerade geändert
        // hat (entryChanged aus dem Wortzahl-Block) oder noch gar keine
        // EPUB existiert. So läuft der Zip-Bau nicht bei jedem stündlichen
        // Sync unnötig erneut, nur wenn tatsächlich eine neue FINAL_-
        // Fassung erkannt wurde. Liest gut auf Handy/iPad (verstellbare
        // Schrift, Kapitel-Navigation) statt nur PDF/Drive-Link.
        const epubNeedsSecureRef = !entry.epubUrl || String(entry.epubUrl).indexOf('epub-ref:') !== 0;
        if (manuscriptText && (entryChanged || epubNeedsSecureRef)) {
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
        } else if (!info.finalFile && info.epubReadyFile) {
          // Kein Manuskript-Dokument -- die direkt hochgeladene, fertige
          // EPUB wird unveraendert uebernommen statt selbst eine zu bauen.
          try {
            const epubUrl = epubDownloadUrlFor_(info.epubReadyFile);
            if (epubUrl !== entry.epubUrl) {
              entry.epubUrl = epubUrl;
              entryChanged = true;
              logDriveSync(logSheet, b.title, 'Fertige EPUB-Datei uebernommen (' + code + '): ' + info.epubReadyFile.getName());
            }
          } catch (err) {
            logDriveSync(logSheet, b.title, 'EPUB-Uebernahme-Fehler (' + code + '): ' + err.message);
          }
        }

        if (entryChanged) {
          newLangs[code] = entry;
          changed = true;
          logDriveSync(logSheet, b.title, 'Sprachfassung aktualisiert (' + code + '): ' + (entry.wordCount || '?') + ' Wörter');
        }
      });

      // WICHTIG (Ursache fuer den Wortzahl/Klappentext-Vertauschungs-Bug
      // vom 17.09.2026, siehe ARCHITECTURE.md): b.langs sammelte bisher nur
      // an -- ein Sprachcode, dessen Manuskript-Unterordner komplett
      // geloescht/nie eigentlich gueltig war (z.B. ein EN-Ordner aus einem
      // fruehen Fehl-Upload unter einem falschen Buchtitel), blieb fuer
      // immer als verwaister Eintrag in b.langs stehen. Das Frontend
      // berechnet langCodes = Object.keys(b.langs) und zeigt bei >1 Eintrag
      // einen Sprach-Umschalter an, dessen Default-Tab (langCodes[0], nach
      // Einfuegereihenfolge) dann auf diesen alten, falschen Eintrag zeigen
      // konnte -- unabhaengig davon, welche Top-Level-Quellsprache
      // pickSyncSourceLanguage() korrekt fuer b.hook/b.wordCount waehlt.
      // Daher hier jeden Sprachcode aus newLangs entfernen, fuer den es
      // aktuell ueberhaupt keinen Ordner mehr gibt (nicht nur "nicht
      // fertig" -- ein Ordner mit laufender Uebersetzung bleibt erhalten).
      Object.keys(newLangs).forEach(function(code) {
        if (!langs[code]) {
          delete newLangs[code];
          changed = true;
          logDriveSync(logSheet, b.title, 'Verwaiste Sprachfassung entfernt (' + code + '): kein Manuskript-Ordner mehr vorhanden.');
        }
      });
      b.langs = newLangs;

      // Diagnose-Log: welche Sprache wurde als "bevorzugt" fuer die
      // Top-Level-Felder (b.hook/b.wordCount -- das ist, was tatsaechlich
      // auf der oeffentlichen Buchkarte angezeigt wird, wenn KEIN
      // Sprach-Umschalter aktiv ist, siehe effHook/effWordCount im
      // Frontend) ausgewaehlt, und was stand vorher/steht nachher drin.
      const sourceLang = pickSyncSourceLanguage(langs);
      logDriveSync(logSheet, b.title, 'Top-Level-Quellsprache: ' + (sourceLang || '(keine fertige Sprache)') + '; bisheriges b.hook: "' + (b.hook || '').slice(0, 40) + '"; bisheriges b.wordCount: ' + (b.wordCount || '?'));
      if (sourceLang && newLangs[sourceLang]) {
        const sourceEntry = newLangs[sourceLang];
        if (sourceEntry.wordCount && sourceEntry.wordCount !== b.wordCount) {
          b.wordCount = sourceEntry.wordCount;
          changed = true;
          logDriveSync(logSheet, b.title, 'Top-Level b.wordCount aktualisiert auf: ' + b.wordCount);
        }
        if (sourceEntry.hook && sourceEntry.hook !== (b.hook || '')) {
          b.hook = sourceEntry.hook;
          changed = true;
          logDriveSync(logSheet, b.title, 'Top-Level b.hook aktualisiert, neuer Anfang: "' + b.hook.slice(0, 60) + '"');
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
      const metaFile = findMetadataJsonFile_(folders.bookFolder);
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

  if (action === 'health') {
    return jsonOut({ ok: true, backendVersion: BACKEND_SOURCE_VERSION });
  }

  if (action === 'submit') {
    const access = resolveAccessContext_(e);
    if (!access.ok) return unauthorizedJson_();

    const itemType = String(e.parameter.itemType || '').trim();
    const itemId = String(e.parameter.itemId || '').trim();
    const comment = String(e.parameter.comment || '').trim();
    const starsRaw = String(e.parameter.stars || '').trim();
    const stars = starsRaw ? Number(starsRaw) : 0;
    if (['book', 'poem'].indexOf(itemType) === -1) return jsonOut({ ok: false, error: 'Ungültiger Bewertungstyp.' });
    if (!itemId || itemId.length > 240) return jsonOut({ ok: false, error: 'Ungültiger Titel.' });
    if (comment.length > 2000) return jsonOut({ ok: false, error: 'Kommentar ist zu lang.' });
    if (starsRaw && (!Number.isInteger(stars) || stars < 1 || stars > 5)) return jsonOut({ ok: false, error: 'Bewertung muss zwischen 1 und 5 liegen.' });
    if (!starsRaw && !comment) return jsonOut({ ok: false, error: 'Leere Bewertung.' });

    if (itemType === 'book') {
      const book = getBooksArray().filter(function(b) { return b.title === itemId; })[0];
      if (!book || !bookVisibleForAccess_(book, access)) return jsonOut({ ok: false, error: 'Buch nicht freigegeben.' });
    } else {
      if (!access.isAdmin && access.showPoems === false) return jsonOut({ ok: false, error: 'Gedichte nicht freigegeben.' });
      const poemExists = getPoemsArray().some(function(p) { return p.title === itemId; });
      if (!poemExists) return jsonOut({ ok: false, error: 'Gedicht nicht gefunden.' });
    }

    return withScriptLock_(function() {
      sheet.appendRow([new Date(), access.name || 'Admin', itemType, itemId, starsRaw || '', comment]);
      return jsonOut({ ok: true });
    }, 10000);
  }

  if (action === 'list') {
    const access = resolveAccessContext_(e);
    if (!access.ok) return unauthorizedJson_();
    const visibleBookTitles = {};
    getBooksArray().forEach(function(b) {
      if (bookVisibleForAccess_(b, access)) visibleBookTitles[b.title] = true;
    });
    const rows = sheet.getDataRange().getValues();
    const data = rows.map(function(r) {
      return { time: r[0], person: r[1], itemType: r[2], itemId: r[3], stars: r[4], comment: r[5] };
    }).filter(function(r) {
      if (r.itemType === 'book') return !!visibleBookTitles[r.itemId];
      if (r.itemType === 'poem') return access.isAdmin || access.showPoems !== false;
      return false;
    });
    return jsonOut({ ok: true, data: data });
  }

  if (action === 'saveBooks') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
    let books;
    try {
      books = JSON.parse(e.parameter.books || '[]');
    } catch (err) {
      return jsonOut({ ok: false, error: 'Ungültiges Bücher-JSON: ' + err.message });
    }
    if (!Array.isArray(books)) return jsonOut({ ok: false, error: 'Bücher-Daten sind kein Array.' });

    return withScriptLock_(function() {
    // Jedes Buch bekommt eine dauerhafte, vom Titel unabhaengige ID --
    // noetig, um beim Speichern zwischen "Buch umbenannt" und "Buch
    // geloescht" zu unterscheiden. Reines Titel-Diffing waere hier
    // gefaehrlich: eine Umbenennung sieht sonst identisch aus wie
    // Loeschen+Neuanlegen und wuerde faelschlich den Drive-Ordner des
    // umbenannten (weiterhin existierenden) Buchs in den Papierkorb
    // verschieben -- genau das, was mit "New Book" vorher passiert ist,
    // nur eben ungewollt automatisiert.
    books.forEach(function(b) { if (!b.id) b.id = Utilities.getUuid(); });

    // Drive-Aufraeumen: gelöschte Buecher -> zugehoerigen Ordner in den
    // Papierkorb verschieben; umbenannte Buecher -> Ordner mit umbenennen.
    // Laeuft in einem eigenen try/catch, damit ein Drive-Problem (z.B.
    // kurzzeitig nicht erreichbar) niemals das eigentliche Speichern der
    // Buchdaten verhindert -- das Speichern in der Tabelle ist der
    // kritische Pfad, die Drive-Ordnerpflege nur Komfort/Aufraeumen.
    try {
      const oldBooks = getBooksArray();
      const oldById = {};
      oldBooks.forEach(function(b) { if (b.id) oldById[b.id] = b; });
      const newIds = {};
      books.forEach(function(b) { newIds[b.id] = true; });

      const rootFolder = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
      const logSheet = getOrCreateSyncLogSheet_();

      Object.keys(oldById).forEach(function(id) {
        if (!newIds[id] && oldById[id].title) {
          trashBookFolderByTitle_(rootFolder, logSheet, oldById[id].title);
        }
      });
      books.forEach(function(b) {
        const old = oldById[b.id];
        if (old && old.title && b.title && old.title !== b.title) {
          renameBookFolderIfExists_(rootFolder, logSheet, old.title, b.title);
        }
      });
    } catch (err) {
      try { logDriveSync(getOrCreateSyncLogSheet_(), '(saveBooks)', 'Fehler beim Drive-Aufraeumen: ' + err.message); } catch (e2) {}
    }

    setBooksArray(books);
    return jsonOut({ ok: true });
    });
  }

  if (action === 'getBooks') {
    return jsonOut({ ok: true, books: JSON.stringify(booksForRequest_(e)) });
  }

  if (action === 'savePoems') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
    let poems;
    try {
      poems = JSON.parse(e.parameter.poems || '[]');
    } catch (err) {
      return jsonOut({ ok: false, error: 'Ungültiges Gedichte-JSON: ' + err.message });
    }
    if (!Array.isArray(poems)) return jsonOut({ ok: false, error: 'Gedichte-Daten sind kein Array.' });
    return withScriptLock_(function() {
      setPoemsArray(poems);
      return jsonOut({ ok: true });
    });
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
    if (!admin.ok) return unauthorizedJson_();
    return withScriptLock_(function() {
      const settingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SettingsData') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('SettingsData');
      settingsSheet.getRange('A1').setValue(e.parameter.settings || '{}');
      return jsonOut({ ok: true });
    });
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
      cleanupExpiredAdminTokens_();
      const token = Utilities.getUuid();
      props.setProperty('admintoken_' + token, String(Date.now()));
      result.adminToken = token;
    }
    return jsonOut(result);
  }

  if (action === 'logoutAdmin') {
    const token = (e.parameter.adminToken || '').trim();
    if (token) PropertiesService.getScriptProperties().deleteProperty('admintoken_' + token);
    return jsonOut({ ok: true });
  }

  if (action === 'checkAccess') {
    const access = resolveAccessContext_(e);
    if (!access.ok || access.isAdmin) return jsonOut({ ok: false });
    const code = (e.parameter.code || '').trim();
    notifyFirstLogin_(code, access.name);
    return jsonOut({
      ok: true, name: access.name, canDownload: access.canDownload, canCopy: access.canCopy,
      visibleBooks: access.visibleBooks, showPoems: access.showPoems, epubAccess: access.epubAccess
    });
  }

  if (action === 'getAccessList') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
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
    if (!admin.ok) return unauthorizedJson_();
    return withScriptLock_(function() {
      const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Access');
      if (accessSheet.getLastRow() === 0) accessSheet.appendRow(['Name', 'Code', 'CanDownload', 'CanCopy', 'VisibleBooks', 'ShowPoems', 'EpubAccess']);
      const code = generateAccessCode();
      accessSheet.appendRow([
        String(e.parameter.name || 'Unbenannt').slice(0, 120),
        code,
        e.parameter.canDownload === 'true',
        e.parameter.canCopy === 'true',
        e.parameter.visibleBooks || '',
        e.parameter.showPoems === undefined ? true : e.parameter.showPoems === 'true',
        e.parameter.epubAccess || '{}'
      ]);
      return jsonOut({ ok: true, code: code });
    });
  }

  // Ändert nachträglich Download/Kopieren-Rechte UND sichtbare Bücher eines
  // bestehenden Zugangscodes — ohne den Code selbst neu zu erzeugen (der ja
  // schon weitergegeben sein kann). Leerer String/leeres Array bei
  // visibleBooks = wieder alle Bücher sichtbar.
  if (action === 'updateAccess') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
    return withScriptLock_(function() {
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
    });
  }

  if (action === 'removeAccess') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
    return withScriptLock_(function() {
      const accessSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Access');
      if (accessSheet) {
        const data = accessSheet.getDataRange().getValues();
        for (let i = data.length - 1; i >= 1; i--) {
          if (String(data[i][1]) === e.parameter.code) { accessSheet.deleteRow(i + 1); break; }
        }
      }
      return jsonOut({ ok: true });
    });
  }

  // Liefert die Rohbytes einer EPUB-Datei Base64-codiert an den Browser.
  // Der Endpunkt ist NICHT oeffentlich: Leser brauchen einen gueltigen
  // Zugangscode mit Buch-/Aktionsrecht, Admins einen gueltigen Admin-Token.
  // Die angefragte Datei-ID wird zusaetzlich an GENAU den uebergebenen
  // Buchtitel gebunden und gegen die gespeicherten EPUB-Referenzen geprueft;
  // damit kann eine Berechtigung fuer Buch A nicht mit der Datei-ID von Buch B
  // kombiniert werden.
  if (action === 'getEpubData') {
    const epubUrl = e.parameter.epubUrl || '';
    const idMatch = epubUrl.match(/[-\w]{25,}/);
    if (!idMatch) return jsonOut({ ok: false, error: 'Keine gültige EPUB-URL.' });
    const requestedId = idMatch[0];
    const bookTitle = e.parameter.bookTitle || '';
    const intent = e.parameter.intent === 'download' ? 'download' : 'read';
    const access = resolveAccessContext_(e);
    if (!access.ok) return jsonOut({ ok: false, error: 'Kein Zugriff auf dieses Buch.' });
    if (!access.isAdmin && Array.isArray(access.visibleBooks) && access.visibleBooks.indexOf(bookTitle) < 0) {
      return jsonOut({ ok: false, error: 'Kein Zugriff auf dieses Buch.' });
    }
    if (!access.canDownload) {
      const perm = (access.epubAccess && access.epubAccess[bookTitle]) || {};
      const allowed = intent === 'download' ? !!perm.download : !!perm.read;
      if (!allowed) return jsonOut({ ok: false, error: 'Kein Zugriff auf dieses Buch.' });
    }

    // Sicherheits-Check wie bisher: die angefragte Datei-ID muss tatsaechlich
    // zu einem hinterlegten EPUB gehoeren, sonst waere dieser Endpunkt ein
    // Oracle fuer beliebige Drive-Datei-IDs.
    const books = getBooksArray();
    let known = false;
    books.forEach(function(b) {
      if (b.title !== bookTitle) return;
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

  // Ermittelt den Buchtitel direkt aus einer EPUB-Datei, BEVOR sie
  // endgueltig hochgeladen wird (§52) -- schreibt nichts nach Drive, rein
  // lesende Vorab-Aktion. Admin-geschuetzt wie uploadBookFile, weil sie
  // denselben adminToken-Kontext braucht und kein oeffentlicher Endpunkt
  // sein muss.
  if (action === 'detectEpubTitle') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
    try {
      const base64Data = e.parameter.fileData || '';
      if (!base64Data) return jsonOut({ ok: false, error: 'Keine Datei erhalten.' });
      if (base64Data.length > 40 * 1024 * 1024) return jsonOut({ ok: false, error: 'EPUB zu groß für die Titelerkennung.' });
      const title = epubTitleFromBytes_(Utilities.base64Decode(base64Data));
      return jsonOut({ ok: true, title: title || '' });
    } catch (err) {
      return jsonOut({ ok: false, error: String(err && err.message || err) });
    }
  }

  // Manuskript/Klappentext DIREKT vom Geraet hochladen (z.B. Handy/iCloud),
  // als Alternative zum bisherigen Weg "Datei selbst in Drive hochladen,
  // dann Link einfuegen". Legt die Datei als ECHTE Drive-Datei mit
  // korrektem FINAL_/ENTWURF_/KLAPPENTEXT_-Praefix im richtigen
  // Sprach-Unterordner ab -- an der bestehenden Ordnerstruktur und dem
  // bestehenden Sync (syncDriveForAllBooks, EPUB-Erzeugung, Wortzahl,
  // Klappentext-Uebernahme) aendert sich dadurch NICHTS, die Datei wird
  // einfach genauso gefunden wie eine manuell hochgeladene. Triggert nach
  // dem Ablegen direkt den Sync, damit Wortzahl/EPUB/Klappentext ohne
  // Warten auf den naechsten Stunden-Trigger aktualisiert werden.
  if (action === 'uploadBookFile') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
    try {
      const bookTitle = (e.parameter.bookTitle || '').trim();
      const langCode = (e.parameter.langCode || '').trim().toUpperCase();
      const kind = (e.parameter.kind || '').trim().toUpperCase(); // FINAL | ENTWURF | KLAPPENTEXT | METADATA | EPUB
      const fileName = e.parameter.fileName || 'upload';
      const mimeType = e.parameter.mimeType || 'application/octet-stream';
      const base64Data = e.parameter.fileData || '';
      if (!bookTitle) return jsonOut({ ok: false, error: 'Kein Buchtitel angegeben.' });
      // EPUB: bereits fertige EPUB-Datei anstelle eines Manuskript-Dokuments
      // (siehe scanBookLanguages/syncDriveForAllBooks + ARCHITECTURE.md) --
      // landet wie FINAL_/ENTWURF_ im Sprach-Unterordner, braucht also einen
      // Sprachcode, macht die Sprache aber auch OHNE FINAL_-Datei "fertig".
      if (['FINAL', 'ENTWURF', 'KLAPPENTEXT', 'METADATA', 'EPUB'].indexOf(kind) === -1) return jsonOut({ ok: false, error: 'Ungültiger Dateityp.' });
      // METADATA (metadata.json fuers Genre) liegt direkt im Buch-Hauptordner,
      // braucht anders als Manuskript/Klappentext KEINEN Sprach-Unterordner.
      if (kind !== 'METADATA' && !/^[A-Z]{2,5}$/.test(langCode)) return jsonOut({ ok: false, error: 'Ungültiger Sprachcode (z.B. DE, EN, BS).' });
      if (!base64Data) return jsonOut({ ok: false, error: 'Keine Datei erhalten.' });
      // Apps Script hat harte Request-/Laufzeitgrenzen. Früh ablehnen statt
      // erst beim base64Decode/Drive-Write unkontrolliert zu scheitern.
      const MAX_UPLOAD_BASE64_CHARS = 40 * 1024 * 1024;
      if (base64Data.length > MAX_UPLOAD_BASE64_CHARS) return jsonOut({ ok: false, error: 'Datei zu groß für den Direkt-Upload — bitte über Drive ablegen.' });

      const rootFolder = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
      const folders = ensureBookFolders(rootFolder, bookTitle);
      const targetFolder = (kind === 'METADATA') ? folders.bookFolder : getOrCreateSubfolder(folders.manuskriptFolder, langCode);

      // Vorherige Datei ersetzen (in den Papierkorb), damit ein erneuter
      // Upload nicht mehrere Dateien nebeneinander anlegt. Bei METADATA
      // zaehlt dafuer jede vorhandene .json-Datei im Ordner (siehe
      // findMetadataJsonFile_ -- unabhaengig vom genauen Dateinamen), bei
      // den anderen Arten weiterhin der feste Praefix (FINAL_ etc.).
      const prefix = kind + '_';
      const existing = (kind === 'METADATA') ? findMetadataJsonFile_(targetFolder) : findFileByPrefix(targetFolder, prefix);
      if (existing) existing.setTrashed(true);

      let newName;
      if (kind === 'METADATA') {
        newName = 'metadata.json';
      } else {
        const dotIdx = fileName.lastIndexOf('.');
        const ext = dotIdx >= 0 ? fileName.slice(dotIdx) : '';
        const safeTitle = bookTitle.replace(/[\\\/:*?"<>|]/g, '_');
        newName = prefix + safeTitle + ext;
      }
      const bytes = Utilities.base64Decode(base64Data);
      const blob = Utilities.newBlob(bytes, mimeType, newName);
      targetFolder.createFile(blob);

      // Sofort synchronisieren, statt auf den naechsten Stunden-Trigger zu
      // warten -- ein Fehler hier darf den erfolgreichen Upload selbst
      // nicht als fehlgeschlagen melden, daher separat abgefangen.
      let syncError = '';
      try { syncDriveForAllBooks(); } catch (syncErr) { syncError = String(syncErr && syncErr.message || syncErr); }

      return jsonOut({ ok: true, fileName: newName, syncError: syncError });
    } catch (err) {
      return jsonOut({ ok: false, error: String(err && err.message || err) });
    }
  }

  if (action === 'syncWordCount') {
    const admin = checkAdmin(e);
    if (!admin.ok) return unauthorizedJson_();
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
    if (!admin.ok) return unauthorizedJson_();
    try {
      syncDriveForAllBooks();
      return jsonOut({ ok: true });
    } catch (err) {
      return jsonOut({ ok: false, error: err.message });
    }
  }

  return jsonOut({ ok: false, error: 'unknown action' });
}
