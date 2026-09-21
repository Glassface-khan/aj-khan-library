/**
 * ============================================================================
 * STIL-REVISIONS-MODUL — Backend-Ergänzung (Phase 2: Datenmodell + Upload +
 * Splitting + Regelwerk-Verwaltung)
 * ============================================================================
 *
 * WAS DAS HIER IST
 * Diese Datei ist ein ZUSATZ zu deinem bestehenden Apps-Script-Projekt
 * (Code.gs), nicht ein Ersatz. Sie fügt ausschließlich NEUE Funktionen und
 * NEUE action=revisionXxx-Endpunkte hinzu. Keine bestehende Funktion
 * (getBooks, saveBooks, checkPassword, addAccess, removeAccess,
 * syncWordCount, ...) wird verändert oder überschrieben.
 *
 * WIE EINFÜGEN (sicher, ohne die Live-Seite zu gefährden)
 * 1. Im Apps-Script-Editor (script.google.com, dein bestehendes Projekt):
 *    Datei → Neu → Skript. Nenne die neue Datei z. B. "RevisionModule".
 * 2. Den kompletten Inhalt dieser Datei dort hineinkopieren.
 * 3. In deiner bestehenden handle(e)-Funktion (Code.gs, wird von doGet/doPost
 *    aufgerufen) ganz am Anfang EINE Zeile ergänzen — siehe Abschnitt
 *    "INTEGRATION IN handle(e)" ganz unten in dieser Datei. Das ist der
 *    EINZIGE Berührungspunkt mit deinem bestehenden Code.
 * 4. Einmalig die Funktion `setupRevisionModule` manuell ausführen
 *    (Dropdown oben im Editor auf "setupRevisionModule" stellen → ▶ Run).
 *    Das legt die neuen Sheet-Tabs und den Drive-Ordner an. Passiert
 *    NICHTS mit deinen bestehenden Tabs (Books, Access, ...).
 * 5. Deploy → Manage deployments → Stift-Symbol → Version auf "New version"
 *    → Deploy. (Die Falle aus ARCHITECTURE.md §7: nur Speichern reicht nicht.)
 *
 * INTEGRATION BESTÄTIGT (29.08.2026)
 * Per Screenshot durchgesehen: doGet(e)/doPost(e) rufen beide handle(e) auf;
 * checkAdmin(e) prüft das Token (e.parameter.adminToken gegen
 * PropertiesService, Key-Präfix 'admintoken_', 24h-Ablauf), jsonOut(obj)
 * baut die JSON-Antwort. assertAdminToken_ unten ruft checkAdmin(e) direkt
 * auf — kein Rätselraten mehr nötig, keine weitere Anpassung an dieser
 * Datei erforderlich außer dem einen Einfüge-Schritt in handle(e) (Punkt 3).
 *
 * DATENMODELL DIESER PHASE
 * Volltexte (Kapiteltexte, Regelwerk-Inhalt) NICHT in Sheet-Zellen — das
 * Cover-Upload-Problem (hart bei 45 000 Zeichen gedeckelt, siehe
 * ARCHITECTURE.md §3) tritt bei ganzen Kapiteln/Regelwerken noch viel
 * früher auf. Stattdessen: Volltexte als JSON/Text-Dateien in einem eigenen
 * Drive-Ordner, Sheet-Zeilen halten nur Metadaten + eine driveFileId als
 * Zeiger. Gleiches Muster wie die bereits geplante Drive-Ordnerstruktur aus
 * ARCHITECTURE.md §7 ("/AJ Khan Bücher/<Titel>/...").
 *
 * Sheet-Tabs (angelegt von setupRevisionModule, falls nicht vorhanden):
 *   RevisionNovels     — id, title, author, createdAt, activeRulesetId, archived
 *   RevisionRulesets   — id, novelId, name, version, driveFileId,
 *                        targetCorridorsJson, createdAt, archived
 *   RevisionManuscripts— id, novelId, uploadedAt, originalFilename,
 *                        driveFileId, sectionCount, status, archived
 *   RevisionRuns       — (Schema für Phase 3, hier nur Header, noch ungenutzt)
 *   RevisionReviews    — (Schema für Phase 6, hier nur Header, noch ungenutzt)
 *   RevisionExports    — (Schema für Phase 4/5, hier nur Header, noch ungenutzt)
 *
 * Nichts wird hart gelöscht ("archived"-Flag statt echtem Löschen) — passend
 * zur Vorgabe "ich will jederzeit zur vorherigen Fassung zurück können".
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// KONFIGURATION
// ---------------------------------------------------------------------------

var REVISION_SHEET_NAMES = {
  NOVELS: 'RevisionNovels',
  RULESETS: 'RevisionRulesets',
  MANUSCRIPTS: 'RevisionManuscripts',
  RUNS: 'RevisionRuns',
  REVIEWS: 'RevisionReviews',
  EXPORTS: 'RevisionExports'
};

var REVISION_SHEET_HEADERS = {
  RevisionNovels: ['id', 'title', 'author', 'createdAt', 'activeRulesetId', 'archived'],
  RevisionRulesets: ['id', 'novelId', 'name', 'version', 'driveFileId', 'targetCorridorsJson', 'createdAt', 'archived'],
  RevisionManuscripts: ['id', 'novelId', 'uploadedAt', 'originalFilename', 'driveFileId', 'sectionCount', 'status', 'archived'],
  // Ab hier: Schema schon angelegt, Aktionen folgen erst in späteren Phasen.
  RevisionRuns: ['id', 'manuscriptId', 'startedBy', 'startedAt', 'finishedAt', 'status', 'rulesetSnapshotDriveFileId'],
  RevisionReviews: ['id', 'manuscriptId', 'aiProvider', 'createdAt', 'driveFileId'],
  RevisionExports: ['id', 'manuscriptId', 'target', 'targetFolderPath', 'status', 'createdAt', 'resultUrl']
};

var REVISION_DRIVE_ROOT_FOLDER_NAME = 'AJ Khan Bücher';
var REVISION_DRIVE_SUBFOLDER_NAME = '_StilRevision';

// ---------------------------------------------------------------------------
// EINMALIGES SETUP — manuell im Editor ausführen (Dropdown → setupRevisionModule → Run)
// ---------------------------------------------------------------------------

function setupRevisionModule() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(REVISION_SHEET_HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    var headers = REVISION_SHEET_HEADERS[name];
    var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    var hasHeaders = firstRow.some(function (v) { return v !== ''; });
    if (!hasHeaders) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });
  getOrCreateRevisionRootFolder_();
  Logger.log('Stil-Revisions-Modul: Sheet-Tabs + Drive-Ordner eingerichtet.');
}

function getOrCreateRevisionRootFolder_() {
  var root = getOrCreateFolderByName_(DriveApp.getRootFolder(), REVISION_DRIVE_ROOT_FOLDER_NAME);
  return getOrCreateFolderByName_(root, REVISION_DRIVE_SUBFOLDER_NAME);
}

function getOrCreateFolderByName_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function getRevisionSubfolder_(pathParts) {
  var folder = getOrCreateRevisionRootFolder_();
  pathParts.forEach(function (part) {
    folder = getOrCreateFolderByName_(folder, String(part));
  });
  return folder;
}

// ---------------------------------------------------------------------------
// AUTH — bestätigt kompatibel mit dem echten Code.gs (Stand 29.08.2026)
// ---------------------------------------------------------------------------

/**
 * Wirft einen Fehler, wenn das Admin-Token ungültig/abgelaufen ist.
 * Delegiert an das bestehende checkAdmin(e) aus Code.gs — das liest
 * e.parameter.adminToken selbst und prüft es gegen PropertiesService
 * (Key-Präfix 'admintoken_', 24h-Ablauf). Erwartet deshalb das volle
 * Event-Objekt `e` (nicht nur den Token-String) als Argument.
 */
