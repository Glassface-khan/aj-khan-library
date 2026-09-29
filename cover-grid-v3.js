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

  async function loadCanonicalCatalog_() {
    var liveBooks = [];
    var fallbackBooks = [];

    try {
      var liveRes = await fetch(GAS_URL + '?action=getBooks&cb=' + Date.now(), { cache: 'no-store' });
      if (liveRes && liveRes.ok) {
        var livePayload = await liveRes.json();
        var liveRaw = livePayload && livePayload.books;
        if (typeof liveRaw === 'string') liveRaw = JSON.parse(liveRaw || '[]');
        if (Array.isArray(liveRaw)) liveBooks = liveRaw.filter(function (b) { return b && b.title; });
      }
    } catch (_) {}

    try {
      var fallbackRes = await fetch('./books-live.json?cover-order=20260929a', { cache: 'no-store' });
      if (fallbackRes && fallbackRes.ok) {
        var fallbackPayload = await fallbackRes.json();
        var fallbackRaw = fallbackPayload && fallbackPayload.books;
        if (typeof fallbackRaw === 'string') fallbackRaw = JSON.parse(fallbackRaw || '[]');
        if (Array.isArray(fallbackRaw)) fallbackBooks = fallbackRaw.filter(function (b) { return b && b.title; });
      }
    } catch (_) {}

    // The live BooksData order wins. The deploy-coupled fallback only fills
    // titles not yet visible in a temporarily lagging backend.
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
        // Keep the deploy-verified cover binding when available. This prevents
        // an older/stale BooksData coverUrl from visually duplicating another
        // title while still letting the live backend control the order.
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
      fallbackBooks.forEach(function (b) {
        var key = normTitle_(b.title);
        if (!key || seen[key]) return;
        seen[key] = true;
        merged.push(b);
      });
    }

    canonicalCatalog_ = merged;
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
      '.ajk-cover-thumb{appearance:none;border:0;background:none;padding:0;cursor:pointer;min-width:0;text-align:left}' +
      '.ajk-cover-frame{display:block;width:100%;aspect-ratio:2/3;overflow:hidden;background:var(--bone-deep,#e9e3d7);border:1px solid var(--rule,#cfc6b5);box-shadow:0 8px 22px rgba(0,0,0,.10);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}' +
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
      '.ajk-cover-thumb.is-dragging{z-index:6;opacity:.78;transform:scale(.97)}' +
      '.ajk-cover-thumb.is-dragging .ajk-cover-frame{border-color:var(--gold,#b89448);box-shadow:0 18px 38px rgba(0,0,0,.25)}' +
      '.ajk-search-hidden{display:none!important}' +
      '#books.ajk-search-active{min-height:0!important;height:auto!important;padding-bottom:0!important}' +
      '#books .book-list-wrap.ajk-search-active{min-height:0!important;height:auto!important;padding-bottom:0!important;margin-bottom:0!important}' +
      '#books.ajk-search-active .book-list-wrap [id^="book-card-"]:not(.ajk-search-hidden){min-height:0!important;height:auto!important;margin-bottom:24px!important;padding-bottom:24px!important}' +
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

  function dataForTitle_(title, wrap) {
    var entry = catalogEntryForTitle_(title) || {};
    var card = cardForTitle_(wrap, title);
    var dom = domDetailsForTitle_(wrap, title, card);
    return {
      card: card,
      id: entry.id || (card && card.id) || ('book-card-' + encodeURIComponent(title || '')),
      title: entry.title || title,
      src: entry.coverUrl || dom.src || '',
      hook: entry.hook || dom.hook || '',
      meta: entry.kind || dom.meta || '',
      actions: dom.actions || []
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
    if (book.hook) { var p = document.createElement('p'); p.className = 'ajk-cover-detail-hook'; p.textContent = book.hook; info.appendChild(p); }

    if (book.actions.length) {
      var actions = document.createElement('div'); actions.className = 'ajk-cover-detail-actions';
      book.actions.forEach(function (original) {
        var bt = document.createElement('button'); bt.type = 'button'; bt.className = 'ajk-cover-detail-action'; bt.textContent = original.textContent.trim();
        bt.addEventListener('click', function () { closeDetail(); original.click(); });
        actions.appendChild(bt);
      });
      info.appendChild(actions);
    }

    body.appendChild(visual); body.appendChild(info);
    box.appendChild(head); box.appendChild(body); modal.appendChild(box);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeDetail(); });
    document.body.appendChild(modal);
    close.focus();
  }

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

  function applyListSearch_(wrap) {
    if (!wrap) return;
    var query = currentSearchQuery_();
    var scope = currentSearchScope_();
    wrap.classList.toggle('ajk-search-active', !!query);
    var booksSection = document.getElementById('books');
    if (booksSection) booksSection.classList.toggle('ajk-search-active', !!query);

    Array.prototype.forEach.call(wrap.querySelectorAll('[id^="book-card-"]'), function (node) {
      var raw = String(node.id || '').replace(/^book-card-/, '');
      var title = raw;
      try { title = decodeURIComponent(raw); } catch (_) {}
      var entry = catalogEntryForTitle_(title) || { title: title };
      node.classList.toggle('ajk-search-hidden', !!query && !matchesSearch_(entry, query, scope));
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

  function booksForGrid_(wrap) {
    // STRICT canonical grid: one catalogue entry = one thumbnail.
    // Order, identity and cover all come from books-live.json. The rendered
    // DOM is used only to determine which titles the current user may see.
    var visibleTitles = visibleTitlesInOrder_(wrap);
    var visible = {};
    visibleTitles.forEach(function (title) { visible[normTitle_(title)] = true; });
    var hasVisibilityFilter = visibleTitles.length > 0;

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
        src: entry.coverUrl || '',
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

    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragState_ = { thumb: thumb, grid: grid, pointerId: e.pointerId, moved: false };
      thumb.classList.add('is-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });

    handle.addEventListener('pointermove', function (e) {
      if (!dragState_ || dragState_.pointerId !== e.pointerId) return;
      e.preventDefault();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var target = el && el.closest ? el.closest('.ajk-cover-thumb') : null;
      if (!target || target === thumb || target.parentNode !== grid) return;
      var rect = target.getBoundingClientRect();
      var before = (e.clientY < rect.top + rect.height / 2) ||
        (Math.abs(e.clientY - (rect.top + rect.height / 2)) < rect.height * .35 &&
         e.clientX < rect.left + rect.width / 2);
      if (before) grid.insertBefore(thumb, target);
      else grid.insertBefore(thumb, target.nextSibling);
      dragState_.moved = true;
    });

    function finish(e) {
      if (!dragState_ || dragState_.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      var moved = dragState_.moved;
      dragState_ = null;
      thumb.classList.remove('is-dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) {
        suppressCoverClickUntil_ = Date.now() + 700;
        persistGridOrder_(grid);
      }
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
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

  function start() {
    loadCanonicalCatalog_().then(startUi_, startUi_);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
