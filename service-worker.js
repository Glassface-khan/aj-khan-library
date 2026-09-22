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
const SHELL_CACHE = 'ajk-shell-v13';
const DATA_CACHE = 'ajk-data-v13';
const SHELL_FILES = ['./', './index.html', './audio-library.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// Aktionen, deren Antwort für Offline-Nutzung zwischengespeichert werden
// darf. Alles andere (insbesondere alle schreibenden Aktionen) läuft immer
// nur direkt übers Netz.
const CACHEABLE_GET_ACTIONS = new Set(['getBooks', 'getPoems', 'getSettings']);
const CACHEABLE_POST_ACTIONS = new Set(['getEpubData', 'getBookmark']);

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

// POST-Anfragen (getEpubData, getBookmark) werden über die Cache API nicht
// direkt als Schlüssel unterstützt (die matcht nur GET) — daher ein
// synthetischer GET-Request als Cache-Schlüssel, gebaut aus den relevanten
// Parametern (Aktion + betroffenes Buch), nicht aus dem kompletten Body
// (der enthält u.a. Admin-Token/Zugangscode, die sich ändern können, ohne
// dass sich am eigentlichen Inhalt etwas ändert).
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
          const res = await fetch(req);
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