function assertAdminToken_(e) {
  var result = checkAdmin(e);
  if (!result || !result.ok) throw new Error('Ungültiges oder abgelaufenes Admin-Token.');
}

// ---------------------------------------------------------------------------
// HILFSFUNKTIONEN — Sheet als einfache Tabelle lesen/schreiben
// ---------------------------------------------------------------------------

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet-Tab "' + name + '" fehlt. Bitte zuerst setupRevisionModule ausführen.');
  return sheet;
}

function readRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (v) { return v === ''; })) continue;
    var obj = {};
    headers.forEach(function (h, idx) { obj[h] = row[idx]; });
    rows.push(obj);
  }
  return rows;
}

function appendRow_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = REVISION_SHEET_HEADERS[sheetName];
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sheet.appendRow(row);
}

function updateRowById_(sheetName, id, patch) {
  var sheet = getSheet_(sheetName);
  var headers = REVISION_SHEET_HEADERS[sheetName];
  var idCol = headers.indexOf('id') + 1;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idCol - 1]) === String(id)) {
      headers.forEach(function (h, idx) {
        if (patch.hasOwnProperty(h)) {
          sheet.getRange(i + 1, idx + 1).setValue(patch[h]);
        }
      });
      return true;
    }
  }
  return false;
}

function newId_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// NOVELS
// ---------------------------------------------------------------------------

