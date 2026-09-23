// Service Worker für die Autorenseite — macht die Seite installierbar
// (PWA) und erlaubt Offline-Zugriff auf bereits geöffnete EPUBs sowie auf
// die zuletzt geladene Bücher-/Gedichte-/Einstellungsliste.
//
// WICHTIG: nur reine Lese-Anfragen (getEpubData, getBooks, getPoems,
// getSettings, getBookmark) werden zwischengespeichert. Speichern/Ändern
// (saveBooks, addAccess, removeAccess, ...) läuft IMMER direkt über das
// Netzwerk und wird nie aus dem Cache beantwortet — sonst könnten
// Änderungen offline scheinbar "klappen", ohne wirklich anzukommen.
//
// Version im Cache-Namen erhöhen, wenn sich die zwischengespeicherten
// Dateien strukturell ändern (z.B. neue Kern-Dateien) — alte Caches werden
// beim activate-Event automatisch aufgeräumt.
//
// v1 -> v2 (14.09.2026): direkt nach dem ersten Deploy dieses Service
// Workers kam es bei einem Nutzer zu "JSON Parse error: Unterminated
// string" beim Laden der Seite — der Quellcode auf GitHub war zu diesem
// Zeitpunkt nachweislich valide (per json.loads geprüft), es handelte
// sich also um eine im Browser zwischengespeicherte kaputte/unvollständige
// Kopie (sehr wahrscheinlich durch die schnelle Folge mehrerer Deploys
// kurz hintereinander, während GitHub Pages noch am Propagieren war).
// Versionssprung erzwingt, dass jeder Browser seinen alten Cache verwirft
// und die Seite beim nächsten Laden komplett frisch vom Netz holt.
//
// v3 -> v4 (21.09.2026): audio-library.js traegt jetzt zusaetzlich den kleinen
// iOS-Safari-Kompatibilitaetslayer fuer den Inline-EPUB-Reader. Der Sprung auf
// v4 verhindert, dass iPhones die zuvor gecachte JS-Datei weiterverwenden.
//
// v22 -> v23 (23.09.2026): Frontend holt BooksData mit Cache-Buster + Retry;
// erzwingt die neue Lade-Logik auf bereits installierten iOS-PWAs.
// v21 -> v22 (23.09.2026): erzwingt nach dem Import von THE WEIGHT OF THE AIR
// einen frischen Bücher-/Shell-Stand und verwirft veraltete getBooks-Caches.
const SHELL_CACHE = 'ajk-shell-v23';
const DATA_CACHE = 'ajk-data-v23';
const SHELL_FILES = ['./', './index.html', './audio-library.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// Aktionen, deren Antwort für Offline-Nutzung zwischengespeichert werden
// darf. Alles andere (insbesondere alle schreibenden Aktionen) läuft immer
// nur direkt übers Netz.
const CACHEABLE_GET_ACTIONS = new Set(['getBooks', 'getPoems', 'getSettings']);
const CACHEABLE_POST_ACTIONS = new Set([]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// EPUB- und Bookmark-POSTs gehen bewusst direkt zum Apps-Script-Backend.
// Der frühere Offline-Cache für getEpubData/getBookmark wurde auf iOS zur
// zusätzlichen Fehlerquelle bei großen EPUB-Antworten. Schreibende POSTs
// waren ohnehin nie cachebar; aktuell werden daher alle POSTs direkt
// durchgereicht.
function synthKey(action, params) {
  const keep = ['epubUrl', 'bookTitle', 'code'];
  const qs = keep.map((k) => k + '=' + encodeURIComponent(params.get(k) || '')).join('&');
  return new Request('https://ajk-offline-cache.local/' + action + '?' + qs);
}


async function injectAudioLibrary_(response) {
  if (!response || !response.ok) return response;
  const type = response.headers.get('content-type') || '';
  if (type.indexOf('text/html') === -1) return response;
  const text = await response.text();
  if (text.indexOf('audio-library.js') !== -1) {
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const pos = text.lastIndexOf('</body>');
  const injected = pos >= 0
    ? text.slice(0, pos) + '  <script src="./audio-library.js" defer></script>\\n' + text.slice(pos)
    : text;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(injected, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Navigations-Requests (die Seite selbst): Netzwerk zuerst, damit
  // Änderungen sofort ankommen, sobald online — mit Fallback auf den
  // zuletzt gecachten Stand, wenn offline.
  if (req.method === 'GET' && req.mode === 'navigate') {
    event.respondWith(
      // no-store: umgeht jeden HTTP-Zwischencache (Browser/CDN), damit wir
      // nie eine unvollständige/veraltete Antwort in den Service-Worker-
      // Cache übernehmen (siehe Versionskommentar oben, v1 -> v2).
      fetch(req, { cache: 'no-store' })
        .then(async (res) => {
          const withAudio = await injectAudioLibrary_(res);
          if (withAudio && withAudio.ok) caches.open(SHELL_CACHE).then((c) => c.put('./index.html', withAudio.clone()));
          return withAudio;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (req.method === 'GET') {
    const action = url.searchParams.get('action');
    if (CACHEABLE_GET_ACTIONS.has(action)) {
      event.respondWith((async () => {
        try {
          const res = await fetch(req, { cache: 'no-store' });
          if (res && res.ok) {
            const cache = await caches.open(DATA_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          const cache = await caches.open(DATA_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          throw err;
        }
      })());
      return;
    }
    // Statische Shell-Dateien (Icons etc.): cache-first.
    if (SHELL_FILES.some((f) => req.url.endsWith(f.replace('./', '')))) {
      event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req))
      );
    }
    return;
  }

  if (req.method === 'POST') {
    event.respondWith((async () => {
      let params;
      try {
        const bodyText = await req.clone().text();
        params = new URLSearchParams(bodyText);
      } catch (err) {
        return fetch(req);
      }
      const action = params.get('action');

      // A bookmark is optional reader state, never a prerequisite for
      // opening the EPUB. If the live bookmark endpoint is unavailable or
      // returns {ok:false}, degrade to an empty bookmark so openReader can
      // continue with the successfully loaded EPUB.
      if (action === 'getBookmark') {
        try {
          const res = await fetch(req);
          if (!res || !res.ok) throw new Error('bookmark_http');
          const text = await res.clone().text();
          let data = null;
          try { data = JSON.parse(text); } catch (_) {}
          if (data && data.ok) return res;
        } catch (_) {}
        return new Response(JSON.stringify({ ok: true, cfi: '' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      if (!CACHEABLE_POST_ACTIONS.has(action)) {
        // Alle schreibenden/nicht zwischenspeicherbaren Aktionen: immer
        // direkt übers Netz, nie aus dem Cache.
        return fetch(req);
      }
      const key = synthKey(action, params);
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(DATA_CACHE);
          cache.put(key, res.clone());
        }
        return res;
      } catch (err) {
        const cache = await caches.open(DATA_CACHE);
        const cached = await cache.match(key);
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
