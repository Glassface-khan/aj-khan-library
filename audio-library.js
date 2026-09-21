(() => {
  'use strict';

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbwcbRDaWkM1wf3MV_dj4RPw9jQl2Fgc4YfGcmFrGU1S243yvh8WGW7mbyXLbSeVJKI/exec';
  const AUDIO_API = 'https://ipoqyjrojljmbqslmxxf.supabase.co/functions/v1/audio-library';
  const ROOT_ID = 'ajk-audio-root';


  // Inline EPUB compatibility layer.
  // Apple Books renders our premium EPUBs correctly, but epub.js in iOS
  // Safari can re-insert a non-linear cover page in continuous mode after
  // the title page was already visible. A dark cover then looks like an
  // empty black reader. Some premium EPUBs also carry their own dark-mode
  // CSS. This shim changes only the web reader; it never modifies the EPUB.
  function installEpubReaderCompatibility_() {
    const originalEpub = window.ePub;
    if (typeof originalEpub !== 'function') return false;
    if (originalEpub.__ajkIosReaderCompat) return true;

    const wrappedEpub = function() {
      const book = originalEpub.apply(this, arguments);
      if (!book || typeof book.renderTo !== 'function' || book.__ajkRenderCompat) return book;

      const originalRenderTo = book.renderTo.bind(book);
      book.renderTo = function(target, options) {
        const rendition = originalRenderTo(target, options);

        try {
          if (rendition && rendition.hooks && rendition.hooks.content) {
            rendition.hooks.content.register((contents) => {
              try {
                const doc = contents && contents.document;
                if (!doc || !doc.body) return;

                const isCoverDoc =
                  ((doc.title || '').trim().toLowerCase() === 'cover') ||
                  !!doc.querySelector('.cover-page');

                if (isCoverDoc) {
                  doc.documentElement.style.setProperty('background', 'transparent', 'important');
                  doc.body.style.setProperty('background', 'transparent', 'important');
                  doc.body.style.setProperty('margin', '0', 'important');
                  doc.body.style.setProperty('min-height', '0', 'important');
                  doc.body.style.setProperty('height', '0', 'important');
                  doc.body.style.setProperty('overflow', 'hidden', 'important');
                  const cover = doc.querySelector('.cover-page');
                  if (cover) cover.style.setProperty('display', 'none', 'important');
                  return;
                }

                // Premium EPUBs use real-book page-break rules (correct in
                // Apple Books/Kindle) that iOS Safari can apply late inside
                // epub.js continuous/scrolled mode. Inline !important wins
                // even if the EPUB stylesheet finishes loading afterwards,
                // preventing the visible title/chapter from being pushed onto
                // a phantom blank page. This changes only the web rendition.
                doc.querySelectorAll('.title,.dedication,.epigraph,.part,.front,.back,.chapter')
                  .forEach((el) => {
                    el.style.setProperty('break-before', 'auto', 'important');
                    el.style.setProperty('page-break-before', 'auto', 'important');
                    el.style.setProperty('-webkit-column-break-before', 'auto', 'important');
                  });

                const style = doc.createElement('style');
                style.setAttribute('data-ajk-reader-theme', 'light');
                style.textContent =
                  'html,body{background:#fbf7ef!important;color:#27221e!important;}' +
                  'h1,h2,h3,h4,h5,h6{color:#332922!important;}';
                (doc.head || doc.documentElement).appendChild(style);
              } catch (err) {}
            });
          }

          if (rendition && typeof rendition.display === 'function') {
            const originalDisplay = rendition.display.bind(rendition);
            rendition.display = function(location) {
              let targetLocation = location;
              if (!targetLocation && book.spine && book.spine.items) {
                const firstLinear = book.spine.items.find((item) => item && item.linear !== 'no');
                if (firstLinear && firstLinear.href) targetLocation = firstLinear.href;
              }
              return originalDisplay(targetLocation);
            };
          }
        } catch (err) {}

        return rendition;
      };

      book.__ajkRenderCompat = true;
      return book;
    };

    try {
      Object.keys(originalEpub).forEach((key) => {
        try { wrappedEpub[key] = originalEpub[key]; } catch (err) {}
      });
    } catch (err) {}

    wrappedEpub.__ajkIosReaderCompat = true;
    wrappedEpub.__ajkOriginal = originalEpub;
    window.ePub = wrappedEpub;
    return true;
  }

  function scheduleEpubReaderCompatibility_() {
    if (installEpubReaderCompatibility_()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (installEpubReaderCompatibility_() || attempts >= 240) clearInterval(timer);
    }, 250);
  }

  scheduleEpubReaderCompatibility_();

  const state = {
    open: false,
    loading: false,
    error: '',
    catalog: [],
    listenerName: '',
    activeBook: null,
    activeChapter: null,
    desiredSeek: 0,
    adminMode: false,
    adminPeople: [],
    adminBooks: [],
    adminLoading: false,
    saveTimer: null,
    lastSavedAt: 0,
    lastSavedPosition: -1,
    audio: null
  };

  const tr = (de, en) => ((localStorage.getItem('ajk_ui_lang') || 'de') === 'en' ? en : de);

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const formatTime = (seconds) => {
    const n = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
      : m + ':' + String(s).padStart(2, '0');
  };

  function credentials() {
    let access = {};
    try { access = JSON.parse(localStorage.getItem('ajk_visitor_access') || '{}') || {}; } catch (_) {}
    const isAdmin = localStorage.getItem('ajk_author_admin') === '1';
    return {
      code: isAdmin ? '' : String(access.code || ''),
      adminToken: isAdmin ? String(localStorage.getItem('ajk_admin_token') || '') : '',
      isAdmin
    };
  }

  function isEligible() {
    const c = credentials();
    return !!(c.adminToken || c.code);
  }

  async function api(payload, options = {}) {
    const c = credentials();
    const res = await fetch(AUDIO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      keepalive: !!options.keepalive,
      body: JSON.stringify({ ...payload, code: c.code, adminToken: c.adminToken })
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data.ok) {
      const err = new Error(data.error || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function gas(params) {
    const body = new URLSearchParams();
    Object.keys(params).forEach((k) => body.set(k, params[k] == null ? '' : String(params[k])));
    const res = await fetch(GAS_URL, { method: 'POST', body, cache: 'no-store' });
    const data = await res.json();
    if (!data || !data.ok) throw new Error((data && data.error) || 'request_failed');
    return data;
  }

  function ensureStyles() {
    if (document.getElementById('ajk-audio-styles')) return;
    const style = document.createElement('style');
    style.id = 'ajk-audio-styles';
    style.textContent = `
      #ajk-audio-launch {
        position:fixed; right:max(18px, env(safe-area-inset-right)); bottom:max(18px, env(safe-area-inset-bottom));
        z-index:9997; border:1px solid var(--ink,#16140F); background:var(--ink,#16140F); color:var(--bone,#E6E2D7);
        font-family:'Archivo',sans-serif; font-size:11px; letter-spacing:.14em; text-transform:uppercase;
        padding:12px 16px; cursor:pointer; box-shadow:0 7px 24px rgba(22,20,15,.18);
        display:flex; align-items:center; gap:8px;
      }
      #ajk-audio-launch[hidden]{display:none!important}
      #${ROOT_ID}{position:fixed; inset:0; z-index:9998; display:none}
      #${ROOT_ID}.open{display:block}
      .ajka-backdrop{position:absolute; inset:0; background:rgba(19,27,36,.64); backdrop-filter:blur(5px)}
      .ajka-panel{
        position:absolute; right:0; top:0; bottom:0; width:min(620px,100vw);
        background:var(--bone,#E6E2D7); color:var(--ink,#16140F);
        box-shadow:-18px 0 50px rgba(0,0,0,.24); overflow:auto; overscroll-behavior:contain;
        padding:calc(28px + env(safe-area-inset-top)) 28px calc(34px + env(safe-area-inset-bottom));
      }
      .ajka-head{display:flex; align-items:flex-start; justify-content:space-between; gap:20px; border-bottom:1px solid var(--rule,#CBC1A6); padding-bottom:20px; margin-bottom:24px}
      .ajka-kicker,.ajka-label{font-family:'Archivo',sans-serif; font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--gold,#9F7A34)}
      .ajka-title{font-family:'Cormorant Garamond','Newsreader',serif; font-size:38px; line-height:1.05; font-weight:400; margin:5px 0 0}
      .ajka-close{background:transparent; border:1px solid var(--rule,#CBC1A6); width:38px; height:38px; cursor:pointer; color:var(--ink,#16140F); font-size:22px}
      .ajka-toolbar{display:flex; flex-wrap:wrap; gap:8px; margin:-8px 0 22px}
      .ajka-smallbtn,.ajka-action{
        border:1px solid var(--ink,#16140F); background:transparent; color:var(--ink,#16140F); cursor:pointer;
        font-family:'Archivo',sans-serif; font-size:10px; letter-spacing:.1em; text-transform:uppercase; padding:9px 12px
      }
      .ajka-action.primary{background:var(--ink,#16140F); color:var(--bone,#E6E2D7)}
      .ajka-muted{color:var(--ink-3,#7A7263); font-size:14px; line-height:1.55}
      .ajka-error{border:1px solid #9f4a3c; color:#7f3429; padding:12px 14px; font-size:14px; margin:0 0 18px}
      .ajka-book{border-top:1px solid var(--rule,#CBC1A6); padding:18px 0; display:grid; grid-template-columns:72px 1fr auto; gap:16px; align-items:center}
      .ajka-cover{width:72px; height:100px; object-fit:cover; background:var(--bone-deep,#D9D4C4); border:1px solid var(--rule,#CBC1A6)}
      .ajka-cover-fallback{width:72px; height:100px; border:1px solid var(--rule,#CBC1A6); display:flex; align-items:center; justify-content:center; text-align:center; padding:7px; font-family:'Cormorant Garamond',serif; font-size:13px; background:var(--bone-deep,#D9D4C4)}
      .ajka-book-title{font-family:'Cormorant Garamond','Newsreader',serif; font-size:23px; line-height:1.1; margin:0 0 5px}
      .ajka-meta{font-family:'Archivo',sans-serif; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3,#7A7263)}
      .ajka-continue{font-size:13px; color:var(--ink-2,#514A3E); margin-top:7px}
      .ajka-player{border:1px solid var(--rule,#CBC1A6); background:rgba(255,255,255,.13); padding:20px; margin:0 0 26px}
      .ajka-player-title{font-family:'Cormorant Garamond','Newsreader',serif; font-size:29px; line-height:1.12; margin:0 0 5px}
      .ajka-chapter{font-size:14px; color:var(--ink-2,#514A3E); margin:0 0 15px}
      .ajka-controls{display:flex; align-items:center; justify-content:center; gap:12px; margin:12px 0}
      .ajka-round{width:43px; height:43px; border-radius:50%; border:1px solid var(--ink,#16140F); background:transparent; color:var(--ink,#16140F); cursor:pointer; font-size:14px}
      .ajka-round.play{width:54px; height:54px; background:var(--ink,#16140F); color:var(--bone,#E6E2D7); font-size:20px}
      .ajka-seek{width:100%; accent-color:var(--gold,#9F7A34)}
      .ajka-time{display:flex; justify-content:space-between; font-family:'Archivo',sans-serif; font-size:10px; color:var(--ink-3,#7A7263); margin-top:4px}
      .ajka-select{width:100%; margin-top:14px; padding:10px; background:transparent; border:1px solid var(--rule,#CBC1A6); color:var(--ink,#16140F); font:14px 'Newsreader',serif}
      .ajka-admin-person{border-top:1px solid var(--rule,#CBC1A6); padding:15px 0}
      .ajka-admin-name{font-family:'Cormorant Garamond',serif; font-size:21px; margin-bottom:10px}
      .ajka-checks{display:grid; grid-template-columns:1fr; gap:8px}
      .ajka-check{display:flex; align-items:flex-start; gap:9px; font-size:13px; line-height:1.35}
      .ajka-check input{margin-top:2px}
      .ajka-saved{font-family:'Archivo',sans-serif; font-size:10px; color:#4f6d45; margin-left:8px}
      .ajka-spinner{padding:34px 0; text-align:center; color:var(--ink-3,#7A7263)}
      @media(max-width:600px){
        #ajk-audio-launch{right:14px; bottom:calc(14px + env(safe-area-inset-bottom)); padding:11px 13px}
        .ajka-panel{width:100vw; padding-left:18px; padding-right:18px}
        .ajka-title{font-size:33px}
        .ajka-book{grid-template-columns:58px 1fr; gap:12px}
        .ajka-cover,.ajka-cover-fallback{width:58px;height:82px}
        .ajka-book .ajka-action{grid-column:2; justify-self:start}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureShell() {
    ensureStyles();
    let launch = document.getElementById('ajk-audio-launch');
    if (!launch) {
      launch = document.createElement('button');
      launch.id = 'ajk-audio-launch';
      launch.type = 'button';
      launch.innerHTML = '<span aria-hidden="true">◉</span><span>' + esc(tr('Hören', 'Listen')) + '</span>';
      launch.addEventListener('click', open);
      document.body.appendChild(launch);
    }

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = '<div class="ajka-backdrop" data-close></div><section class="ajka-panel" role="dialog" aria-modal="true" aria-label="Audiobooks"></section>';
      root.querySelector('[data-close]').addEventListener('click', close);
      document.body.appendChild(root);
    }
    launch.hidden = !isEligible();
    return root;
  }

  async function loadCatalog() {
    state.loading = true;
    state.error = '';
    render();
    try {
      const data = await api({ op: 'catalog' });
      state.catalog = data.books || [];
      state.listenerName = data.listenerName || '';
      if (state.activeBook) {
        state.activeBook = state.catalog.find((b) => b.id === state.activeBook.id) || null;
      }
    } catch (err) {
      state.error = friendlyError(err);
    } finally {
      state.loading = false;
      render();
    }
  }

  function friendlyError(err) {
    const m = String(err && err.message || '');
    if (m === 'unauthorized' || (err && err.status === 401)) return tr('Dein Zugang ist nicht mehr gültig. Bitte melde dich auf der Autorenseite erneut an.', 'Your access is no longer valid. Please sign in to the author site again.');
    if (m === 'forbidden' || (err && err.status === 403)) return tr('Für dieses Hörbuch ist dein Zugang nicht freigeschaltet.', 'Your access does not include this audiobook.');
    if (m === 'access_service_unavailable' || m === 'access_service_invalid_response' || m === 'unknown_operation') return tr('Das Audio-Modul des Backends ist noch nicht live geschaltet.', 'The audio backend module has not been deployed yet.');
    return tr('Audio konnte gerade nicht geladen werden. Bitte versuche es erneut.', 'Audio could not be loaded right now. Please try again.');
  }

  function open() {
    if (!isEligible()) return;
    state.open = true;
    state.adminMode = false;
    const root = ensureShell();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    render();
    loadCatalog();
  }

  function close() {
    saveProgress(false, true);
    state.open = false;
    state.adminMode = false;
    const root = ensureShell();
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
  }

  function progressText(book) {
    const p = book.progress;
    if (!p || !p.chapter_id) return '';
    const ch = (book.chapters || []).find((x) => x.id === p.chapter_id);
    if (!ch) return '';
    return tr('Weiter bei ', 'Continue at ') + esc(ch.title) + ' · ' + formatTime(p.position_seconds);
  }

  function renderLibrary(panel) {
    const c = credentials();
    const adminButton = c.isAdmin
      ? '<button class="ajka-smallbtn" id="ajka-admin-rights">' + esc(tr('Audio-Rechte', 'Audio access')) + '</button>'
      : '';

    const error = state.error ? '<div class="ajka-error">' + esc(state.error) + '</div>' : '';
    const player = state.activeBook ? playerHtml() : '';

    let list = '';
    if (state.loading) {
      list = '<div class="ajka-spinner">' + esc(tr('Hörbücher werden geladen …', 'Loading audiobooks …')) + '</div>';
    } else if (!state.catalog.length && !state.error) {
      list = '<p class="ajka-muted">' + esc(tr('Noch sind keine Hörbücher in der Audio-Bibliothek veröffentlicht.', 'No audiobooks have been published in the audio library yet.')) + '</p>';
    } else {
      list = state.catalog.map((b) => {
        const cover = b.cover_url
          ? '<img class="ajka-cover" src="' + esc(b.cover_url) + '" alt="">'
          : '<div class="ajka-cover-fallback">' + esc(b.title) + '</div>';
        const ptxt = progressText(b);
        return '<article class="ajka-book">' +
          cover +
          '<div><h3 class="ajka-book-title">' + esc(b.title) + '</h3>' +
          '<div class="ajka-meta">' + esc(b.language_code || '') +
          (b.total_duration_seconds ? ' · ' + esc(formatTime(b.total_duration_seconds)) : '') +
          (b.narrator_name ? ' · ' + esc(b.narrator_name) : '') + '</div>' +
          (ptxt ? '<div class="ajka-continue">' + ptxt + '</div>' : '') +
          '</div>' +
          '<button class="ajka-action primary" data-book="' + esc(b.id) + '">' +
            esc(ptxt ? tr('Weiterhören', 'Continue') : tr('Hören', 'Listen')) +
          '</button></article>';
      }).join('');
    }

    panel.innerHTML =
      '<div class="ajka-head"><div><div class="ajka-kicker">A. J. Khan</div><h2 class="ajka-title">' + esc(tr('Audio-Bibliothek', 'Audio Library')) + '</h2></div>' +
      '<button class="ajka-close" id="ajka-close" aria-label="' + esc(tr('Schließen', 'Close')) + '">×</button></div>' +
      '<div class="ajka-toolbar">' + adminButton + '<button class="ajka-smallbtn" id="ajka-refresh">' + esc(tr('Aktualisieren', 'Refresh')) + '</button></div>' +
      error + player + list;

    panel.querySelector('#ajka-close').addEventListener('click', close);
    panel.querySelector('#ajka-refresh').addEventListener('click', loadCatalog);
    const admin = panel.querySelector('#ajka-admin-rights');
    if (admin) admin.addEventListener('click', openAdmin);
    panel.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', () => startBook(btn.getAttribute('data-book'))));
    wirePlayer(panel);
  }

  function playerHtml() {
    const b = state.activeBook;
    const ch = state.activeChapter || {};
    const chapters = b.chapters || [];
    const opts = chapters.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === ch.id ? ' selected' : '') + '>' + esc((Number(x.chapter_index) + 1) + '. ' + x.title) + '</option>').join('');
    return '<section class="ajka-player">' +
      '<div class="ajka-label">' + esc(tr('Jetzt hören', 'Now listening')) + '</div>' +
      '<h3 class="ajka-player-title">' + esc(b.title) + '</h3>' +
      '<p class="ajka-chapter" id="ajka-current-chapter">' + esc(ch.title || tr('Kapitel wählen', 'Choose a chapter')) + '</p>' +
      '<input class="ajka-seek" id="ajka-seek" type="range" min="0" max="1000" value="0" aria-label="' + esc(tr('Position', 'Position')) + '">' +
      '<div class="ajka-time"><span id="ajka-now">0:00</span><span id="ajka-duration">' + esc(formatTime(ch.duration_seconds || 0)) + '</span></div>' +
      '<div class="ajka-controls">' +
        '<button class="ajka-round" id="ajka-back" aria-label="-15 Sekunden">−15</button>' +
        '<button class="ajka-round play" id="ajka-play" aria-label="' + esc(tr('Wiedergabe', 'Play')) + '">▶</button>' +
        '<button class="ajka-round" id="ajka-forward" aria-label="+15 Sekunden">+15</button>' +
        '<button class="ajka-round" id="ajka-speed" aria-label="' + esc(tr('Geschwindigkeit', 'Speed')) + '">1×</button>' +
      '</div>' +
      '<select class="ajka-select" id="ajka-chapter-select" aria-label="' + esc(tr('Kapitel', 'Chapter')) + '">' + opts + '</select>' +
      '</section>';
  }

  function wirePlayer(panel) {
    if (!state.activeBook) return;
    const play = panel.querySelector('#ajka-play');
    const seek = panel.querySelector('#ajka-seek');
    const select = panel.querySelector('#ajka-chapter-select');
    if (!play || !seek || !select) return;

    play.addEventListener('click', async () => {
      if (!state.activeChapter) return startBook(state.activeBook.id);
      if (!state.audio || !state.audio.src) return loadChapter(state.activeBook, state.activeChapter, 0, true);
      if (state.audio.paused) {
        try { await state.audio.play(); } catch (_) {}
      } else {
        state.audio.pause();
      }
      updatePlayerUi();
    });

    panel.querySelector('#ajka-back').addEventListener('click', () => {
      if (state.audio) state.audio.currentTime = Math.max(0, state.audio.currentTime - 15);
    });
    panel.querySelector('#ajka-forward').addEventListener('click', () => {
      if (state.audio) state.audio.currentTime = Math.min(state.audio.duration || Infinity, state.audio.currentTime + 15);
    });
    panel.querySelector('#ajka-speed').addEventListener('click', cycleSpeed);

    seek.addEventListener('input', () => {
      if (!state.audio || !Number.isFinite(state.audio.duration) || state.audio.duration <= 0) return;
      state.audio.currentTime = (Number(seek.value) / 1000) * state.audio.duration;
    });

    select.addEventListener('change', () => {
      const ch = (state.activeBook.chapters || []).find((x) => x.id === select.value);
      if (ch) loadChapter(state.activeBook, ch, 0, true);
    });

    updatePlayerUi();
  }

  async function startBook(bookId) {
    const book = state.catalog.find((b) => b.id === bookId);
    if (!book || !(book.chapters || []).length) return;
    state.activeBook = book;

    let chapter = book.chapters[0];
    let seek = 0;
    if (book.progress && book.progress.chapter_id) {
      chapter = book.chapters.find((x) => x.id === book.progress.chapter_id) || chapter;
      seek = Number(book.progress.position_seconds || 0);
    }
    state.activeChapter = chapter;
    render();
    await loadChapter(book, chapter, seek, true, Number(book.progress && book.progress.playback_rate || 1));
  }

  function ensureAudio() {
    if (state.audio) return state.audio;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('timeupdate', () => {
      updatePlayerUi();
      if (Date.now() - state.lastSavedAt > 15000) saveProgress(false, false);
    });
    audio.addEventListener('play', updatePlayerUi);
    audio.addEventListener('pause', () => { updatePlayerUi(); saveProgress(false, false); });
    audio.addEventListener('loadedmetadata', () => {
      if (state.desiredSeek > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(state.desiredSeek, Math.max(0, audio.duration - .25));
      }
      state.desiredSeek = 0;
      updatePlayerUi();
    });
    audio.addEventListener('ended', onEnded);
    state.audio = audio;
    return audio;
  }

  async function loadChapter(book, chapter, seek = 0, autoplay = false, rate = null) {
    state.error = '';
    state.activeBook = book;
    state.activeChapter = chapter;
    state.desiredSeek = Math.max(0, Number(seek) || 0);
    render();
    try {
      const data = await api({ op: 'chapterUrl', chapterId: chapter.id });
      const audio = ensureAudio();
      audio.src = data.url;
      if (rate != null) audio.playbackRate = Math.min(3, Math.max(.5, Number(rate) || 1));
      audio.load();
      if (autoplay) {
        try { await audio.play(); } catch (_) {}
      }
      updatePlayerUi();
    } catch (err) {
      state.error = friendlyError(err);
      render();
    }
  }

  function updatePlayerUi() {
    if (!state.open || state.adminMode) return;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const audio = state.audio;
    const play = root.querySelector('#ajka-play');
    const seek = root.querySelector('#ajka-seek');
    const now = root.querySelector('#ajka-now');
    const duration = root.querySelector('#ajka-duration');
    const speed = root.querySelector('#ajka-speed');
    if (play) play.textContent = audio && !audio.paused ? '❚❚' : '▶';
    if (audio && seek && Number.isFinite(audio.duration) && audio.duration > 0) seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    if (now) now.textContent = formatTime(audio ? audio.currentTime : 0);
    if (duration) duration.textContent = formatTime(audio && Number.isFinite(audio.duration) ? audio.duration : (state.activeChapter && state.activeChapter.duration_seconds || 0));
    if (speed) speed.textContent = (audio ? audio.playbackRate : 1).toFixed((audio && audio.playbackRate % 1) ? 2 : 0).replace(/0$/, '') + '×';
  }

  function cycleSpeed() {
    const audio = ensureAudio();
    const speeds = [.75, 1, 1.25, 1.5, 1.75, 2];
    let idx = speeds.findIndex((x) => Math.abs(x - audio.playbackRate) < .01);
    idx = (idx + 1) % speeds.length;
    audio.playbackRate = speeds[idx];
    updatePlayerUi();
    saveProgress(false, false);
  }

  async function onEnded() {
    if (!state.activeBook || !state.activeChapter) return;
    const chapters = state.activeBook.chapters || [];
    const idx = chapters.findIndex((x) => x.id === state.activeChapter.id);
    const last = idx < 0 || idx >= chapters.length - 1;
    await saveProgress(last, false);
    if (!last) {
      await loadChapter(state.activeBook, chapters[idx + 1], 0, true);
    } else {
      await loadCatalog();
    }
  }

  async function saveProgress(completed = false, keepalive = false) {
    if (!state.activeBook || !state.activeChapter || !state.audio) return;
    const pos = Math.max(0, Number(state.audio.currentTime) || 0);
    if (!completed && Math.abs(pos - state.lastSavedPosition) < 1 && Date.now() - state.lastSavedAt < 30000) return;
    state.lastSavedAt = Date.now();
    state.lastSavedPosition = pos;
    try {
      await api({
        op: 'saveProgress',
        chapterId: state.activeChapter.id,
        positionSeconds: pos,
        playbackRate: state.audio.playbackRate || 1,
        completed: !!completed
      }, { keepalive });
      if (state.activeBook.progress) {
        state.activeBook.progress.chapter_id = state.activeChapter.id;
        state.activeBook.progress.position_seconds = pos;
        state.activeBook.progress.playback_rate = state.audio.playbackRate || 1;
        state.activeBook.progress.completed = !!completed;
      } else {
        state.activeBook.progress = {
          chapter_id: state.activeChapter.id,
          position_seconds: pos,
          playback_rate: state.audio.playbackRate || 1,
          completed: !!completed
        };
      }
    } catch (_) {}
  }

  async function openAdmin() {
    state.adminMode = true;
    state.adminLoading = true;
    state.error = '';
    render();
    try {
      const c = credentials();
      if (!c.isAdmin || !c.adminToken) throw new Error('unauthorized');
      const [peopleData, booksData] = await Promise.all([
        gas({ action: 'getAudioAccessList', adminToken: c.adminToken }),
        gas({ action: 'getBooks' })
      ]);
      state.adminPeople = peopleData.people || [];
      let books = [];
      try { books = JSON.parse(booksData.books || '[]'); } catch (_) {}
      const seen = new Set();
      state.adminBooks = books.map((b) => String(b.title || '').trim()).filter((t) => t && !seen.has(t) && seen.add(t));
    } catch (err) {
      state.error = friendlyError(err);
    } finally {
      state.adminLoading = false;
      render();
    }
  }

  function renderAdmin(panel) {
    const error = state.error ? '<div class="ajka-error">' + esc(state.error) + '</div>' : '';
    let body = '';
    if (state.adminLoading) {
      body = '<div class="ajka-spinner">' + esc(tr('Zugriffsrechte werden geladen …', 'Loading access rights …')) + '</div>';
    } else if (!state.adminPeople.length && !state.error) {
      body = '<p class="ajka-muted">' + esc(tr('Keine bestehenden Zugänge gefunden.', 'No existing access users found.')) + '</p>';
    } else {
      body = state.adminPeople.map((p, pi) => {
        const access = p.audioAccess || {};
        const checks = state.adminBooks.map((title, bi) =>
          '<label class="ajka-check"><input type="checkbox" data-pi="' + pi + '" data-bi="' + bi + '"' + (access[title] ? ' checked' : '') + '><span>' + esc(title) + '</span></label>'
        ).join('');
        return '<section class="ajka-admin-person"><div class="ajka-admin-name">' + esc(p.name || tr('Unbenannt', 'Unnamed')) + '<span class="ajka-saved" id="ajka-saved-' + pi + '"></span></div>' +
          '<div class="ajka-checks">' + checks + '</div>' +
          '<button class="ajka-action" data-save-person="' + pi + '" style="margin-top:12px">' + esc(tr('Speichern', 'Save')) + '</button></section>';
      }).join('');
    }

    panel.innerHTML =
      '<div class="ajka-head"><div><div class="ajka-kicker">A. J. Khan</div><h2 class="ajka-title">' + esc(tr('Audio-Rechte', 'Audio Access')) + '</h2></div>' +
      '<button class="ajka-close" id="ajka-close" aria-label="' + esc(tr('Schließen', 'Close')) + '">×</button></div>' +
      '<div class="ajka-toolbar"><button class="ajka-smallbtn" id="ajka-back-library">← ' + esc(tr('Bibliothek', 'Library')) + '</button></div>' +
      '<p class="ajka-muted">' + esc(tr('Diese Freigaben gelten für dieselben Personen und Zugangscodes wie auf der Autorenseite. Es wird kein zweites Benutzerkonto angelegt.', 'These permissions use the same people and access codes as the author site. No second user account is created.')) + '</p>' +
      error + body;

    panel.querySelector('#ajka-close').addEventListener('click', close);
    panel.querySelector('#ajka-back-library').addEventListener('click', () => { state.adminMode = false; state.error = ''; render(); });
    panel.querySelectorAll('[data-save-person]').forEach((btn) => btn.addEventListener('click', () => savePerson(Number(btn.getAttribute('data-save-person')))));
  }

  async function savePerson(pi) {
    const p = state.adminPeople[pi];
    if (!p) return;
    const root = document.getElementById(ROOT_ID);
    const checks = root.querySelectorAll('input[data-pi="' + pi + '"]');
    const map = {};
    checks.forEach((cb) => {
      if (!cb.checked) return;
      const title = state.adminBooks[Number(cb.getAttribute('data-bi'))];
      if (title) map[title] = true;
    });
    const c = credentials();
    try {
      await gas({
        action: 'setAudioAccess',
        adminToken: c.adminToken,
        code: p.code,
        audioAccess: JSON.stringify(map)
      });
      p.audioAccess = map;
      const saved = document.getElementById('ajka-saved-' + pi);
      if (saved) {
        saved.textContent = tr('Gespeichert ✓', 'Saved ✓');
        setTimeout(() => { if (saved) saved.textContent = ''; }, 1800);
      }
    } catch (err) {
      state.error = friendlyError(err);
      render();
    }
  }

  function render() {
    const root = ensureShell();
    const panel = root.querySelector('.ajka-panel');
    if (!panel) return;
    if (state.adminMode) renderAdmin(panel);
    else renderLibrary(panel);
  }

  function syncVisibility() {
    const root = ensureShell();
    const launch = document.getElementById('ajk-audio-launch');
    if (launch) launch.hidden = !isEligible();
    if (!isEligible() && state.open) close();
  }

  // ---------------------------------------------------------------------------
  // Inline-EPUB-Reader compatibility
  //
  // Premium EPUBs can contain their own dark-mode CSS. Apple Books handles
  // those packages correctly, but iOS Safari + epub.js may evaluate the EPUB's
  // prefers-color-scheme inside its generated iframe independently from the
  // author site's light reading surface. The result is effectively dark text
  // on a dark background even though the EPUB itself is valid.
  //
  // Do not touch the EPUB file. Instead, normalize only the embedded reader
  // iframe to a neutral paper surface. This keeps the original EPUB intact for
  // Apple Books/Kindle and affects only the website preview.
  function installEpubReaderCompatibility() {
    const STYLE_ID = 'ajk-epub-readable-theme';

    function patchFrame(frame) {
      try {
        const doc = frame && frame.contentDocument;
        if (!doc || !doc.documentElement || !doc.head) return;

        doc.documentElement.style.setProperty('background', '#fbf7ef', 'important');
        doc.documentElement.style.setProperty('color', '#27221e', 'important');
        doc.documentElement.style.setProperty('color-scheme', 'light', 'important');
        if (doc.body) {
          doc.body.style.setProperty('background', '#fbf7ef', 'important');
          doc.body.style.setProperty('color', '#27221e', 'important');
          doc.body.style.setProperty('color-scheme', 'light', 'important');
        }

        let style = doc.getElementById(STYLE_ID);
        if (!style) {
          style = doc.createElement('style');
          style.id = STYLE_ID;
          style.textContent = [
            'html,body{background:#fbf7ef!important;color:#27221e!important;color-scheme:light!important;}',
            'p,div,span,section,article,main,header,footer,li,blockquote,pre,code,h1,h2,h3,h4,h5,h6,em,strong,small,sub,sup,a{color:#27221e!important;}',
            'a{background-color:transparent!important;}',
            'img,svg,video{color:initial!important;}'
          ].join('');
          doc.head.appendChild(style);
        }
      } catch (_) {
        // Some foreign-origin frames may be unreadable; epub.js book frames
        // created from our in-memory EPUB are same-origin in supported browsers.
      }
    }

    function scan() {
      const viewport = document.getElementById('epub-reader-viewport');
      if (!viewport) return;
      viewport.querySelectorAll('iframe').forEach((frame) => {
        patchFrame(frame);
        if (frame.dataset.ajkReadableBound === '1') return;
        frame.dataset.ajkReadableBound = '1';
        frame.addEventListener('load', () => {
          patchFrame(frame);
          setTimeout(() => patchFrame(frame), 80);
        });
      });
    }

    const observer = new MutationObserver(() => window.requestAnimationFrame(scan));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();
    // epub.js may recycle iframe contents without replacing the iframe node.
    // A light periodic re-check catches those navigations without touching data.
    setInterval(scan, 1200);
  }

  installEpubReaderCompatibility();

  window.addEventListener('pagehide', () => saveProgress(false, true));
  window.addEventListener('beforeunload', () => saveProgress(false, true));
  window.addEventListener('storage', syncVisibility);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureShell();
      syncVisibility();
      setInterval(syncVisibility, 2000);
    });
  } else {
    ensureShell();
    syncVisibility();
    setInterval(syncVisibility, 2000);
  }
})();