function revisionListNovels_() {
  return readRows_(REVISION_SHEET_NAMES.NOVELS).filter(function (n) { return !n.archived; });
}

function revisionSaveNovel_(payload) {
  var isNew = !payload.id;
  if (isNew) {
    var novel = {
      id: newId_(),
      title: payload.title || '',
      author: payload.author || '',
      createdAt: nowIso_(),
      activeRulesetId: payload.activeRulesetId || '',
      archived: false
    };
    appendRow_(REVISION_SHEET_NAMES.NOVELS, novel);
    return novel;
  }
  var patch = {};
  ['title', 'author', 'activeRulesetId'].forEach(function (k) {
    if (payload.hasOwnProperty(k)) patch[k] = payload[k];
  });
  updateRowById_(REVISION_SHEET_NAMES.NOVELS, payload.id, patch);
  return { id: payload.id, updated: true };
}

// ---------------------------------------------------------------------------
// RULESETS — Regelwerk-Text liegt als Drive-Datei, Sheet hält nur Metadaten.
// Jede Änderung erzeugt eine NEUE Version (kein Überschreiben) — damit ein
// bereits gelaufener Revisions-Lauf reproduzierbar bleibt, auch wenn das
// Regelwerk später weiterbearbeitet wird.
// ---------------------------------------------------------------------------

function revisionListRulesets_(novelId) {
  var all = readRows_(REVISION_SHEET_NAMES.RULESETS).filter(function (r) { return !r.archived; });
  if (!novelId) return all;
  return all.filter(function (r) { return !r.novelId || r.novelId === novelId; });
}

function revisionSaveRuleset_(payload) {
  // payload: { novelId (leer = global/wiederverwendbar), name, content, targetCorridors: {...} }
  var folder = getRevisionSubfolder_(['Regelwerke']);
  var existing = readRows_(REVISION_SHEET_NAMES.RULESETS)
    .filter(function (r) { return r.name === payload.name && r.novelId === (payload.novelId || ''); });
  var nextVersion = 1;
  existing.forEach(function (r) { if (Number(r.version) >= nextVersion) nextVersion = Number(r.version) + 1; });

  var fileName = payload.name.replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '') + '-v' + nextVersion + '.md';
  var file = folder.createFile(fileName, payload.content || '', MimeType.PLAIN_TEXT);

  var ruleset = {
    id: newId_(),
    novelId: payload.novelId || '',
    name: payload.name,
    version: nextVersion,
    driveFileId: file.getId(),
    targetCorridorsJson: JSON.stringify(payload.targetCorridors || {}),
    createdAt: nowIso_(),
    archived: false
  };
  appendRow_(REVISION_SHEET_NAMES.RULESETS, ruleset);
  return ruleset;
}

