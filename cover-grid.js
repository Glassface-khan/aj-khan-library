(function () {
  'use strict';

  var GRID_ID = 'ajk-cover-grid';
  var TOGGLE_ATTR = 'data-ajk-cover-grid-toggle';
  var MODAL_ID = 'ajk-cover-detail-modal';
  var active = false;
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
      '#' + GRID_ID + '{display:none;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:24px 18px;padding:28px 0 44px;align-items:start}' +
      '#' + GRID_ID + '.is-open{display:grid}' +
      '.ajk-cover-thumb{appearance:none;border:0;background:none;padding:0;cursor:pointer;min-width:0;text-align:left}' +
      '.ajk-cover-frame{display:block;width:100%;aspect-ratio:2/3;overflow:hidden;background:var(--bone-deep,#e9e3d7);border:1px solid var(--rule,#cfc6b5);box-shadow:0 8px 22px rgba(0,0,0,.10);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}' +
      '.ajk-cover-thumb:hover .ajk-cover-frame,.ajk-cover-thumb:focus-visible .ajk-cover-frame{transform:translateY(-4px);border-color:var(--gold,#b89448);box-shadow:0 14px 30px rgba(0,0,0,.16)}' +
      '.ajk-cover-frame img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.ajk-cover-placeholder{height:100%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:12px;font-family:"Cormorant Garamond",serif;font-size:15px;line-height:1.15;color:var(--ink-2,#555);text-align:center}' +
      '[' + TOGGLE_ATTR + ']{white-space:nowrap;background:none;border:1px solid var(--rule);color:var(--ink-2);font-family:"Archivo",sans-serif;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;cursor:pointer;margin:0 0 14px}' +
      '[' + TOGGLE_ATTR + '][aria-pressed="true"]{border-color:var(--gold);color:var(--gold);background:rgba(212,175,55,.07)}' +
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
      '@media(max-width:640px){#'+GRID_ID+'{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px 10px;padding-top:18px}#'+MODAL_ID+'{padding:12px}#'+MODAL_ID+' .ajk-cover-detail{padding:18px}#'+MODAL_ID+' .ajk-cover-detail-body{grid-template-columns:105px minmax(0,1fr);gap:16px}#'+MODAL_ID+' .ajk-cover-detail-hook{font-size:15px}}' +
      '@media(max-width:380px){#'+GRID_ID+'{grid-template-columns:repeat(2,minmax(0,1fr))}#'+MODAL_ID+' .ajk-cover-detail-body{grid-template-columns:1fr}#'+MODAL_ID+' .ajk-cover-detail-img{max-width:150px}}' +
      '@media(min-width:900px){#'+GRID_ID+'{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:30px 24px}}';
    document.head.appendChild(style);
  }

  function bookNodes(wrap) {
    var seen = {};
    return Array.prototype.slice.call(wrap.querySelectorAll('[id^="book-card-"]')).filter(function (node) {
      if (!node.id || seen[node.id]) return false;
      seen[node.id] = true;
      return true;
    });
  }

  function titleOf(card) {
    var h = card.querySelector('h3,h2,h4');
    if (h && h.textContent.trim()) return h.textContent.trim();
    var raw = card.id.replace(/^book-card-/, '');
    try { return decodeURIComponent(raw); } catch (_) { return raw; }
  }

  function dataFor(card) {
    var titleNode = card.querySelector('h3,h2,h4');
    var img = card.querySelector('img');
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
    return { card: card, id: card.id, title: titleOf(card), src: img ? img.src : '', hook: hook, meta: meta, actions: actions };
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
    var books = bookNodes(wrap).map(dataFor);
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

  function setMode(on) {
    active = !!on;
    var wrap = listWrap();
    if (!wrap) return;
    var grid = buildGrid(wrap);
    wrap.style.display = active ? 'none' : '';
    grid.classList.toggle('is-open', active);
    var button = document.querySelector('[' + TOGGLE_ATTR + ']');
    if (button) button.setAttribute('aria-pressed', active ? 'true' : 'false');
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
      try { if (localStorage.getItem('ajk_book_cover_view') === '1') setMode(true); } catch (_) {}
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
