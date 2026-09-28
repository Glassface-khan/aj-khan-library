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
      '@media(max-width:640px){.book-toc-wrap{position:static!important}.book-toc-panel{position:fixed!important;left:16px!important;right:16px!important;top:18vh!important;width:auto!important;max-height:64vh!important;z-index:120!important;box-sizing:border-box}#'+GRID_ID+'{gap:16px 10px;padding-top:10px}#'+COLS_ID+'{margin:8px 0 2px;width:100%;max-width:none;gap:10px;box-sizing:border-box;justify-content:flex-end;align-items:center}#'+COLS_ID+'.is-open{display:flex}#'+COLS_ID+' .ajk-cover-cols-label{margin-right:2px;font-size:10px}#'+COLS_ID+' button{display:none}#'+COLS_ID+' .ajk-cover-cols-select{display:block;min-width:104px;height:46px}#'+MODAL_ID+'{padding:12px}#'+MODAL_ID+' .ajk-cover-detail{padding:18px}#'+MODAL_ID+' .ajk-cover-detail-body{grid-template-columns:105px minmax(0,1fr);gap:16px}#'+MODAL_ID+' .ajk-cover-detail-hook{font-size:15px}}' +
      '@media(max-width:380px){#'+MODAL_ID+' .ajk-cover-detail-body{grid-template-columns:1fr}#'+MODAL_ID+' .ajk-cover-detail-img{max-width:150px}}' +
      '@media(min-width:900px){#'+GRID_ID+'{gap:30px 24px}}';
    document.head.appendChild(style);
  }

  function bookNodes(wrap) {
    // Build the cover grid from the ACTUAL rendered book list, not from the
    // jump-list and not from a broad document.getElementById lookup. Singles
    // are .book-card elements with their own id; series are one .book-card
    // container whose individual volumes carry the book-card-* ids inside it.
    // Flatten those two shapes in DOM order and de-duplicate by anchor id.
    var ordered = [];
    var seen = {};

    function add(node) {
      if (!node || !node.id || node.id.indexOf('book-card-') !== 0 || seen[node.id]) return;
      seen[node.id] = true;
      ordered.push(node);
    }

    Array.prototype.forEach.call(wrap.children || [], function (card) {
      if (!card.classList || !card.classList.contains('book-card')) return;
      if (card.id && card.id.indexOf('book-card-') === 0) {
        add(card);
        return;
      }
      Array.prototype.forEach.call(card.querySelectorAll('[id^="book-card-"]'), add);
    });

    // Fallback for any future template shape that is not a direct child.
    if (!ordered.length) {
      Array.prototype.forEach.call(wrap.querySelectorAll('[id^="book-card-"]'), add);
    }
    return ordered;
  }

  function titleOf(card) {
    // The anchor id is generated directly from the canonical book title and is
    // therefore safer than reading the first heading inside a grouped/updated
    // card. Mobile DOM reconciliation can temporarily leave a neighbouring
    // heading/image inside a card while ids already point at the new book.
    var raw = (card && card.id ? card.id : '').replace(/^book-card-/, '');
    if (raw) {
      try { return decodeURIComponent(raw); } catch (_) { return raw; }
    }
    var h = card && card.querySelector ? card.querySelector('h3,h2,h4') : null;
    return h && h.textContent.trim() ? h.textContent.trim() : '';
  }

  function exactCoverImage_(wrap, title, card) {
    var wanted = (title + ' cover').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    var all = wrap ? wrap.querySelectorAll('img[alt]') : [];
    for (var i = 0; i < all.length; i++) {
      var alt = (all[i].getAttribute('alt') || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (alt === wanted) return all[i];
    }
    return card && card.querySelector ? card.querySelector('img') : null;
  }

  function dataFor(card, wrap) {
    var title = titleOf(card);
    var titleNodes = card.querySelectorAll('h3,h2,h4');
    var titleNode = null;
    for (var ti = 0; ti < titleNodes.length; ti++) {
      if ((titleNodes[ti].textContent || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase() === title.replace(/\s+/g, ' ').trim().toLocaleLowerCase()) {
        titleNode = titleNodes[ti];
        break;
      }
    }
    if (!titleNode) titleNode = card.querySelector('h3,h2,h4');
    var img = exactCoverImage_(wrap, title, card);
    var hook = '';
    if (titleNode) {
      var n = titleNode.nextElementSibling;
      while (n && !hook) {
        if (n.tagName === 'P' && n.textContent.trim()) hook = n.textContent.trim();
        n = n.nextElementSibling;
      }
    }
    var meta = '';
    if (titleNode && titleNode.previousElementSibling && titleNode.previousElementSibling.tagName === 'SPAN') {
      meta = titleNode.previousElementSibling.textContent.trim();
    }
    var actions = Array.prototype.slice.call(card.querySelectorAll('a')).filter(function (a) {
      return /^(Read|EPUB|Background|Video|Alt\. covers)$/i.test(a.textContent.trim());
    });
    return { card: card, id: card.id, title: title, src: img ? img.src : '', hook: hook, meta: meta, actions: actions };
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

  function buildGrid(wrap) {
    var grid = document.getElementById(GRID_ID);
    if (!grid) {
      grid = document.createElement('div');
      grid.id = GRID_ID;
      wrap.parentNode.insertBefore(grid, wrap);
    }
    var seenTitles = {};
    var books = bookNodes(wrap).map(function (node) { return dataFor(node, wrap); }).filter(function (book) {
      var key = (book.title || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (!key || seenTitles[key]) return false;
      seenTitles[key] = true;
      return true;
    });
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
    injectStyles();
    buildGrid(wrap);
    var button = document.querySelector('[' + TOGGLE_ATTR + ']');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.setAttribute(TOGGLE_ATTR, '1');
      button.setAttribute('aria-pressed', 'false');
      button.textContent = t('Nur Cover', 'Covers only');
      button.addEventListener('click', function () { setMode(!active); });
      var old = document.querySelector('.book-view-toggle');
      if (old && old.parentNode) old.parentNode.insertBefore(button, old.nextSibling);
      else wrap.parentNode.insertBefore(button, wrap);
      ensureColumnChooser(button);
      try { if (localStorage.getItem('ajk_book_cover_view') === '1') setMode(true); } catch (_) {}
    } else {
      ensureColumnChooser(button);
    }
    return true;
  }

  function start() {
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
