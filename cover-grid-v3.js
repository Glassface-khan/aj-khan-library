(function () {
  'use strict';

  var GRID_ID = 'ajk-cover-grid';
  var TOGGLE_ATTR = 'data-ajk-cover-grid-toggle';
  var MODAL_ID = 'ajk-cover-detail-modal';
  var COLS_ID = 'ajk-cover-grid-columns';
  var active = false;
  var columnCount = 3;
  var observer = null;
  var scheduled = false;
  var canonicalCatalog_ = [];
  var canonicalCatalogLoaded_ = false;
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbwcbRDaWkM1wf3MV_dj4RPw9jQl2Fgc4YfGcmFrGU1S243yvh8WGW7mbyXLbSeVJKI/exec';
  var dragState_ = null;
  var suppressCoverClickUntil_ = 0;
  var searchTimer_ = null;
  var SEARCH_SCOPE_ID = 'ajk-book-search-scope';
  var ADMIN_ORDER_KEY = 'ajk_cover_admin_order_v1';
  // Per-book edition choice for the cover-detail modal. The native book card
  // already supports book.langs; this mirrors that selector in Covers view.
  var detailLangChoice_ = {};

  function isAdmin_() {
    try { return localStorage.getItem('ajk_author_admin') === '1' && !!localStorage.getItem('ajk_admin_token'); }
    catch (_) { return false; }
  }
  function adminToken_() {
    try { return localStorage.getItem('ajk_admin_token') || ''; }
    catch (_) { return ''; }
  }

  function normTitle_(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }

  // Stable same-origin cover assets take precedence over legacy Drive image URLs.
  // For titles not yet migrated, convert the old lh3 /d/<id> form to Drive's
  // thumbnail endpoint, which is more reliable on mobile Safari.
  var STATIC_COVER_BY_TITLE_ = {
    "the mountain that doesn't answer": "assets/covers/the-mountain-that-doesnt-answer.jpg",
    "the weight of the air": "assets/covers/the-weight-of-the-air.jpg",
    "the second ledger": "assets/covers/the-second-ledger.jpg",
    "the pen was still warm": "assets/covers/the-pen-was-still-warm.jpg",
    "the book of seven thieves": "assets/covers/the-book-of-seven-thieves.jpg",
    "the physician of ashes": "assets/covers/the-physician-of-ashes.png",
    "the blue hour": "assets/covers/the-blue-hour.jpg",
    "the low wall": "assets/covers/the-low-wall.jpg",
    "die rückführung": "assets/covers/die-rueckfuehrung.jpg",
    "the erasure broker": "assets/covers/the-erasure-broker.jpg",
    "the treasury of unanswered prayers": "assets/covers/the-treasury-of-unanswered-prayers.jpg",
    "begin with water": "assets/covers/begin-with-water.jpg",
    "the niche of light": "assets/covers/the-niche-of-light.jpg",
    "die form des lichts": "assets/covers/die-form-des-lichts.jpg",
    "what the clockmaker kept": "assets/covers/what-the-clockmaker-kept.jpg",
    "what the ash remembers": "assets/covers/what-the-ash-remembers.jpg",
    "the lamp keeper": "assets/covers/the-lamp-keeper.jpg",
    "the drop": "assets/covers/the-drop.jpg",
    "written in water": "assets/covers/written-in-water.jpg",
    "the proof": "assets/covers/the-proof.jpg",
    "arche": "assets/covers/arche.jpg",
    "the glass ladder": "assets/covers/the-glass-ladder.jpg",
    "the missing cover": "assets/covers/the-missing-cover.jpg",
    "the covenant of light — the forgetting": "assets/covers/the-covenant-of-light-the-forgetting.jpg",
    "the ledger of the dead": "assets/covers/the-ledger-of-the-dead.png"
  };

  function coverSrc_(title, url) {
    var local = STATIC_COVER_BY_TITLE_[normTitle_(title)];
    if (local) return local;
    var value = String(url || '').trim();
    var m = value.match(/^https:\/\/lh3\.googleusercontent\.com\/d\/([^=/?]+)=w\d+$/i);
    if (m) return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(m[1]) + '&sz=w1000';
    return value;
  }

  function orderKey_(item) {
    if (!item) return '';
    var id = String(item.id || '').trim();
    if (id) return 'id:' + id;
    var title = normTitle_(item.title);
    return title ? 't:' + title : '';
  }

  function readAdminOrder_() {
    if (!isAdmin_()) return [];
    try {
      var raw = JSON.parse(localStorage.getItem(ADMIN_ORDER_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(function (x) { return x && (x.id || x.title); }) : [];
    } catch (_) {
      return [];
    }
  }

  function writeAdminOrder_(order) {
    if (!isAdmin_() || !Array.isArray(order) || !order.length) return;
    try { localStorage.setItem(ADMIN_ORDER_KEY, JSON.stringify(order)); } catch (_) {}
  }

  function applyOrder_(books, order) {
    if (!Array.isArray(books) || !books.length || !Array.isArray(order) || !order.length) return books || [];
    var rank = {};
    order.forEach(function (item, i) {
      var key = orderKey_(item);
      if (key) rank[key] = i;
      if (item && item.title) rank['t:' + normTitle_(item.title)] = i;
    });
    return books.map(function (book, i) { return { book: book, original: i }; }).sort(function (a, b) {
      var ka = orderKey_(a.book);
      var kb = orderKey_(b.book);
      var ra = Object.prototype.hasOwnProperty.call(rank, ka) ? rank[ka] :
        (a.book && a.book.title && Object.prototype.hasOwnProperty.call(rank, 't:' + normTitle_(a.book.title))
          ? rank['t:' + normTitle_(a.book.title)] : Number.MAX_SAFE_INTEGER);
      var rb = Object.prototype.hasOwnProperty.call(rank, kb) ? rank[kb] :
        (b.book && b.book.title && Object.prototype.hasOwnProperty.call(rank, 't:' + normTitle_(b.book.title))
          ? rank['t:' + normTitle_(b.book.title)] : Number.MAX_SAFE_INTEGER);
      if (ra !== rb) return ra - rb;
      return a.original - b.original;
    }).map(function (x) { return x.book; });
  }

  function sameOrder_(books, order) {
    if (!Array.isArray(books) || !Array.isArray(order) || !order.length) return false;
    var normalizedBooks = books.map(function (b) { return orderKey_(b) || ('t:' + normTitle_(b && b.title)); });
    var normalizedOrder = order.map(function (b) { return orderKey_(b) || ('t:' + normTitle_(b && b.title)); });
    if (normalizedBooks.length !== normalizedOrder.length) return false;
    for (var i = 0; i < normalizedBooks.length; i++) {
      if (normalizedBooks[i] !== normalizedOrder[i]) return false;
    }
    return true;
  }

  async function loadCanonicalCatalog_() {
    var liveBooks = [];
    var fallbackBooks = [];

    // Load the same-origin catalogue FIRST. Safari Private Browsing can leave
    // the cross-origin Apps Script request pending for a long time. Waiting on
    // that request before reading books-live.json caused Covers mode to hide
    // the native list while the replacement grid still contained zero books.
    try {
      var fallbackRes = await fetch('./books-live.json?cover-order=20261002c', { cache: 'no-store' });
      if (fallbackRes && fallbackRes.ok) {
        var fallbackPayload = await fallbackRes.json();
        var fallbackRaw = fallbackPayload && fallbackPayload.books;
        if (typeof fallbackRaw === 'string') fallbackRaw = JSON.parse(fallbackRaw || '[]');
        if (Array.isArray(fallbackRaw)) fallbackBooks = fallbackRaw.filter(function (b) { return b && b.title; });
        if (isAdmin_()) fallbackBooks = applyOrder_(fallbackBooks, readAdminOrder_());
      }
    } catch (_) {}

    // Publish the deploy-coupled catalogue immediately so the cover grid can
    // never remain blank while the live backend is slow or blocked.
    if (fallbackBooks.length) {
      canonicalCatalog_ = fallbackBooks.slice();
      canonicalCatalogLoaded_ = true;
      try { refreshGridAfterCatalog_(); } catch (_) {}
    }

    // The same-origin fallback is already visible at this point, so there is
    // no reason to abandon the live order after 2.5 seconds. On mobile the Apps
    // Script endpoint can legitimately take longer; cancelling it made a saved
    // admin order appear to "revert" permanently to books-live.json.
    try {
      var liveRes = await fetch(GAS_URL + '?action=getBooks&cb=' + Date.now(), { cache: 'no-store' });
      if (liveRes && liveRes.ok) {
        var livePayload = await liveRes.json();
        var liveRaw = livePayload && livePayload.books;
        if (typeof liveRaw === 'string') liveRaw = JSON.parse(liveRaw || '[]');
        if (Array.isArray(liveRaw)) liveBooks = liveRaw.filter(function (b) { return b && b.title; });
      }
    } catch (_) {}

    // The live BooksData order wins when available. The verified fallback
    // continues to own cover bindings and fills any temporarily missing titles.
    var merged = [];
    var seen = {};
    var fallbackByTitle = {};
    fallbackBooks.forEach(function (b) {
      var key = normTitle_(b.title);
      if (key && !fallbackByTitle[key]) fallbackByTitle[key] = b;
    });

    if (liveBooks.length) {
      liveBooks.forEach(function (live) {
        var key = normTitle_(live.title);
        if (!key || seen[key]) return;
        seen[key] = true;
        var fallback = fallbackByTitle[key] || {};
        var entry = Object.assign({}, fallback, live);
        if (fallback.coverUrl) entry.coverUrl = fallback.coverUrl;
        merged.push(entry);
      });
      fallbackBooks.forEach(function (b) {
        var key = normTitle_(b.title);
        if (!key || seen[key]) return;
        seen[key] = true;
        merged.push(b);
      });
    } else {
      merged = fallbackBooks.slice();
    }

    if (merged.length) canonicalCatalog_ = merged;
    canonicalCatalogLoaded_ = true;
    return canonicalCatalog_;
  }

  function lang() {
    try { return (localStorage.getItem('ajk_ui_lang') || 'de').toLowerCase(); }
    catch (_) { return 'de'; }
  }
  function t(de, en) { return lang() === 'en' ? en : de; }
  function listWrap() { return document.querySelector('.book-list-wrap'); }

  function injectStyles() {
    if (document.getElementById('ajk-cover-grid-style')) return;
    var style = document.createElement('style');
    style.id = 'ajk-cover-grid-style';
    style.textContent =
      '#' + GRID_ID + '{display:none;grid-template-columns:repeat(var(--ajk-cover-cols,3),minmax(0,1fr));gap:24px 18px;padding:28px 0 44px;align-items:start}' +
      '#' + GRID_ID + '.is-open{display:grid}' +
      '#books.ajk-cover-mode .book-list-wrap{display:none!important}' +
      '#books.ajk-cover-mode .book-card{display:none!important}' +
      '.ajk-cover-thumb{appearance:none;border:0;background:none;padding:0;cursor:pointer;min-width:0;text-align:left}' +
      '.ajk-cover-frame{display:block;position:relative;width:100%;aspect-ratio:2/3;overflow:hidden;background:var(--bone-deep,#e9e3d7);border:1px solid var(--rule,#cfc6b5);box-shadow:0 8px 22px rgba(0,0,0,.10);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}' +
      '.ajk-cover-audio-badge{position:absolute;right:7px;top:7px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(70,70,70,.54);color:rgba(255,255,255,.92);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);box-shadow:0 2px 8px rgba(0,0,0,.16);pointer-events:none}' +
      '.ajk-cover-audio-badge svg{width:15px;height:15px;display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
      '.ajk-cover-thumb:hover .ajk-cover-frame,.ajk-cover-thumb:focus-visible .ajk-cover-frame{transform:translateY(-4px);border-color:var(--gold,#b89448);box-shadow:0 14px 30px rgba(0,0,0,.16)}' +
      '.ajk-cover-frame img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.ajk-cover-placeholder{height:100%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:12px;font-family:"Cormorant Garamond",serif;font-size:15px;line-height:1.15;color:var(--ink-2,#555);text-align:center}' +
      '[' + TOGGLE_ATTR + ']{white-space:nowrap;background:none;border:1px solid var(--rule);color:var(--ink-2);font-family:"Archivo",sans-serif;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;cursor:pointer;margin:0 0 14px}' +
      '[' + TOGGLE_ATTR + '][aria-pressed="true"]{border-color:var(--gold);color:var(--gold);background:rgba(212,175,55,.07)}' +
      '#'+COLS_ID+'{display:none;align-items:center;gap:7px;margin:0 0 14px 10px;vertical-align:top}' +
      '#'+COLS_ID+'.is-open{display:inline-flex}' +
      '#'+COLS_ID+' .ajk-cover-cols-label{font-family:"Archivo",sans-serif;font-size:9.5px;letter-spacing:.10em;text-transform:uppercase;color:var(--ink-3,#777);margin-right:2px}' +
      '#'+COLS_ID+' button{appearance:none;width:30px;height:34px;padding:0;border:1px solid var(--rule,#cfc6b5);background:transparent;color:var(--ink-2,#555);font-family:"Archivo",sans-serif;font-size:11px;cursor:pointer}' +
      '#'+COLS_ID+' button[aria-pressed="true"]{border-color:var(--gold,#b89448);color:var(--gold,#b89448);background:rgba(212,175,55,.08)}' +
      '#'+COLS_ID+' .ajk-cover-cols-select{display:none;appearance:auto;min-width:86px;height:44px;padding:0 12px;border:1px solid var(--gold,#b89448);background:var(--bone,#f5f0e6);color:var(--ink,#2b2924);font-family:"Archivo",sans-serif;font-size:16px;line-height:44px}' +
      '#'+MODAL_ID+'{position:fixed;inset:0;z-index:80;background:rgba(22,20,15,.88);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}' +
      '#'+MODAL_ID+' .ajk-cover-detail{width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--bone,#f5f0e6);padding:24px;box-sizing:border-box;box-shadow:0 24px 70px rgba(0,0,0,.35)}' +
      '#'+MODAL_ID+' .ajk-cover-detail-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}' +
      '#'+MODAL_ID+' .ajk-cover-detail-body{display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr);gap:26px;align-items:start}' +
      '#'+MODAL_ID+' .ajk-cover-detail-img{width:100%;aspect-ratio:2/3;object-fit:cover;border:1px solid var(--rule);display:block}' +
      '#'+MODAL_ID+' .ajk-cover-detail-title{font-family:"Cormorant Garamond",serif;font-weight:400;font-size:clamp(30px,5vw,46px);line-height:1.05;margin:0 0 12px;color:var(--ink)}' +
      '#'+MODAL_ID+' .ajk-cover-detail-meta{font-family:"Archivo",sans-serif;font-size:10.5px;letter-spacing:.08em;color:var(--ink-3);margin:0 0 12px}' +
      '#'+MODAL_ID+' .ajk-cover-detail-langs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}' +
      '#'+MODAL_ID+' .ajk-cover-detail-lang{appearance:none;background:transparent;border:1px solid var(--rule,#cfc6b5);color:var(--ink-2,#555);font-family:"Archivo",sans-serif;font-size:10.5px;letter-spacing:.10em;text-transform:uppercase;padding:8px 12px;cursor:pointer}' +
      '#'+MODAL_ID+' .ajk-cover-detail-lang[aria-pressed="true"]{border-color:var(--gold,#b89448);color:var(--gold,#b89448);background:rgba(212,175,55,.08)}' +
      '#'+MODAL_ID+' .ajk-cover-detail-hook{color:var(--ink-2);font-size:17px;line-height:1.62;white-space:pre-wrap;margin:0 0 18px}' +
      '#'+MODAL_ID+' .ajk-cover-detail-actions{display:flex;flex-wrap:wrap;gap:10px}' +
      '#'+MODAL_ID+' .ajk-cover-detail-action,#'+MODAL_ID+' .ajk-cover-detail-close{background:none;border:1px solid var(--gold);color:var(--gold);font-family:"Archivo",sans-serif;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;padding:9px 14px;cursor:pointer}' +
      '#'+MODAL_ID+' .ajk-cover-detail-close{border-color:var(--rule);color:var(--ink-2)}' +
      '.book-toc-panel{border-radius:22px!important;background:rgba(245,240,230,.985)!important;overflow-y:auto!important;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;transform:translateY(-8px) scale(.985)!important;transition:opacity .25s ease,transform .25s ease,box-shadow .25s ease!important;box-shadow:0 24px 70px rgba(36,31,23,.18)!important}' +
      '.book-toc-panel.book-toc-open{transform:translateY(0) scale(1)!important;box-shadow:0 30px 86px rgba(36,31,23,.28),0 0 0 100vmax rgba(28,24,18,.14)!important}' +
      '.book-toc-panel::before,.book-toc-panel::after{content:"";display:block;position:sticky;left:0;right:0;height:34px;z-index:3;pointer-events:none;margin-left:-14px;margin-right:-14px}' +
      '.book-toc-panel::before{top:0;margin-top:-6px;margin-bottom:-34px;background:linear-gradient(to bottom,rgba(245,240,230,1) 0%,rgba(245,240,230,.94) 38%,rgba(245,240,230,0) 100%)}' +
      '.book-toc-panel::after{bottom:0;margin-top:-34px;margin-bottom:-6px;background:linear-gradient(to top,rgba(245,240,230,1) 0%,rgba(245,240,230,.94) 38%,rgba(245,240,230,0) 100%)}' +
      '#'+GRID_ID+'.ajk-admin-reorder .ajk-cover-thumb{position:relative}' +
      '.ajk-cover-drag-handle{display:none;position:absolute;right:7px;top:7px;z-index:5;width:36px;height:36px;border-radius:18px;background:rgba(32,28,22,.82);color:#fff;align-items:center;justify-content:center;font-family:"Archivo",sans-serif;font-size:18px;line-height:1;box-shadow:0 3px 12px rgba(0,0,0,.24);touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}' +
      '#'+GRID_ID+'.ajk-admin-reorder .ajk-cover-drag-handle{display:flex}' +
      '.ajk-cover-thumb.is-dragging{z-index:6;opacity:.24}' +
      '.ajk-cover-thumb.is-dragging .ajk-cover-frame{border-color:var(--gold,#b89448);box-shadow:0 18px 38px rgba(0,0,0,.25)}' +
      '.ajk-cover-drag-ghost{position:fixed!important;z-index:9999!important;pointer-events:none!important;margin:0!important;opacity:.94!important;transform:none!important;transition:none!important;filter:drop-shadow(0 16px 22px rgba(0,0,0,.24))}' +
      '.ajk-cover-drag-ghost .ajk-cover-drag-handle{display:none!important}' +
      '.ajk-search-hidden,.ajk-search-slot-hidden{display:none!important}' +
      '#books.ajk-search-active{min-height:0!important;height:auto!important;padding-bottom:0!important}' +
      '#books .book-list-wrap.ajk-search-active{min-height:0!important;height:auto!important;padding-bottom:0!important;margin-bottom:0!important}' +
      '#books.ajk-search-active .ajk-search-slot-visible{min-height:0!important;height:auto!important;padding-bottom:0!important;margin-bottom:24px!important}' +
      '#books.ajk-search-active .book-list-wrap [id^="book-card-"]:not(.ajk-search-hidden){min-height:0!important;height:auto!important;margin-bottom:0!important;padding-bottom:0!important}' +
      '.ajk-book-search-cell{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:8px!important;align-items:center!important}' +
      '.ajk-book-search-cell input[type=search]{min-width:0!important;width:100%!important}' +
      '#'+SEARCH_SCOPE_ID+'{height:44px;min-width:96px;padding:0 10px;border:1px solid var(--rule,#cfc6b5);background:var(--bone,#f5f0e6);color:var(--ink,#2b2924);font-family:"Archivo",sans-serif;font-size:11px;letter-spacing:.03em}' +
      '#ajk-cover-order-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:180;background:rgba(38,33,25,.94);color:#fff;padding:10px 15px;border-radius:18px;font-family:"Archivo",sans-serif;font-size:11px;letter-spacing:.04em;box-shadow:0 10px 30px rgba(0,0,0,.22);pointer-events:none}' +
      '@media(max-width:640px){.ajk-book-tools{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px!important;align-items:stretch!important}.ajk-book-tools>div:first-child{grid-column:1/-1;width:100%!important}.ajk-book-tools>.book-toc-wrap,.ajk-book-tools>.book-view-toggle,.ajk-book-tools>[data-ajk-cover-grid-toggle]{width:100%!important;margin:0!important;box-sizing:border-box}.ajk-book-tools>.book-toc-wrap>button,.ajk-book-tools>.book-view-toggle,.ajk-book-tools>[data-ajk-cover-grid-toggle]{min-height:44px;width:100%!important;box-sizing:border-box;padding:10px 8px!important;font-size:10px!important;letter-spacing:.06em!important;text-align:center}.ajk-book-tools input[type=search]{height:44px}.ajk-book-toolbar{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;align-items:stretch!important;width:100%!important;box-sizing:border-box!important}.ajk-book-toolbar>.ajk-book-search-cell{grid-column:1/-1!important;min-width:0!important;width:100%!important}.ajk-book-toolbar>.book-toc-wrap{display:block!important;position:static!important;min-width:0!important;width:auto!important;margin:0!important}.ajk-book-toolbar>.book-toc-wrap>button,.ajk-book-toolbar>.book-view-toggle,.ajk-book-toolbar>['+TOGGLE_ATTR+']{display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;min-width:0!important;height:52px!important;box-sizing:border-box!important;margin:0!important;padding:10px 8px!important;text-align:center!important;white-space:nowrap!important}.book-toc-panel{position:fixed!important;left:16px!important;right:16px!important;top:18vh!important;width:auto!important;max-height:64vh!important;z-index:120!important;box-sizing:border-box}#'+GRID_ID+'{gap:16px 10px;padding-top:10px}#'+COLS_ID+'{margin:8px 0 2px;width:100%;max-width:none;gap:10px;box-sizing:border-box;justify-content:flex-end;align-items:center}#'+COLS_ID+'.is-open{display:flex}#'+COLS_ID+' .ajk-cover-cols-label{margin-right:2px;font-size:10px}#'+COLS_ID+' button{display:none}#'+COLS_ID+' .ajk-cover-cols-select{display:block;min-width:104px;height:46px}#'+MODAL_ID+'{padding:12px}#'+MODAL_ID+' .ajk-cover-detail{padding:18px}#'+MODAL_ID+' .ajk-cover-detail-body{grid-template-columns:105px minmax(0,1fr);gap:16px}#'+MODAL_ID+' .ajk-cover-detail-hook{font-size:15px}}' +
      '@media(max-width:380px){#'+MODAL_ID+' .ajk-cover-detail-body{grid-template-columns:1fr}#'+MODAL_ID+' .ajk-cover-detail-img{max-width:150px}}' +
      '@media(min-width:900px){#'+GRID_ID+'{gap:30px 24px}}';
    document.head.appendChild(style);
  }

  function visibleTitlesInOrder_(wrap) {
    // The native jump list is rendered from visibleBooksSourceRaw, i.e. the
    // exact current s.books order after access filtering. It is therefore the
    // safest single source for BOTH order and visibility in the cover-only view.
    var titles = [];
    var seen = {};
    var panel = document.querySelector('.book-toc-panel');
    if (panel) {
      Array.prototype.forEach.call(panel.querySelectorAll('button'), function (button) {
        var title = String(button.textContent || '').replace(/\s+/g, ' ').trim();
        var key = normTitle_(title);
        if (!key || seen[key]) return;
        seen[key] = true;
        titles.push(title);
      });
    }
    if (titles.length) return titles;

    // Conservative fallback while React is still mounting: use only rendered
    // book anchors inside the current list. Never append a second source later;
    // that was the cause of duplicate/misordered thumbnails.
    Array.prototype.forEach.call(wrap.querySelectorAll('[id^="book-card-"]'), function (node) {
      var raw = String(node.id || '').replace(/^book-card-/, '');
      var title = raw;
      try { title = decodeURIComponent(raw); } catch (_) {}
      var key = normTitle_(title);
      if (!key || seen[key]) return;
      seen[key] = true;
      titles.push(title);
    });
    return titles;
  }

  function catalogEntryForTitle_(title) {
    var key = normTitle_(title);
    for (var i = 0; i < canonicalCatalog_.length; i++) {
      if (normTitle_(canonicalCatalog_[i] && canonicalCatalog_[i].title) === key) {
        return canonicalCatalog_[i];
      }
    }
    return null;
  }

  function imageForTitle_(wrap, title) {
    var wanted = normTitle_(title + ' cover');
    var imgs = wrap ? wrap.querySelectorAll('img[alt]') : [];
    for (var i = 0; i < imgs.length; i++) {
      if (normTitle_(imgs[i].getAttribute('alt')) === wanted) return imgs[i];
    }
    return null;
  }

  function cardForTitle_(wrap, title) {
    var id = 'book-card-' + encodeURIComponent(title || '');
    var node = document.getElementById(id);
    if (node && wrap.contains(node)) return node;

    // Fallback for harmless Unicode/casing differences in an older rendered
    // anchor. Compare decoded ids instead of taking a neighbouring card.
    var wanted = normTitle_(title);
    var nodes = wrap.querySelectorAll('[id^="book-card-"]');
    for (var i = 0; i < nodes.length; i++) {
      var raw = String(nodes[i].id || '').replace(/^book-card-/, '');
      var decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch (_) {}
      if (normTitle_(decoded) === wanted) return nodes[i];
    }
    return null;
  }

  function domDetailsForTitle_(wrap, title, card) {
    var result = { hook: '', meta: '', actions: [], src: '' };
    if (!card) return result;

    var headings = card.querySelectorAll('h3,h2,h4');
    var titleNode = null;
    var wanted = normTitle_(title);
    for (var i = 0; i < headings.length; i++) {
      if (normTitle_(headings[i].textContent) === wanted) {
        titleNode = headings[i];
        break;
      }
    }

    if (titleNode) {
      var n = titleNode.nextElementSibling;
      while (n && !result.hook) {
        if (n.tagName === 'P' && n.textContent.trim()) result.hook = n.textContent.trim();
        n = n.nextElementSibling;
      }
      if (titleNode.previousElementSibling && titleNode.previousElementSibling.tagName === 'SPAN') {
        result.meta = titleNode.previousElementSibling.textContent.trim();
      }
    }

    var wantedAlt = normTitle_(title + ' cover');
    var imgs = card.querySelectorAll('img[alt]');
    for (var j = 0; j < imgs.length; j++) {
      if (normTitle_(imgs[j].getAttribute('alt')) === wantedAlt) {
        result.src = imgs[j].src || '';
        break;
      }
    }

    result.actions = Array.prototype.slice.call(card.querySelectorAll('a')).filter(function (a) {
      return /^(Read|EPUB|Background|Video|Alt\. covers)$/i.test(a.textContent.trim());
    });
    return result;
  }

  function audioBooksForBook_(book) {
    try {
      if (!window.AJKAudioLibrary) return [];
      if (typeof window.AJKAudioLibrary.findAllByBook === 'function') {
        var all = window.AJKAudioLibrary.findAllByBook(
          book.entryId || book.id || '',
          book.title || book.baseTitle || '',
          book.selectedLang || ''
        );
        if (all && all.length) return all;
      }
      if (typeof window.AJKAudioLibrary.findByBook === 'function') {
        var exact = window.AJKAudioLibrary.findByBook(
          book.entryId || book.id || '',
          book.title || book.baseTitle || '',
          book.selectedLang || ''
        );
        if (exact) return [exact];
      }
      if (typeof window.AJKAudioLibrary.findByTitle === 'function') {
        var byTitle = window.AJKAudioLibrary.findByTitle(book.title || book.baseTitle || '', book.selectedLang || '') ||
          window.AJKAudioLibrary.findByTitle(book.baseTitle || '', book.selectedLang || '');
        return byTitle ? [byTitle] : [];
      }
      return [];
    } catch (_) { return []; }
  }

  function audioForBook_(book) {
    return audioBooksForBook_(book)[0] || null;
  }

  function audioBadge_() {
    var badge = document.createElement('span');
    badge.className = 'ajk-cover-audio-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M5 13h2v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Z"/><path d="M19 13h-2v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z"/></svg>';
    return badge;
  }

  function refreshAudioBadges_() {
    var grid = document.getElementById(GRID_ID);
    if (!grid) return;
    Array.prototype.forEach.call(grid.querySelectorAll('.ajk-cover-thumb'), function (thumb) {
      var title = thumb.dataset.bookTitle || '';
      var frame = thumb.querySelector('.ajk-cover-frame');
      if (!frame) return;
      var existing = frame.querySelector('.ajk-cover-audio-badge');
      var hasAudio = false;
      try {
        hasAudio = !!(window.AJKAudioLibrary &&
          ((typeof window.AJKAudioLibrary.findAllByBook === 'function' &&
            window.AJKAudioLibrary.findAllByBook(thumb.dataset.bookId || '', title, '').length) ||
           (typeof window.AJKAudioLibrary.findByBook === 'function' &&
            window.AJKAudioLibrary.findByBook(thumb.dataset.bookId || '', title, '')) ||
           (typeof window.AJKAudioLibrary.findByTitle === 'function' &&
            window.AJKAudioLibrary.findByTitle(title, ''))));
      } catch (_) {}
      if (hasAudio && !existing) frame.appendChild(audioBadge_());
      if (!hasAudio && existing) existing.remove();
    });
  }

  function dataForTitle_(title, wrap) {
    var entry = catalogEntryForTitle_(title) || {};
    var card = cardForTitle_(wrap, title);
    var dom = domDetailsForTitle_(wrap, title, card);
    var langCodes = (entry.langs && typeof entry.langs === 'object') ? Object.keys(entry.langs) : [];
    var choiceKey = entry.id || title;
    var selectedLang = null;
    if (langCodes.length) {
      var remembered = detailLangChoice_[choiceKey];
      if (remembered && entry.langs[remembered]) selectedLang = remembered;
      else if (entry.defaultLang && entry.langs[entry.defaultLang]) selectedLang = entry.defaultLang;
      else selectedLang = langCodes[0];
    }
    var edition = selectedLang && entry.langs[selectedLang] ? entry.langs[selectedLang] : {};
    return {
      card: card,
      id: entry.id || (card && card.id) || ('book-card-' + encodeURIComponent(title || '')),
      entryId: choiceKey,
      baseTitle: title,
      title: edition.title || entry.title || title,
      src: coverSrc_(edition.title || entry.title || title, edition.coverUrl || entry.coverUrl || dom.src || ''),
      hook: edition.hook || entry.hook || dom.hook || '',
      meta: entry.kind || dom.meta || '',
      actions: dom.actions || [],
      langCodes: langCodes,
      selectedLang: selectedLang,
      epubUrl: edition.epubUrl || entry.epubUrl || '',
      wordCount: edition.wordCount || entry.wordCount || 0
    };
  }

    function closeDetail() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
  }

  function openDetail(book) {
    closeDetail();
    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', book.title);

    var box = document.createElement('div');
    box.className = 'ajk-cover-detail';

    var head = document.createElement('div');
    head.className = 'ajk-cover-detail-head';
    var kicker = document.createElement('span');
    kicker.style.cssText = 'font-family:"Archivo",sans-serif;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)';
    kicker.textContent = t('Buchdetails', 'Book details');
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ajk-cover-detail-close';
    close.textContent = t('Schließen', 'Close');
    close.addEventListener('click', closeDetail);
    head.appendChild(kicker); head.appendChild(close);

    var body = document.createElement('div');
    body.className = 'ajk-cover-detail-body';
    var visual = document.createElement('div');
    if (book.src) {
      var im = document.createElement('img'); im.className = 'ajk-cover-detail-img'; im.src = book.src; im.alt = book.title + ' cover'; visual.appendChild(im);
    } else {
      var ph = document.createElement('div'); ph.className = 'ajk-cover-frame ajk-cover-placeholder'; ph.style.aspectRatio = '2/3'; ph.textContent = book.title; visual.appendChild(ph);
    }

    var info = document.createElement('div');
    var h = document.createElement('h3'); h.className = 'ajk-cover-detail-title'; h.textContent = book.title; info.appendChild(h);
    if (book.meta) { var m = document.createElement('div'); m.className = 'ajk-cover-detail-meta'; m.textContent = book.meta; info.appendChild(m); }

    // Mirror the native DE/EN selector in Covers view. Changing the edition
    // also clicks the matching native card control when available so READ and
    // other permission-aware actions continue to use the selected EPUB.
    if (book.langCodes && book.langCodes.length > 1) {
      var langBar = document.createElement('div');
      langBar.className = 'ajk-cover-detail-langs';
      book.langCodes.forEach(function (code) {
        var lb = document.createElement('button');
        lb.type = 'button';
        lb.className = 'ajk-cover-detail-lang';
        lb.textContent = code;
        lb.setAttribute('aria-pressed', code === book.selectedLang ? 'true' : 'false');
        lb.addEventListener('click', function () {
          detailLangChoice_[book.entryId] = code;
          try {
            var nativeButtons = book.card ? book.card.querySelectorAll('button') : [];
            for (var i = 0; i < nativeButtons.length; i++) {
              if (String(nativeButtons[i].textContent || '').trim().toUpperCase() === String(code).toUpperCase()) {
                nativeButtons[i].click();
                break;
              }
            }
          } catch (_) {}
          setTimeout(function () {
            openDetail(dataForTitle_(book.baseTitle, listWrap()));
          }, 120);
        });
        langBar.appendChild(lb);
      });
      info.appendChild(langBar);
    }

    if (book.hook) { var p = document.createElement('p'); p.className = 'ajk-cover-detail-hook'; p.textContent = book.hook; info.appendChild(p); }

    var audioBooks = audioBooksForBook_(book);
    if (book.actions.length || audioBooks.length) {
      var actions = document.createElement('div'); actions.className = 'ajk-cover-detail-actions';
      book.actions.forEach(function (original) {
        var bt = document.createElement('button'); bt.type = 'button'; bt.className = 'ajk-cover-detail-action'; bt.textContent = original.textContent.trim();
        bt.addEventListener('click', function () { closeDetail(); original.click(); });
        actions.appendChild(bt);
      });
      audioBooks.forEach(function (audioBook) {
        var audioBt = document.createElement('button');
        audioBt.type = 'button';
        audioBt.className = 'ajk-cover-detail-action';
        var baseLabel = audioBook.progress && audioBook.progress.chapter_id ? t('Weiterhören', 'Continue listening') : t('Hörbuch', 'Audiobook');
        var narrator = String(audioBook.narrator_name || '').trim();
        audioBt.textContent = narrator ? (baseLabel + ' · ' + narrator) : baseLabel;
        audioBt.addEventListener('click', function () {
          closeDetail();
          if (!window.AJKAudioLibrary) return;
          if (typeof window.AJKAudioLibrary.openAudioBook === 'function') {
            window.AJKAudioLibrary.openAudioBook(audioBook.id);
          } else if (typeof window.AJKAudioLibrary.openBook === 'function') {
            window.AJKAudioLibrary.openBook(book.entryId || book.id || '', book.title || book.baseTitle, book.selectedLang || '');
          }
        });
        actions.appendChild(audioBt);
      });
      info.appendChild(actions);
    }

    body.appendChild(visual); body.appendChild(info);
    box.appendChild(head); box.appendChild(body); modal.appendChild(box);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeDetail(); });
    document.body.appendChild(modal);
    close.focus();
  }

  window.addEventListener('ajk-audio-catalog-updated', function () {
    refreshAudioBadges_();
    var modal = document.getElementById(MODAL_ID);
    if (modal) {
      var titleNode = modal.querySelector('.ajk-cover-detail-title');
      if (titleNode) {
        var title = String(titleNode.textContent || '').trim();
        var wrap = listWrap();
        if (title && wrap) openDetail(dataForTitle_(title, wrap));
      }
    }
  });

  function visibleTitleSet_(wrap) {
    var set = {};
    visibleTitlesInOrder_(wrap).forEach(function (title) {
      set[normTitle_(title)] = true;
    });
    return set;
  }

  function currentSearchQuery_() {
    var input = document.querySelector('#books input[type="search"]');
    return normTitle_(input && input.value);
  }

  function currentSearchScope_() {
    var select = document.getElementById(SEARCH_SCOPE_ID);
    var value = select && select.value;
    if (value === 'title' || value === 'content') return value;
    try {
      value = localStorage.getItem('ajk_book_search_scope') || 'all';
      if (value === 'title' || value === 'content') return value;
    } catch (_) {}
    return 'all';
  }

  function matchesSearch_(entry, query, scope) {
    if (!query) return true;
    scope = scope || currentSearchScope_();

    var titleHay = [entry && entry.title].join(' ').toLocaleLowerCase();
    var contentHay = [entry && entry.kind, entry && entry.hook, entry && entry.blurb,
      entry && entry.description].join(' ').toLocaleLowerCase();

    if (scope === 'title') return titleHay.indexOf(query) !== -1;
    if (scope === 'content') return contentHay.indexOf(query) !== -1;
    return (titleHay + ' ' + contentHay).indexOf(query) !== -1;
  }

  function searchSlotForCard_(card, wrap) {
    if (!card || !wrap) return card;
    var slot = card;
    var parent = slot.parentElement;

    // Climb through wrappers that belong to this single book only. Stop before
    // the first container that holds multiple books. This collapses any fixed
    // per-book wrapper height left behind by the bundled layout.
    while (parent && parent !== wrap) {
      var count = parent.querySelectorAll('[id^="book-card-"]').length;
      if (count !== 1) break;
      slot = parent;
      parent = slot.parentElement;
    }
    return slot;
  }

  function applyListSearch_(wrap) {
    if (!wrap) return;
    var query = currentSearchQuery_();
    var scope = currentSearchScope_();
    wrap.classList.toggle('ajk-search-active', !!query);
    var booksSection = document.getElementById('books');
    if (booksSection) booksSection.classList.toggle('ajk-search-active', !!query);

    // Clear slot state from the previous search first.
    Array.prototype.forEach.call(wrap.querySelectorAll('.ajk-search-slot-hidden,.ajk-search-slot-visible'), function (slot) {
      slot.classList.remove('ajk-search-slot-hidden', 'ajk-search-slot-visible');
    });

    Array.prototype.forEach.call(wrap.querySelectorAll('[id^="book-card-"]'), function (node) {
      var raw = String(node.id || '').replace(/^book-card-/, '');
      var title = raw;
      try { title = decodeURIComponent(raw); } catch (_) {}
      var entry = catalogEntryForTitle_(title) || { title: title };
      var hidden = !!query && !matchesSearch_(entry, query, scope);
      node.classList.toggle('ajk-search-hidden', hidden);

      var slot = searchSlotForCard_(node, wrap);
      if (slot && slot !== wrap) {
        slot.classList.toggle('ajk-search-slot-hidden', hidden);
        slot.classList.toggle('ajk-search-slot-visible', !!query && !hidden);
      }
    });

    // Series shelves are .book-card wrappers without their own id. Their
    // individual volumes carry the book-card-* ids. If a search hides every
    // volume in a shelf, hide the shelf itself too; otherwise an empty series
    // wrapper can reserve a very large blank area on mobile Safari.
    Array.prototype.forEach.call(wrap.querySelectorAll('.book-card:not([id])'), function (seriesCard) {
      var volumes = Array.prototype.slice.call(seriesCard.querySelectorAll('[id^="book-card-"]'));
      if (!volumes.length) return;
      var hasVisible = !query || volumes.some(function (volume) {
        return !volume.classList.contains('ajk-search-hidden');
      });
      seriesCard.classList.toggle('ajk-search-slot-hidden', !!query && !hasVisible);
      seriesCard.classList.toggle('ajk-search-slot-visible', !!query && hasVisible);
    });
  }

  function ensureSearchScope_() {
    var input = document.querySelector('#books input[type="search"]');
    if (!input) return null;

    var host = input.parentElement;
    if (host) host.classList.add('ajk-book-search-cell');

    var select = document.getElementById(SEARCH_SCOPE_ID);
    if (!select) {
      select = document.createElement('select');
      select.id = SEARCH_SCOPE_ID;
      select.setAttribute('aria-label', t('Suchbereich', 'Search scope'));

      [
        ['all', t('Alles', 'All')],
        ['title', t('Titel', 'Title')],
        ['content', t('Inhalt', 'Content')]
      ].forEach(function (pair) {
        var option = document.createElement('option');
        option.value = pair[0];
        option.textContent = pair[1];
        select.appendChild(option);
      });

      var saved = 'all';
      try { saved = localStorage.getItem('ajk_book_search_scope') || 'all'; } catch (_) {}
      if (saved !== 'title' && saved !== 'content') saved = 'all';
      select.value = saved;

      select.addEventListener('change', function () {
        try { localStorage.setItem('ajk_book_search_scope', select.value); } catch (_) {}
        var wrap = listWrap();
        applyListSearch_(wrap);
        var grid = document.getElementById(GRID_ID);
        if (grid && wrap) {
          grid.dataset.signature = '';
          buildGrid(wrap);
          if (active) grid.classList.add('is-open');
        }
      });

      if (host) host.appendChild(select);
    }
    return select;
  }

  function visitorBookAccess_() {
    // Access permissions from the logged-in visitor are stricter than any DOM
    // fallback. In particular, an explicit [] means "no books" and must never
    // be mistaken for "visibility unknown" or "show everything".
    if (isAdmin_()) return { known: true, unrestricted: true, allowed: null };
    try {
      var raw = localStorage.getItem('ajk_visitor_access');
      if (!raw) return { known: false, unrestricted: false, allowed: null };
      var access = JSON.parse(raw) || {};
      if (!access.code) return { known: false, unrestricted: false, allowed: null };
      if (Array.isArray(access.visibleBooks)) {
        var allowed = {};
        access.visibleBooks.forEach(function (title) {
          var key = normTitle_(title);
          if (key) allowed[key] = true;
        });
        return { known: true, unrestricted: false, allowed: allowed };
      }
      if (access.visibleBooks === null || access.visibleBooks === undefined) {
        return { known: true, unrestricted: true, allowed: null };
      }
    } catch (_) {}
    return { known: false, unrestricted: false, allowed: null };
  }

  function booksForGrid_(wrap) {
    // STRICT canonical grid: one catalogue entry = one thumbnail.
    // The logged-in visitor's explicit VisibleBooks permission is authoritative.
    // Only when that permission is genuinely unknown do we fall back to the
    // currently rendered/jump-list titles.
    var access = visitorBookAccess_();
    var visibleTitles = visibleTitlesInOrder_(wrap);
    var visible = {};

    if (access.known && !access.unrestricted) {
      visible = access.allowed || {};
    } else {
      visibleTitles.forEach(function (title) { visible[normTitle_(title)] = true; });
    }

    var hasVisibilityFilter = access.known && !access.unrestricted
      ? true
      : visibleTitles.length > 0;

    // For an explicitly restricted visitor, even an empty permission set is
    // final: do not repopulate the grid from DOM fallbacks.
    if (!canonicalCatalog_.length && visibleTitles.length && !(access.known && !access.unrestricted)) {
      return visibleTitles.map(function (title) {
        return dataForTitle_(title, wrap);
      }).filter(function (book) {
        return book && book.title && matchesSearch_(book, currentSearchQuery_(), currentSearchScope_());
      });
    }

    var out = [];
    var seenIds = {};
    var seenTitles = {};

    canonicalCatalog_.forEach(function (entry) {
      if (!entry || !entry.title) return;

      var titleKey = normTitle_(entry.title);
      var idKey = String(entry.id || '').trim();
      var searchQuery = currentSearchQuery_();
      if (!titleKey) return;
      if (hasVisibilityFilter && !visible[titleKey]) return;
      if (!matchesSearch_(entry, searchQuery, currentSearchScope_())) return;
      if ((idKey && seenIds[idKey]) || seenTitles[titleKey]) return;

      if (idKey) seenIds[idKey] = true;
      seenTitles[titleKey] = true;

      var card = cardForTitle_(wrap, entry.title);
      var dom = domDetailsForTitle_(wrap, entry.title, card);

      out.push({
        card: card,
        id: entry.id || (card && card.id) || ('book-card-' + encodeURIComponent(entry.title)),
        title: entry.title,
        src: coverSrc_(entry.title, entry.coverUrl || ''),
        hook: entry.hook || dom.hook || '',
        meta: entry.kind || dom.meta || '',
        actions: dom.actions || []
      });
    });

    return out;
  }

  function showOrderToast_(message) {
    var old = document.getElementById('ajk-cover-order-toast');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.id = 'ajk-cover-order-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 2200);
  }

  function reorderCanonicalFromGrid_(grid) {
    var order = Array.prototype.map.call(grid.querySelectorAll('.ajk-cover-thumb'), function (node) {
      return { id: node.dataset.bookId || '', title: node.dataset.bookTitle || '' };
    });
    var rank = {};
    order.forEach(function (item, i) {
      var key = item.id ? ('id:' + item.id) : ('t:' + normTitle_(item.title));
      rank[key] = i;
    });
    canonicalCatalog_.sort(function (a, b) {
      var ka = a.id ? ('id:' + a.id) : ('t:' + normTitle_(a.title));
      var kb = b.id ? ('id:' + b.id) : ('t:' + normTitle_(b.title));
      var ra = Object.prototype.hasOwnProperty.call(rank, ka) ? rank[ka] : Number.MAX_SAFE_INTEGER;
      var rb = Object.prototype.hasOwnProperty.call(rank, kb) ? rank[kb] : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
    return order;
  }

  async function saveOrderViaLegacy_(order, token) {
    // Backward-compatible fallback while an older Apps Script deployment is
    // still live: read the full server list with POST (so the service worker
    // cannot merge in the static fallback), reorder those exact records, then
    // use the long-standing saveBooks endpoint.
    var readParams = new URLSearchParams({ action: 'getBooks' });
    var readRes = await fetch(GAS_URL, { method: 'POST', body: readParams, cache: 'no-store' });
    var readData = await readRes.json();
    var raw = readData && readData.books;
    if (typeof raw === 'string') raw = JSON.parse(raw || '[]');
    if (!Array.isArray(raw)) throw new Error('getBooks_failed');

    var byId = {};
    var byTitle = {};
    raw.forEach(function (b) {
      if (b && b.id) byId[String(b.id)] = b;
      if (b && b.title) byTitle[normTitle_(b.title)] = b;
    });

    var reordered = [];
    var used = {};
    order.forEach(function (item) {
      var book = (item.id && byId[String(item.id)]) || byTitle[normTitle_(item.title)];
      if (!book) return;
      var key = String(book.id || book.title);
      if (used[key]) return;
      used[key] = true;
      reordered.push(book);
    });
    raw.forEach(function (book) {
      var key = String(book.id || book.title);
      if (!used[key]) reordered.push(book);
    });

    var saveParams = new URLSearchParams({
      action: 'saveBooks',
      adminToken: token,
      books: JSON.stringify(reordered)
    });
    var saveRes = await fetch(GAS_URL, { method: 'POST', body: saveParams, cache: 'no-store' });
    var saveData = await saveRes.json();
    if (!saveData || !saveData.ok) throw new Error((saveData && saveData.error) || 'saveBooks_failed');
    return true;
  }

  async function persistGridOrder_(grid) {
    if (!isAdmin_()) return;
    if (currentSearchQuery_()) {
      window.alert(t('Bitte die Suche leeren, bevor du Bücher verschiebst.', 'Clear the search before reordering books.'));
      grid.dataset.signature = '';
      buildGrid(listWrap());
      return;
    }
    var order = reorderCanonicalFromGrid_(grid);
    writeAdminOrder_(order);
    var token = adminToken_();
    if (!token || !order.length) return;

    try {
      showOrderToast_(t('Reihenfolge wird gespeichert …', 'Saving order …'));
      var params = new URLSearchParams({
        action: 'saveBookOrder',
        adminToken: token,
        order: JSON.stringify(order)
      });
      var res = await fetch(GAS_URL, { method: 'POST', body: params, cache: 'no-store' });
      var data = await res.json();

      if (!data || !data.ok) {
        var error = (data && data.error) || 'save_failed';
        if (/unknown action/i.test(error)) {
          await saveOrderViaLegacy_(order, token);
        } else {
          throw new Error(error);
        }
      }

      // Verify the central order immediately. If an older/partial deployment
      // acknowledges the action without actually storing the new sequence,
      // fall back to the proven saveBooks path instead of showing a false ✓.
      try {
        var verifyParams = new URLSearchParams({ action: 'getBooks' });
        var verifyRes = await fetch(GAS_URL, { method: 'POST', body: verifyParams, cache: 'no-store' });
        var verifyData = await verifyRes.json();
        var verifyBooks = verifyData && verifyData.books;
        if (typeof verifyBooks === 'string') verifyBooks = JSON.parse(verifyBooks || '[]');
        if (Array.isArray(verifyBooks) && !sameOrder_(verifyBooks, order)) {
          await saveOrderViaLegacy_(order, token);
        }
      } catch (_) {
        // The server has already acknowledged the save. Keep the local order
        // cache so reopening on this device still restores the user's sequence.
      }

      writeAdminOrder_(order);
      showOrderToast_(t('Reihenfolge gespeichert ✓', 'Order saved ✓'));
    } catch (err) {
      window.alert(t('Reihenfolge konnte nicht zentral gespeichert werden: ', 'Order could not be saved centrally: ') + err.message);
      await loadCanonicalCatalog_();
      grid.dataset.signature = '';
      buildGrid(listWrap());
    }
  }

  function attachDragHandle_(thumb, grid) {
    if (!isAdmin_() || currentSearchQuery_()) return;
    var handle = document.createElement('span');
    handle.className = 'ajk-cover-drag-handle';
    handle.textContent = '≡';
    handle.setAttribute('aria-label', t('Buch verschieben', 'Move book'));

    handle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });

    function nearestTarget_(x, y) {
      var best = null;
      var bestDistance = Infinity;
      Array.prototype.forEach.call(grid.querySelectorAll('.ajk-cover-thumb'), function (candidate) {
        if (candidate === thumb) return;
        var r = candidate.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        var dx = x - cx;
        var dy = y - cy;
        var distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { node: candidate, rect: r };
        }
      });
      return best;
    }

    function moveGhost_(state, x, y) {
      if (!state || !state.ghost) return;
      var dx = x - state.startX;
      var dy = y - state.startY;
      state.ghost.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
    }

    function reorderAt_(state, x, y) {
      if (!state) return;

      // Gentle edge scrolling makes it possible to move a cover across several
      // rows in one continuous gesture on a phone.
      var edge = 90;
      if (y < edge) window.scrollBy(0, -Math.min(18, (edge - y) / 3));
      else if (y > window.innerHeight - edge) {
        window.scrollBy(0, Math.min(18, (y - (window.innerHeight - edge)) / 3));
      }

      var nearest = nearestTarget_(x, y);
      if (!nearest) return;
      var target = nearest.node;
      var rect = nearest.rect;
      var rowBand = Math.abs(y - (rect.top + rect.height / 2)) < rect.height * .38;
      var before = y < rect.top + rect.height / 2;
      if (rowBand) before = x < rect.left + rect.width / 2;

      if (before) {
        if (thumb.nextSibling !== target) {
          grid.insertBefore(thumb, target);
          state.moved = true;
        }
      } else if (target.nextSibling !== thumb) {
        grid.insertBefore(thumb, target.nextSibling);
        state.moved = true;
      }
    }

    function removeWindowListeners_() {
      window.removeEventListener('pointermove', onMove_, true);
      window.removeEventListener('pointerup', onFinish_, true);
      window.removeEventListener('pointercancel', onFinish_, true);
      window.removeEventListener('blur', onAbort_, true);
      document.removeEventListener('visibilitychange', onVisibility_, true);
    }

    function cleanup_(shouldPersist, pointerId) {
      var state = dragState_;
      if (!state || state.thumb !== thumb) {
        removeWindowListeners_();
        return;
      }
      var moved = state.moved;
      var ghost = state.ghost;
      dragState_ = null;
      thumb.classList.remove('is-dragging');
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      Array.prototype.forEach.call(document.querySelectorAll('.ajk-cover-drag-ghost'), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      if (state.raf) {
        try { cancelAnimationFrame(state.raf); } catch (_) {}
      }
      removeWindowListeners_();
      if (shouldPersist && moved) {
        suppressCoverClickUntil_ = Date.now() + 700;
        persistGridOrder_(grid);
      }
    }

    function onMove_(e) {
      if (!dragState_ || dragState_.thumb !== thumb || dragState_.pointerId !== e.pointerId) return;
      e.preventDefault();

      var state = dragState_;
      state.lastX = e.clientX;
      state.lastY = e.clientY;

      // The floating preview follows every pointer event via GPU transform.
      // Actual grid reordering is throttled to one update per animation frame
      // so iOS does not perform dozens of synchronous grid layouts per second.
      moveGhost_(state, e.clientX, e.clientY);
      if (!state.raf) {
        state.raf = requestAnimationFrame(function () {
          if (!dragState_ || dragState_ !== state) return;
          state.raf = 0;
          reorderAt_(state, state.lastX, state.lastY);
        });
      }
    }

    function onFinish_(e) {
      if (!dragState_ || dragState_.thumb !== thumb || dragState_.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      cleanup_(true, e.pointerId);
    }

    function onAbort_() {
      cleanup_(false, null);
    }

    function onVisibility_() {
      if (document.hidden) cleanup_(false, null);
    }

    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      // Safari can lose pointer capture when the dragged element is reinserted
      // in another grid position. Remove any orphaned preview before starting a
      // new gesture and listen on window for the complete drag lifecycle.
      Array.prototype.forEach.call(document.querySelectorAll('.ajk-cover-drag-ghost'), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });

      var rect = thumb.getBoundingClientRect();
      var ghost = thumb.cloneNode(true);
      ghost.classList.remove('is-dragging');
      ghost.classList.add('ajk-cover-drag-ghost');
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      var ghostHandle = ghost.querySelector('.ajk-cover-drag-handle');
      if (ghostHandle) ghostHandle.remove();
      document.body.appendChild(ghost);

      dragState_ = {
        thumb: thumb,
        grid: grid,
        pointerId: e.pointerId,
        moved: false,
        ghost: ghost,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        raf: 0
      };
      thumb.classList.add('is-dragging');

      window.addEventListener('pointermove', onMove_, { capture: true, passive: false });
      window.addEventListener('pointerup', onFinish_, { capture: true, passive: false });
      window.addEventListener('pointercancel', onFinish_, { capture: true, passive: false });
      window.addEventListener('blur', onAbort_, true);
      document.addEventListener('visibilitychange', onVisibility_, true);
      // Deliberately do NOT use setPointerCapture here. On iOS Safari the
      // dragged grid item is reinserted as its order changes; that can emit
      // lostpointercapture after the first position change and prematurely end
      // the gesture. Window-level listeners already keep the drag alive.
    });

    thumb.appendChild(handle);
  }

  function buildGrid(wrap) {
    var grid = document.getElementById(GRID_ID);
    if (!grid) {
      grid = document.createElement('div');
      grid.id = GRID_ID;
      wrap.parentNode.insertBefore(grid, wrap);
    }

    var books = booksForGrid_(wrap);
    var signature = books.map(function (b) { return b.id + '|' + b.src + '|' + b.title; }).join('\n');
    if (grid.dataset.signature === signature) return grid;
    grid.dataset.signature = signature;
    grid.textContent = '';

    var allowReorder = isAdmin_() && !currentSearchQuery_();
    grid.classList.toggle('ajk-admin-reorder', allowReorder);

    books.forEach(function (book) {
      var thumb = document.createElement('button');
      thumb.type = 'button'; thumb.className = 'ajk-cover-thumb'; thumb.title = book.title;
      thumb.dataset.bookId = book.id || '';
      thumb.dataset.bookTitle = book.title || '';
      thumb.setAttribute('aria-label', book.title + ' — ' + t('Details', 'Details'));
      var frame = document.createElement('span'); frame.className = 'ajk-cover-frame';
      if (book.src) {
        var img = document.createElement('img'); img.src = book.src; img.alt = book.title + ' cover'; img.loading = 'lazy'; frame.appendChild(img);
      } else {
        var fb = document.createElement('span'); fb.className = 'ajk-cover-placeholder'; fb.textContent = book.title; frame.appendChild(fb);
      }
      if (audioForBook_(book)) frame.appendChild(audioBadge_());
      thumb.appendChild(frame);
      thumb.addEventListener('click', function () {
        if (Date.now() < suppressCoverClickUntil_) return;
        openDetail(book);
      });
      grid.appendChild(thumb);
      if (allowReorder) attachDragHandle_(thumb, grid);
    });
    return grid;
  }


  function readColumnCount() {
    var value = 3;
    try { value = parseInt(localStorage.getItem('ajk_book_cover_columns') || '3', 10); } catch (_) {}
    if (!isFinite(value)) value = 3;
    return Math.max(1, Math.min(6, value));
  }

  function setColumnCount(value) {
    columnCount = Math.max(1, Math.min(6, parseInt(value, 10) || 3));
    var grid = document.getElementById(GRID_ID);
    if (grid) grid.style.setProperty('--ajk-cover-cols', String(columnCount));
    var chooser = document.getElementById(COLS_ID);
    if (chooser) {
      Array.prototype.forEach.call(chooser.querySelectorAll('button[data-cols]'), function (button) {
        button.setAttribute('aria-pressed', String(parseInt(button.getAttribute('data-cols'), 10) === columnCount));
      });
      var select = chooser.querySelector('.ajk-cover-cols-select');
      if (select) select.value = String(columnCount);
    }
    try { localStorage.setItem('ajk_book_cover_columns', String(columnCount)); } catch (_) {}
  }

  function placeColumnChooser_(chooser, toggleButton) {
    if (!chooser) return;
    var mobile = false;
    try { mobile = !!(window.matchMedia && window.matchMedia('(max-width:640px)').matches); } catch (_) {}
    var grid = document.getElementById(GRID_ID);

    // On phones the view buttons live in a single non-wrapping toolbar. Putting
    // the column selector beside "Nur Cover" pushes it beyond the right edge.
    // Give it its own row directly above the cover grid instead.
    if (mobile && grid && grid.parentNode) {
      if (chooser.nextSibling !== grid || chooser.parentNode !== grid.parentNode) {
        grid.parentNode.insertBefore(chooser, grid);
      }
      return;
    }

    // Desktop keeps the compact selector next to the view controls.
    if (toggleButton && toggleButton.parentNode) {
      if (chooser.parentNode !== toggleButton.parentNode || toggleButton.nextSibling !== chooser) {
        toggleButton.parentNode.insertBefore(chooser, toggleButton.nextSibling);
      }
    }
  }

  function ensureColumnChooser(toggleButton) {
    var chooser = document.getElementById(COLS_ID);
    if (chooser) {
      placeColumnChooser_(chooser, toggleButton);
      return chooser;
    }
    chooser = document.createElement('div');
    chooser.id = COLS_ID;
    chooser.setAttribute('role', 'group');
    chooser.setAttribute('aria-label', t('Cover pro Zeile', 'Covers per row'));

    var label = document.createElement('span');
    label.className = 'ajk-cover-cols-label';
    label.textContent = t('Pro Zeile', 'Per row');
    chooser.appendChild(label);

    for (var i = 1; i <= 6; i++) {
      (function (count) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-cols', String(count));
        button.setAttribute('aria-label', count + ' ' + t('Cover pro Zeile', 'covers per row'));
        button.textContent = String(count);
        button.addEventListener('click', function () { setColumnCount(count); });
        chooser.appendChild(button);
      })(i);
    }

    // On phones use the native picker instead of six tiny number buttons.
    // This gives iOS a large, reliable touch target while desktop keeps the
    // compact 1–6 button row.
    var select = document.createElement('select');
    select.className = 'ajk-cover-cols-select';
    select.setAttribute('aria-label', t('Cover pro Zeile auswählen', 'Choose covers per row'));
    for (var j = 1; j <= 6; j++) {
      var option = document.createElement('option');
      option.value = String(j);
      option.textContent = String(j);
      select.appendChild(option);
    }
    select.addEventListener('change', function () { setColumnCount(select.value); });
    chooser.appendChild(select);

    placeColumnChooser_(chooser, toggleButton);
    columnCount = readColumnCount();
    setColumnCount(columnCount);
    return chooser;
  }

  function setMode(on) {
    active = !!on;
    var wrap = listWrap();
    if (!wrap) return;
    var grid = buildGrid(wrap);
    var booksSection = document.getElementById('books');
    if (booksSection) booksSection.classList.toggle('ajk-cover-mode', active);
    wrap.style.display = active ? 'none' : '';
    grid.classList.toggle('is-open', active);
    var button = document.querySelector('[' + TOGGLE_ATTR + ']');
    if (button) button.setAttribute('aria-pressed', active ? 'true' : 'false');
    var chooser = ensureColumnChooser(button);
    if (chooser) chooser.classList.toggle('is-open', active);
    setColumnCount(readColumnCount());
    if (!active) closeDetail();
    try { localStorage.setItem('ajk_book_cover_view', active ? '1' : '0'); } catch (_) {}
  }

  function bindSearch_() {
    var input = document.querySelector('#books input[type="search"]');
    if (!input) return;
    ensureSearchScope_();
    if (input.dataset.ajkSearchBound === '1') {
      applyListSearch_(listWrap());
      return;
    }

    input.dataset.ajkSearchBound = '1';
    input.addEventListener('input', function () {
      clearTimeout(searchTimer_);
      searchTimer_ = setTimeout(function () {
        // Keep the bundled list state in sync, then apply our explicit
        // card-level filter so hidden results cannot leave empty vertical space.
        try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        var grid = document.getElementById(GRID_ID);
        var wrap = listWrap();
        applyListSearch_(wrap);
        if (grid && wrap) {
          grid.dataset.signature = '';
          buildGrid(wrap);
          if (active) grid.classList.add('is-open');
        }
      }, 70);
    });

    applyListSearch_(listWrap());
  }

  function ensure() {
    var wrap = listWrap();
    if (!wrap) return false;
    var tocWrap = document.querySelector('.book-toc-wrap');
    if (tocWrap && tocWrap.parentElement) tocWrap.parentElement.classList.add('ajk-book-tools');
    injectStyles();
    bindSearch_();
    buildGrid(wrap);

    // Mobile-only toolbar normalization. The bundled template has search,
    // jump-list and list toggle in one flex row; once "Nur Cover" is added,
    // iPhone can overflow that row and stretch "Sprung-Liste". Mark the
    // existing elements and let the mobile CSS place search on its own row
    // and the three view buttons in equal columns.
    var tocWrap = document.querySelector('.book-toc-wrap');
    if (tocWrap && tocWrap.parentElement) {
      var toolbar = tocWrap.parentElement;
      toolbar.classList.add('ajk-book-toolbar');
      if (toolbar.firstElementChild) toolbar.firstElementChild.classList.add('ajk-book-search-cell');
    }

    var button = document.querySelector('[' + TOGGLE_ATTR + ']');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.setAttribute(TOGGLE_ATTR, '1');
      button.setAttribute('aria-pressed', 'false');
      button.textContent = t('Nur Cover', 'Covers only');
      button.addEventListener('click', function () { setMode(!active); });
    }

    // Keep all three view controls in the SAME toolbar. Earlier versions used
    // the first .book-view-toggle found anywhere in the page, which could put
    // "Nur Cover" into a different container on mobile and leave only two
    // buttons visible. The jump/list/cover row is now deterministic.
    if (toolbar) {
      var listToggle = toolbar.querySelector('.book-view-toggle');
      if (listToggle) {
        if (button.parentNode !== toolbar || listToggle.nextSibling !== button) {
          toolbar.insertBefore(button, listToggle.nextSibling);
        }
      } else if (button.parentNode !== toolbar) {
        toolbar.appendChild(button);
      }
    } else if (!button.parentNode) {
      wrap.parentNode.insertBefore(button, wrap);
    }

    ensureColumnChooser(button);
    try {
      if (localStorage.getItem('ajk_book_cover_view') === '1' && !active) setMode(true);
    } catch (_) {}
    return true;
  }

  function startUi_() {
    ensure();
    observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        if (ensure() && active) setMode(true);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  }

  function refreshGridAfterCatalog_() {
    var wrap = listWrap();
    if (!wrap) return;
    var grid = document.getElementById(GRID_ID);
    if (grid) grid.dataset.signature = '';
    buildGrid(wrap);
    if (active) setMode(true);
  }

  function start() {
    // Safari Private Browsing can delay/block the cross-origin Apps Script
    // request. The UI must not wait for that request: show controls now, then
    // refresh thumbnails once catalogue data is available.
    startUi_();
    loadCanonicalCatalog_().then(refreshGridAfterCatalog_, refreshGridAfterCatalog_);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
