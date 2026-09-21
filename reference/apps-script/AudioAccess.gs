/**
 * AudioAccess.gs
 *
 * Additives Modul fuer die bestehende Autorenseite.
 * - Bestehende Nutzer/Zugangscodes im Access-Sheet bleiben Source of Truth.
 * - Spalte H: AudioAccess (JSON pro Buchtitel)
 * - Spalte I: ListenerId (stabile UUID fuer geraeteuebergreifenden Hoerfortschritt)
 *
 * Erwartete Einbindung in Code.gs, ganz am Anfang von handle(e):
 *
 *   const audioResponse = handleAudioAccessAction(e);
 *   if (audioResponse) return audioResponse;
 *
 * Danach Apps Script als "New version" neu deployen.
 */

const AUDIO_ACCESS_COL = 8;
const AUDIO_LISTENER_ID_COL = 9;

function parseAudioAccess_(cellValue) {
  const raw = String(cellValue || '').trim();
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    Object.keys(obj).forEach(function(title) {
      const value = obj[title];
      if (value === true) out[title] = true;
      else if (value && typeof value === 'object' && value.listen === true) out[title] = true;
    });
    return out;
  } catch (err) {
    return {};
  }
}

function ensureAudioAccessColumns_(sheet) {
  if (!sheet) return;
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Name', 'Code', 'CanDownload', 'CanCopy',
      'VisibleBooks', 'ShowPoems', 'EpubAccess',
      'AudioAccess', 'ListenerId'
    ]);
    return;
  }
  if (!sheet.getRange(1, AUDIO_ACCESS_COL).getValue()) {
    sheet.getRange(1, AUDIO_ACCESS_COL).setValue('AudioAccess');
  }
  if (!sheet.getRange(1, AUDIO_LISTENER_ID_COL).getValue()) {
    sheet.getRange(1, AUDIO_LISTENER_ID_COL).setValue('ListenerId');
  }
}

function getOrCreateListenerIdForRow_(sheet, rowNumber) {
  let id = String(sheet.getRange(rowNumber, AUDIO_LISTENER_ID_COL).getValue() || '').trim();
  if (!id) {
    id = Utilities.getUuid();
    sheet.getRange(rowNumber, AUDIO_LISTENER_ID_COL).setValue(id);
  }
  return id;
}

function getOrCreateAdminAudioListenerId_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('audio_admin_listener_id');
  if (!id) {
    id = Utilities.getUuid();
    props.setProperty('audio_admin_listener_id', id);
  }
  return id;
}

function audioTitleVisible_(visibleBooks, title) {
  if (!title) return true;
  if (visibleBooks === null) return true;
  return Array.isArray(visibleBooks) && visibleBooks.indexOf(title) >= 0;
}

function filteredAudioAccess_(audioAccess, visibleBooks) {
  const out = {};
  Object.keys(audioAccess || {}).forEach(function(title) {
    if (audioAccess[title] === true && audioTitleVisible_(visibleBooks, title)) out[title] = true;
  });
  return out;
}

function handleAudioAccessAction(e) {
  if (!e || !e.parameter) return null;
  const action = String(e.parameter.action || '').trim();
  if (['checkAudioAccess', 'getAudioAccessList', 'setAudioAccess'].indexOf(action) === -1) {
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const accessSheet = ss.getSheetByName('Access') || ss.insertSheet('Access');
  ensureAudioAccessColumns_(accessSheet);

  if (action === 'checkAudioAccess') {
    const requestedTitle = String(e.parameter.bookTitle || '').trim();

    // Admin darf alle vorhandenen Audio-Ausgaben hoeren.
    if (checkAdmin(e).ok) {
      return jsonOut({
        ok: true,
        isAdmin: true,
        name: 'Admin',
        listenerId: getOrCreateAdminAudioListenerId_(),
        fullAudioAccess: true,
        allowed: true,
        audioAccess: {}
      });
    }

    const code = String(e.parameter.code || '').trim();
    if (!code || accessSheet.getLastRow() < 2) return jsonOut({ ok: false });

    const rows = accessSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1] || '').trim() !== code) continue;

      const rowNumber = i + 1;
      const visibleBooks = parseVisibleBooks_(rows[i][4]);
      const audioAccess = filteredAudioAccess_(parseAudioAccess_(rows[i][7]), visibleBooks);
      const listenerId = getOrCreateListenerIdForRow_(accessSheet, rowNumber);
      const allowed = requestedTitle ? !!audioAccess[requestedTitle] : true;

      return jsonOut({
        ok: true,
        isAdmin: false,
        name: rows[i][0] || '',
        listenerId: listenerId,
        fullAudioAccess: false,
        allowed: allowed,
        audioAccess: audioAccess
      });
    }

    return jsonOut({ ok: false });
  }

  if (action === 'getAudioAccessList') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized' });

    if (accessSheet.getLastRow() < 2) return jsonOut({ ok: true, people: [] });

    const rows = accessSheet.getDataRange().getValues();
    const people = rows.slice(1).filter(function(r) {
      return String(r[1] || '').trim();
    }).map(function(r) {
      const visibleBooks = parseVisibleBooks_(r[4]);
      return {
        name: r[0] || '',
        code: String(r[1] || '').trim(),
        audioAccess: filteredAudioAccess_(parseAudioAccess_(r[7]), visibleBooks)
      };
    });

    return jsonOut({ ok: true, people: people });
  }

  if (action === 'setAudioAccess') {
    const admin = checkAdmin(e);
    if (!admin.ok) return jsonOut({ ok: false, error: 'unauthorized' });

    const code = String(e.parameter.code || '').trim();
    if (!code) return jsonOut({ ok: false, error: 'Kein Zugangscode angegeben.' });

    let requested = {};
    try {
      requested = parseAudioAccess_(e.parameter.audioAccess || '{}');
    } catch (err) {
      return jsonOut({ ok: false, error: 'Ungueltiges AudioAccess-JSON.' });
    }

    const rows = accessSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1] || '').trim() !== code) continue;

      // Audio darf nur fuer Buecher aktiviert werden, die dieser Zugang
      // auf der Autorenseite grundsaetzlich sehen darf.
      const visibleBooks = parseVisibleBooks_(rows[i][4]);
      const normalized = filteredAudioAccess_(requested, visibleBooks);
      accessSheet.getRange(i + 1, AUDIO_ACCESS_COL).setValue(JSON.stringify(normalized));

      // ListenerId schon jetzt stabil anlegen, damit spaeter kein Code
      // selbst in Supabase gespeichert werden muss.
      getOrCreateListenerIdForRow_(accessSheet, i + 1);

      return jsonOut({ ok: true, audioAccess: normalized });
    }

    return jsonOut({ ok: false, error: 'Zugangscode nicht gefunden.' });
  }

  return null;
}
