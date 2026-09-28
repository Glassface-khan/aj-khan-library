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

  function normTitle_(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }

  async function loadCanonicalCatalog_() {
    try {
      // books-live.json preserves the exact Admin/BooksData order and has one
      // authoritative cover URL per title. A cache-buster avoids stale iOS
      // shell copies after Drive/catalog updates.
      var res = await fetch('./books-live.json?cover-order=20260928f', { cache: 'no-store' });
      if (!res || !res.ok) throw new Error('catalog_http');
      var payload = await res.json();
      var books = payload && payload.books;
      if (typeof books === 'string') books = JSON.parse(books);
      canonicalCatalog_ = Array.isArray(books) ? books.filter(function (b) { return b && b.title; }) : [];
    } catch (_) {
      canonicalCatalog_ = [];
    }
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

  function booksForGrid_(wrap) {
    // One title in, one thumbnail out. Order comes exclusively from the native
    // jump list (which itself comes from s.books). Cover/content comes from the
    // canonical catalogue by title. No second-pass append = no duplicates.
    return visibleTitlesInOrder_(wrap).map(function (title) {
      return dataForTitle_(title, wrap);
    });
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

    books.forEach(function (book) {
      var thumb = document.createElement('button');
      thumb.type = 'button'; thumb.className = 'ajk-cover-thumb'; thumb.title = book.title;
      thumb.setAttribute('aria-label', book.title + ' — ' + t('Details', 'Details'));
      var frame = document.createElement('span'); frame.className = 'ajk-cover-frame';
      if (book.src) {
        var img = document.createElement('img'); img.src = book.src; img.alt = book.title + ' cover'; img.loading = 'lazy'; frame.appendChild(img);
      } else {
        var fb = document.createElement('span'); fb.className = 'ajk-cover-placeholder'; fb.textContent = book.title; frame.appendChild(fb);
      }
      thumb.appendChild(frame);
      thumb.addEventListener('click', function () { openDetail(book); });
      grid.appendChild(thumb);
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

  function ensure() {
    var wrap = listWrap();
    if (!wrap) return false;
    var tocWrap = document.querySelector('.book-toc-wrap');
    if (tocWrap && tocWrap.parentElement) tocWrap.parentElement.classList.add('ajk-book-tools');
    injectStyles();
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
