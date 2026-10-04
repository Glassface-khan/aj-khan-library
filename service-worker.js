// v56 -> v57 (04.10.2026): persist audiobook badges across grid rebuilds and harden Audio-Rechte taps on iOS.
// v55 -> v56 (03.10.2026): force fresh independent audiobook badges and Audio-Rechte handler on iOS.
// v54 -> v55 (03.10.2026): direct audiobook availability badges on covers.
// v53 -> v54 (03.10.2026): force fresh Audio-Rechte launcher/runtime on iOS.
// v52 -> v53 (03.10.2026): force fresh audiobook/cover-grid runtime so headphone badges and multi-voice UI appear on iOS.
// v51 -> v52 (02.10.2026): force all clients onto same-origin cover assets after complete Drive-cover migration.
// v50 -> v51 (02.10.2026): refresh cover-grid after legacy Drive cover delivery repair.
// v49 -> v50 (29.09.2026): Safari/WebKit hardening — no-store HTML, pageshow/visibility
// service-worker refresh, versioned registration and immediate waiting-worker activation.
// v48 -> v49 (29.09.2026): harden Chrome/iOS service-worker updates; resilient precache,
// navigation preload, guaranteed navigation fallback, explicit skip-waiting message support.
// v43 -> v44 (28.09.2026): switch thumbnail view to a new
// cover-grid-v2.js URL so iOS cannot reuse the stale duplicate-producing runtime.
// v40 -> v41 (28.09.2026): merge live BooksData with books-live.json so a newly deployed title cannot be hidden by backend lag.
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
// v25 -> v26 (23.09.2026): force the validated paginated EPUB rendering mode\n// on desktop as well as iOS to prevent blank reader viewports.\n// v23 -> v25 (23.09.2026): current three-book catalog is a safe local fallback;
// getBooks itself is never served from the service-worker data cache.
// v33 -> v34 (28.09.2026): refresh cover-grid.js with reader-selectable 1-6 covers per row.\n// v32 -> v33 (27.09.2026): refresh the shell/catalog after replacing the temporary cover with the author-approved final cover.\n// v31 -> v32 (27.09.2026): refresh the shell/catalog fallback after adding DIE FRAU, DIE DAS MEER AUSWENDIG KANNTE.\n// v28 -> v29 (25.09.2026): EPUB loader retries transient mobile/5G failures and falls back to a previously authorised local copy.\n// v36 -> v37 (28.09.2026): force fresh cover-grid/index after switching
// the thumbnail view to canonical books-live order and cover URLs.
// v35 -> v36 (28.09.2026): force iOS/PWA to drop the stale cover-grid
// shell after the duplicate/order and mobile jump-list repairs.
// v27 -> v28 (24.09.2026): audio-library.js now keeps permission-checked EPUB
// payloads in IndexedDB for fast reopening; force clients to fetch the new JS.
// v26 -> v27 (24.09.2026): books-live.json is the immediate catalog fallback;
// BooksData remains canonical and replaces it whenever the live request succeeds.
// v37 -> v38 (28.09.2026): force iOS to reload the exact-order cover grid.\n// v39 -> v40 (28.09.2026): deploy THE GUEST catalog entry, cover and EPUB; force clients to refresh the catalog fallback.\n// v40 -> v41 (28.09.2026): deploy THE NIGHT SIDE catalog entry, cover and EPUB; force clients to refresh the catalog fallback.\nconst SHELL_CACHE = 'ajk-shell-v60';
const DATA_CACHE = 'ajk-data-v60';
const SHELL_FILES = ['./', './index.html', './books-live.json', './cover-grid-v3.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// Aktionen, deren Antwort für Offline-Nutzung zwischengespeichert werden
// darf. Alles andere (insbesondere alle schreibenden Aktionen) läuft immer
// nur direkt übers Netz.
const CACHEABLE_GET_ACTIONS = new Set(['getPoems', 'getSettings']);
const CACHEABLE_POST_ACTIONS = new Set([]);

async function precacheShell_() {
  const cache = await caches.open(SHELL_CACHE);
  // Never let one temporarily unavailable asset abort installation of the
  // whole worker. This was a likely cause of browsers keeping an older worker.
  await Promise.allSettled(SHELL_FILES.map(async (path) => {
    try {
      const req = new Request(path, { cache: 'reload' });
      const res = await fetch(req);
      if (res && res.ok) await cache.put(path, res.clone());
    } catch (_) {}
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell_().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  let text = await response.text();
  const pos = text.lastIndexOf('</body>');

  if (pos >= 0 && text.indexOf('audio-library.js') === -1) {
    text = text.slice(0, pos) + '  <script src="./audio-library.js?v=20261004d" defer></script>\\n' + text.slice(pos);
  }

  // Safari/WebKit can restore a page from the back-forward cache while keeping
  // an older service-worker controller. Refresh the registration when Safari
  // returns to the page and activate a waiting worker immediately. The script
  // is intentionally tiny and Safari-only.
  if (text.indexOf('id="ajk-safari-sw-refresh"') === -1) {
    const safariScript = `<script id="ajk-safari-sw-refresh">
(function () {
  var ua = navigator.userAgent || '';
  var isSafari = /Safari/i.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Edg)/i.test(ua);
  if (!isSafari || !('serviceWorker' in navigator)) return;

  var lastCheck = 0;
  function refreshWorker() {
    var now = Date.now();
    if (now - lastCheck < 30000) return;
    lastCheck = now;

    navigator.serviceWorker.register('./service-worker.js?v=60', {
      scope: './',
      updateViaCache: 'none'
    }).then(function (reg) {
      if (reg.waiting) {
        try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
      }
      try { reg.update(); } catch (e) {}
    }).catch(function () {});
  }

  window.addEventListener('pageshow', function (event) {
    if (event.persisted) refreshWorker();
    else setTimeout(refreshWorker, 1200);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshWorker();
  });
})();
</script>`;
    const end = text.lastIndexOf('</body>');
    if (end >= 0) text = text.slice(0, end) + safariScript + '\\n' + text.slice(end);
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  // Prevent Safari from reusing stale HTML after a deploy. The service-worker
  // shell cache still provides offline fallback when the network is unavailable.
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  return new Response(text, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Navigations-Requests (die Seite selbst): Netzwerk zuerst, damit
  // Änderungen sofort ankommen, sobald online — mit Fallback auf den
  // zuletzt gecachten Stand, wenn offline.
  if (req.method === 'GET' && req.mode === 'navigate') {
    event.respondWith((async () => {
      // Prefer navigation preload/network. If Chrome/iOS has a transient
      // network failure, ALWAYS return a real Response from the newest shell
      // cache instead of allowing the fetch handler itself to reject with
      // ERR_FAILED.
      try {
        const preload = await event.preloadResponse;
        if (preload && preload.ok) {
          const withAudio = await injectAudioLibrary_(preload);
          if (withAudio && withAudio.ok) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put('./index.html', withAudio.clone());
          }
          return withAudio;
        }
      } catch (_) {}

      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res && res.ok) {
          const withAudio = await injectAudioLibrary_(res);
          const cache = await caches.open(SHELL_CACHE);
          await cache.put('./index.html', withAudio.clone());
          return withAudio;
        }
      } catch (_) {}

      const shell = await caches.open(SHELL_CACHE);
      const cached =
        await shell.match('./index.html') ||
        await caches.match('./index.html') ||
        await shell.match('./') ||
        await caches.match('./');
      if (cached) return cached;

      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A. J. Khan</title><body style="font-family:system-ui;padding:2rem">Die Seite konnte gerade nicht geladen werden. Bitte erneut versuchen.</body>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
      );
    })());
    return;
  }

  if (req.method === 'GET') {
    // The public catalogue has two sources: Apps Script/BooksData and the
    // deploy-coupled books-live.json fallback. A just-published book can be
    // present in GitHub/Drive a few moments before the Apps-Script deployment
    // catches up. Merge both here so the live backend can never hide a newer
    // deployed catalogue entry.
    if (url.searchParams.get('action') === 'getBooks') {
      event.respondWith((async () => {
        let liveBooks = [];
        let fallbackBooks = [];

        try {
          const liveRes = await fetch(req, { cache: 'no-store' });
          if (liveRes && liveRes.ok) {
            const liveData = await liveRes.clone().json();
            const raw = liveData && liveData.books;
            const parsed = (typeof raw === 'string') ? JSON.parse(raw || '[]') : raw;
            if (Array.isArray(parsed)) liveBooks = parsed;
          }
        } catch (_) {}

        try {
          const fallbackUrl = new URL('./books-live.json?sw-catalog=20261002c', self.registration.scope);
          const fallbackRes = await fetch(fallbackUrl, { cache: 'no-store' });
          if (fallbackRes && fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            const raw = fallbackData && fallbackData.books;
            const parsed = (typeof raw === 'string') ? JSON.parse(raw || '[]') : raw;
            if (Array.isArray(parsed)) fallbackBooks = parsed;
          }
        } catch (_) {}

        const merged = liveBooks.slice();
        const seen = new Set(merged.map((b) => String((b && b.title) || '').trim().toLocaleLowerCase()));
        fallbackBooks.forEach((b) => {
          const key = String((b && b.title) || '').trim().toLocaleLowerCase();
          if (key && !seen.has(key)) {
            merged.push(b);
            seen.add(key);
          }
        });

        if (!merged.length) {
          return fetch(req, { cache: 'no-store' });
        }
        return new Response(JSON.stringify({ ok: true, books: JSON.stringify(merged) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      })());
      return;
    }

    // Cover-grid runtimes must never come from a stale service-worker shell.
    // We now keep both filenames compatible, but always fetch the active code
    // fresh so an older cached index cannot resurrect the duplicate thumbnail bug.
    if (url.pathname.endsWith('/cover-grid.js') || url.pathname.endsWith('/cover-grid-v2.js')) {
      event.respondWith(fetch(req, { cache: 'no-store' }));
      return;
    }

    // Reader compatibility code must never come from a stale shell/browser
    // cache. This is deliberately network-only after the 25.09.2026 iOS
    // rollback: an old audio-library.js can otherwise keep the removed global
    // fetch wrapper alive even though GitHub already serves the corrected file.
    if (url.pathname.endsWith('/audio-library.js')) {
      event.respondWith(fetch(req, { cache: 'no-store' }));
      return;
    }

    // Safari/iOS kept serving an older cover-grid runtime even after GitHub
    // deploys and cache-version bumps. Always fetch every cover-grid runtime
    // from the network so thumbnail order/identity fixes take effect immediately.
    if (/\/cover-grid(?:-v[23])?\.js$/.test(url.pathname)) {
      event.respondWith(fetch(req, { cache: 'no-store' }));
      return;
    }
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
