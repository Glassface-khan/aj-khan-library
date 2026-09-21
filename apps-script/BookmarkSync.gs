/**
 * ============================================================================
 * LESE-BOOKMARK-SYNC — Backend-Ergänzung (geräteübergreifend, Abschnitt 21)
 * ============================================================================
 *
 * WAS DAS HIER IST
 * Diese Datei ist ein ZUSATZ zu deinem bestehenden Apps-Script-Projekt
 * (Code.gs), nicht ein Ersatz — gleiches Muster wie RevisionModule.gs
 * (siehe dort für den ausführlich dokumentierten Präzedenzfall). Sie fügt
 * ausschließlich NEUE Funktionen und zwei NEUE Aktionen (`getBookmark`,
 * `saveBookmark`) hinzu. Keine bestehende Funktion (getEpubData, checkAccess,
 * getBooks, saveBooks, ...) wird verändert oder überschrieben.
 *
 * Hintergrund: Der Inline-EPUB-Reader (Abschnitt 16) merkt sich die
 * Leseposition seit Abschnitt 19 rein clientseitig in localStorage — pro
 * Gerät/Browser getrennt. Diese Datei ergänzt die fehlende Serverseite,
 * damit ein zweites Gerät mit demselben Zugangscode an derselben Stelle
 * weiterlesen kann. Das Frontend (index.html, bereits gepusht) ruft
 * `getBookmark` beim Öffnen des Readers parallel zur EPUB-Datei ab und
 * `saveBookmark` gedrosselt (alle 2s) beim Weiterlesen (relocated-Event).
 *
 * WIE EINFÜGEN (sicher, ohne die Live-Seite zu gefährden)
 * 1. Im Apps-Script-Editor (script.google.com, dein bestehendes Projekt):
 *    Datei → Neu → Skript. Nenne die neue Datei "BookmarkSync".
 * 2. Den kompletten Inhalt dieser Datei dort hineinkopieren.
 * 3. In deiner bestehenden handle(e)-Funktion (Code.gs) ganz am Anfang EINE
 *    Zeile ergänzen — siehe "INTEGRATION IN handle(e)" ganz unten. Das ist
 *    der einzige Berührungspunkt mit deinem bestehenden Code.
 * 4. Einmalig die Funktion `setupBookmarkSync` manuell ausführen (Dropdown
 *    oben im Editor auf "setupBookmarkSync" stellen → ▶ Run). Legt nur den
 *    neuen Sheet-Tab "Bookmarks" an, fasst keinen bestehenden Tab an.
 * 5. Deploy → Manage deployments → Stift-Symbol → Version auf "New version"
 *    → Deploy. (Die Falle aus ARCHITECTURE.md §7: nur Speichern reicht nicht.)
 *
 * AUTH-MODELL — bewusst einfach gehalten
 * `code` ist genau der Zugangscode, den der Client ohnehin schon als
 * `visitorAccessCode` kennt (derselbe, der gegen `checkAccess` geprüft
 * wird) — hier aber NICHT erneut gegen das Access-Sheet validiert, sondern
 * nur als opaker Schlüssel benutzt, um Bookmarks pro Nutzer zu trennen.
 * Grund: Der Bookmark selbst (eine CFI, eine Positions-Referenz innerhalb
 * einer EPUB, die der Nutzer ohnehin per getEpubData/downloadEpub schon
 * bekommen haben muss) ist kein schützenswerter Inhalt — anders als das
 * EPUB selbst, das über epubAccess (Abschnitt 17) hart geprüft wird.
 * Schlimmstenfalls mit falschem/geratenem Code: jemand liest oder
 * überschreibt eine fremde Leseposition — kein Zugriff auf Buchinhalte.
 * Wer das strenger will: assertKnownAccessCode_() unten einkommentieren
 * (nutzt exakt die gleiche Access-Sheet-Spalte, die checkAccess auch
 * gegen den Code abgleicht — Spaltenindex ggf. an dein Access-Sheet
 * anpassen, siehe ARCHITECTURE.md §7/§17 für das Spaltenlayout).
 *
 * DATENMODELL
 * Neuer Sheet-Tab "Bookmarks": Code | EpubUrl | Cfi | UpdatedAt
 * Eine Zeile pro (Code, EpubUrl)-Kombination, upsert bei jedem saveBookmark.
 * EpubUrl als Schlüsselteil (nicht Buchtitel) — exakt dieselbe Eindeutigkeit
 * wie der bisherige localStorage-Key `ajk_epub_bookmark_<epubUrl>`
 * (Abschnitt 19), unterscheidet also automatisch auch zwischen
 * Sprachfassungen desselben Buchs.
 * ============================================================================
 */