function revisionGetRuleset_(id) {
  var rows = readRows_(REVISION_SHEET_NAMES.RULESETS);
  var row = rows.filter(function (r) { return r.id === id; })[0];
  if (!row) throw new Error('Regelwerk nicht gefunden: ' + id);
  var content = DriveApp.getFileById(row.driveFileId).getBlob().getDataAsString('UTF-8');
  row.content = content;
  row.targetCorridors = JSON.parse(row.targetCorridorsJson || '{}');
  return row;
}

// ---------------------------------------------------------------------------
// MANUSCRIPTS + SECTIONS (Splitting)
// Das eigentliche Splitting (Heading-Erkennung, manuelle Korrektur) passiert
// CLIENT-SEITIG im Admin-Panel (Browser) — hier wird nur das fertige Ergebnis
// entgegengenommen und gespeichert. Grund: docx/pdf-Parsing-Bibliotheken
// (mammoth, pdf.js) laufen im Browser; Apps Script hat dafür keine
// vergleichbaren Bibliotheken, und wir wollen große Dateien nicht durch den
// Apps-Script-Request-Body schleusen müssen, bevor der Nutzer die
// Kapitelgrenzen manuell geprüft hat.
// ---------------------------------------------------------------------------

function revisionListManuscripts_(novelId) {
  var all = readRows_(REVISION_SHEET_NAMES.MANUSCRIPTS).filter(function (m) { return !m.archived; });
  if (!novelId) return all;
  return all.filter(function (m) { return m.novelId === novelId; });
}

function revisionUploadManuscript_(payload) {
  // payload: { novelId, originalFilename, sections: [{ heading, original }] }
  if (!payload.novelId) throw new Error('novelId fehlt.');
  if (!payload.sections || !payload.sections.length) throw new Error('Keine Abschnitte übergeben.');

  var sections = payload.sections.map(function (s, idx) {
    return {
      id: idx,
      heading: s.heading,
      original: s.original,
      wordsOriginal: (s.original.match(/\S+/g) || []).length,
      status: 'pending', // pending | processing | done | error | approved
      revised: '',
      changes: [],
      wordsAfter: 0,
      error: ''
    };
  });

  var folder = getRevisionSubfolder_(['Manuskripte', payload.novelId]);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Berlin', 'yyyyMMdd-HHmmss');
  var fileName = stamp + '_' + (payload.originalFilename || 'manuskript') + '.json';
  var file = folder.createFile(fileName, JSON.stringify({ sections: sections }), MimeType.PLAIN_TEXT);

  var manuscript = {
    id: newId_(),
    novelId: payload.novelId,
    uploadedAt: nowIso_(),
    originalFilename: payload.originalFilename || '',
    driveFileId: file.getId(),
    sectionCount: sections.length,
    status: 'ready', // ready = gesplittet, wartet auf Revisions-Lauf (Phase 3)
    archived: false
  };
  appendRow_(REVISION_SHEET_NAMES.MANUSCRIPTS, manuscript);
  return manuscript;
}

function revisionGetManuscript_(id) {
  var rows = readRows_(REVISION_SHEET_NAMES.MANUSCRIPTS);
  var row = rows.filter(function (m) { return m.id === id; })[0];
  if (!row) throw new Error('Manuskript nicht gefunden: ' + id);
  var data = JSON.parse(DriveApp.getFileById(row.driveFileId).getBlob().getDataAsString('UTF-8'));
  row.sections = data.sections;
  return row;
}

/**
 * Erlaubt die manuelle Korrektur der Kapitelgrenzen (Abschnitte
 * zusammenführen/teilen/umbenennen), BEVOR ein Revisions-Lauf startet.
 * Ersetzt die komplette sections-Liste in der Drive-Datei.
 */
function revisionUpdateManuscriptSections_(payload) {
  // payload: { manuscriptId, sections: [...] }
  var rows = readRows_(REVISION_SHEET_NAMES.MANUSCRIPTS);
  var row = rows.filter(function (m) { return m.id === payload.manuscriptId; })[0];
  if (!row) throw new Error('Manuskript nicht gefunden: ' + payload.manuscriptId);
  var file = DriveApp.getFileById(row.driveFileId);
  file.setContent(JSON.stringify({ sections: payload.sections }));
  updateRowById_(REVISION_SHEET_NAMES.MANUSCRIPTS, row.id, { sectionCount: payload.sections.length });
  return { id: row.id, sectionCount: payload.sections.length };
}