var BOOKMARK_SHEET_NAME = 'Bookmarks';
var BOOKMARK_SHEET_HEADERS = ['Code', 'EpubUrl', 'Cfi', 'UpdatedAt'];

// ---------------------------------------------------------------------------
// EINMALIGES SETUP — manuell im Editor ausführen (Dropdown → setupBookmarkSync → Run)
// ---------------------------------------------------------------------------

function setupBookmarkSync() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BOOKMARK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BOOKMARK_SHEET_NAME);
  }
  var firstRow = sheet.getRange(1, 1, 1, BOOKMARK_SHEET_HEADERS.length).getValues()[0];
  var hasHeaders = firstRow.some(function (v) { return v !== ''; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, BOOKMARK_SHEET_HEADERS.length).setValues([BOOKMARK_SHEET_HEADERS]);
    sheet.setFrozenRows(1);
  }
  Logger.log('Lese-Bookmark-Sync: Sheet-Tab "Bookmarks" eingerichtet.');
}

function getBookmarkSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOOKMARK_SHEET_NAME);
  if (!sheet) throw new Error('Sheet-Tab "Bookmarks" fehlt. Bitte zuerst setupBookmarkSync ausführen.');
  return sheet;
}

// 1-basierte Zeilennummer oder -1. Lineares Scannen reicht hier locker —
// selbst bei hunderten Zugangscodes x Büchern ist das Sheet klein genug,
// gleiches Muster wie findBookmarkRow_ in RevisionModule.gs.
function findBookmarkRow_(sheet, code, epubUrl) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === code && data[i][1] === epubUrl) return i + 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// KERNFUNKTIONEN
// ---------------------------------------------------------------------------

function getBookmark_(code, epubUrl) {
  code = (code || '').trim();
  epubUrl = (epubUrl || '').trim();
  if (!code || !epubUrl) return { ok: true, cfi: '' };
  var sheet = getBookmarkSheet_();
  var row = findBookmarkRow_(sheet, code, epubUrl);
  if (row === -1) return { ok: true, cfi: '' };
  var cfi = sheet.getRange(row, 3).getValue() || '';
  return { ok: true, cfi: String(cfi) };
}

function saveBookmark_(code, epubUrl, cfi) {
  code = (code || '').trim();
  epubUrl = (epubUrl || '').trim();
  cfi = (cfi || '').trim();
  if (!code || !epubUrl || !cfi) {
    return { ok: false, error: 'Fehlende Parameter (code, epubUrl, cfi erforderlich).' };
  }
  var sheet = getBookmarkSheet_();
  var row = findBookmarkRow_(sheet, code, epubUrl);
  var now = new Date().toISOString();
  if (row === -1) {
    sheet.appendRow([code, epubUrl, cfi, now]);
  } else {
    sheet.getRange(row, 3, 1, 2).setValues([[cfi, now]]);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// INTEGRATION IN handle(e) — gleiches Muster wie handleRevisionAction(e) in
// RevisionModule.gs, dort ausführlich erklärt und bestätigt (29.08.2026).
// doGet(e)/doPost(e) rufen beide handle(e) auf; jsonOut(obj) baut die
// JSON-Antwort im Muster {ok:true,...} bzw. {ok:false,error:...}.
// handleBookmarkAction(e) unten nutzt exakt dieses Antwortformat — kein
// eigener Mechanismus. Try/catch um den ganzen Zweig: ein Fehler kommt
// dadurch als sauberes {ok:false, error:"..."} zurück statt als rohe
// Server-Exception.
// ---------------------------------------------------------------------------

function handleBookmarkAction(e) {
  var BOOKMARK_ACTIONS = ['getBookmark', 'saveBookmark'];
  var p = e.parameter;
  if (BOOKMARK_ACTIONS.indexOf(p.action) === -1) return null; // nicht zuständig

  try {
    switch (p.action) {
      case 'getBookmark':
        return jsonOut(getBookmark_(p.code, p.epubUrl));
      case 'saveBookmark':
        return jsonOut(saveBookmark_(p.code, p.epubUrl, p.cfi));
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
  return null;
}

//
// Der einzige Eingriff in Code.gs bleibt diese eine Stelle, ganz am Anfang
// von handle(e) — direkt neben (oder anstelle von, falls schon vorhanden)
// der entsprechenden Zeile für handleRevisionAction, falls das
// Stil-Revisions-Modul (Abschnitt 15) bereits integriert ist:
//
//   function handle(e) {
//     const bookmarkResponse = handleBookmarkAction(e);
//     if (bookmarkResponse) return bookmarkResponse;
//     // ... ab hier dein bestehender Code unverändert (ggf. inkl. der
//     // bereits vorhandenen handleRevisionAction-Zeile) ...
//   }