// ---------------------------------------------------------------------------
// INTEGRATION IN handle(e) — echter, ausführbarer Code (kein Kommentar mehr)
// ---------------------------------------------------------------------------
//
// Bestätigt (29.08.2026, per Code.gs durchgesehen): doGet(e)/doPost(e) rufen
// beide handle(e) auf; checkAdmin(e) prüft das Token (e.parameter.adminToken,
// PropertiesService-Key 'admintoken_' + token, 24h-Ablauf), jsonOut(obj)
// baut die JSON-Antwort im Muster {ok:true,...} bzw. {ok:false,error:...}.
// handleRevisionAction(e) unten nutzt exakt diese beiden — kein eigenes
// Antwortformat, kein eigener Auth-Mechanismus. Alle Apps-Script-Dateien
// eines Projekts teilen sich einen globalen Namensraum, deshalb ist diese
// Funktion hier in RevisionModule.gs genauso aufrufbar wie jede Funktion
// aus Code.gs selbst — sie muss nicht dorthin verschoben werden.
//
// Try/catch um den ganzen Zweig: ein Fehler in einer revisionXxx_-Funktion
// (z. B. "Manuskript nicht gefunden") kommt dadurch als sauberes
// {ok:false, error: "..."} zurück statt als rohe Server-Exception — gleiches
// Verhalten wie der Rest von Code.gs bei ungültigem Input.
function handleRevisionAction(e) {
  var REVISION_ACTIONS = [
    'revisionListNovels', 'revisionSaveNovel',
    'revisionListRulesets', 'revisionSaveRuleset', 'revisionGetRuleset',
    'revisionListManuscripts', 'revisionUploadManuscript',
    'revisionGetManuscript', 'revisionUpdateManuscriptSections'
  ];
  var p = e.parameter;
  if (REVISION_ACTIONS.indexOf(p.action) === -1) return null; // nicht zuständig

  try {
    switch (p.action) {
      case 'revisionListNovels':
        assertAdminToken_(e);
        return jsonOut(revisionListNovels_());
      case 'revisionSaveNovel':
        assertAdminToken_(e);
        return jsonOut(revisionSaveNovel_(JSON.parse(p.payload)));
      case 'revisionListRulesets':
        assertAdminToken_(e);
        return jsonOut(revisionListRulesets_(p.novelId));
      case 'revisionSaveRuleset':
        assertAdminToken_(e);
        return jsonOut(revisionSaveRuleset_(JSON.parse(p.payload)));
      case 'revisionGetRuleset':
        assertAdminToken_(e);
        return jsonOut(revisionGetRuleset_(p.id));
      case 'revisionListManuscripts':
        assertAdminToken_(e);
        return jsonOut(revisionListManuscripts_(p.novelId));
      case 'revisionUploadManuscript':
        assertAdminToken_(e);
        return jsonOut(revisionUploadManuscript_(JSON.parse(p.payload)));
      case 'revisionGetManuscript':
        assertAdminToken_(e);
        return jsonOut(revisionGetManuscript_(p.id));
      case 'revisionUpdateManuscriptSections':
        assertAdminToken_(e);
        return jsonOut(revisionUpdateManuscriptSections_(JSON.parse(p.payload)));
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
  return null;
}
//
// Der einzige Eingriff in Code.gs bleibt diese eine Stelle, ganz am Anfang
// von handle(e) (siehe die von Claude Code bereitgestellte, fertig
// zusammengeführte Code.gs-Datei für die exakte Einfügestelle):
//
//   function handle(e) {
//     const revisionResponse = handleRevisionAction(e);
//     if (revisionResponse) return revisionResponse;
//     // ... ab hier dein bestehender Code unverändert ...
//   }
// ---------------------------------------------------------------------------
