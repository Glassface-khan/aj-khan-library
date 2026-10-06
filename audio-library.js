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
        const isIOSWebKit =
          /iP(?:hone|ad|od)/.test(navigator.userAgent || '') ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // AJK stable reader baseline (23.09.2026):
        // use the same tested paginated/default mode on every browser.
        // The previous split kept desktop browsers on the legacy
        // scrolled/continuous path, which can also collapse into a blank
        // viewport after the reader shell has opened.
        const renderOptions = Object.assign({}, options || {});
        renderOptions.manager = 'default';
        renderOptions.flow = 'paginated';

        const rendition = originalRenderTo(target, renderOptions);

        if (isIOSWebKit) {
          try {
            const viewport = (typeof target === 'string')
              ? (document.getElementById(target.replace(/^#/, '')) || document.querySelector(target))
              : target;

            if (viewport && !viewport.querySelector('[data-ajk-page-nav]')) {
              const computed = window.getComputedStyle(viewport);
              if (computed.position === 'static') viewport.style.position = 'relative';

              const makeZone = (side, label, go) => {
                const zone = document.createElement('button');
                zone.type = 'button';
                zone.setAttribute('data-ajk-page-nav', side);
                zone.setAttribute('aria-label', label);
                zone.textContent = side === 'left' ? '‹' : '›';
                zone.style.position = 'fixed';
                zone.style.zIndex = '9996';
                zone.style.width = '28px';
                zone.style.height = '54px';
                zone.style.padding = '0';
                zone.style.border = '0';
                zone.style.borderRadius = '14px';
                zone.style.background = 'rgba(230,226,215,.10)';
                zone.style.color = 'rgba(230,226,215,.72)';
                zone.style.font = '400 34px/1 Georgia,serif';
                zone.style.opacity = '.82';
                zone.style.webkitTapHighlightColor = 'transparent';
                zone.style.touchAction = 'manipulation';

                const place = () => {
                  const rect = viewport.getBoundingClientRect();
                  zone.style.top = Math.round(rect.top + rect.height / 2 - 27) + 'px';
                  if (side === 'left') {
                    zone.style.left = Math.max(4, Math.round(rect.left - 34)) + 'px';
                    zone.style.right = 'auto';
                  } else {
                    zone.style.right = Math.max(4, Math.round(window.innerWidth - rect.right - 34)) + 'px';
                    zone.style.left = 'auto';
                  }
                };

                place();
                window.addEventListener('resize', place, { passive: true });
                window.addEventListener('orientationchange', place, { passive: true });

                zone.addEventListener('click', (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  try { go(); } catch (err) {}
                });

                // Keep controls outside the EPUB viewport so they never cover
                // book text. Fixed positioning places them in the dark margins.
                document.body.appendChild(zone);
              };

              makeZone('left', 'Vorherige Seite', () => rendition.prev());
              makeZone('right', 'Nächste Seite', () => rendition.next());

              let startX = 0;
              let startY = 0;
              viewport.addEventListener('touchstart', (ev) => {
                const t = ev.touches && ev.touches[0];
                if (!t) return;
                startX = t.clientX;
                startY = t.clientY;
              }, { passive: true });

              viewport.addEventListener('touchend', (ev) => {
                const t = ev.changedTouches && ev.changedTouches[0];
                if (!t) return;
                const dx = t.clientX - startX;
                const dy = t.clientY - startY;
                if (Math.abs(dx) < 55 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
                try {
                  if (dx < 0) rendition.next();
                  else rendition.prev();
                } catch (err) {}
              }, { passive: true });
            }
          } catch (err) {}
        }

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

                // Remove any legacy section-navigation controls injected by
                // earlier experimental iOS reader builds. Premium EPUBs remain
                // untouched; this affects only the inline web rendition.
                doc.querySelectorAll('[data-ajk-section-nav]').forEach((el) => el.remove());

                const style = doc.createElement('style');
                style.setAttribute('data-ajk-reader-theme', 'light');
                style.textContent =
                  'html,body{background:#fbf7ef!important;color:#27221e!important;}' +
                  'h1,h2,h3,h4,h5,h6{color:#332922!important;}' +
                  '[data-ajk-section-nav]{display:none!important;}';
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

  function loadReaderScript_(src, readyCheck) {
    return new Promise((resolve, reject) => {
      if (readyCheck()) { resolve(true); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => readyCheck()
        ? resolve(true)
        : reject(new Error('Reader library loaded but did not initialize.'));
      script.onerror = () => reject(new Error('Reader library failed to load.'));
      document.head.appendChild(script);
    });
  }

  async function ensureEpubReaderRuntime_() {
    if (typeof window.ePub === 'function') {
      installEpubReaderCompatibility_();
      return true;
    }

    try {
      // Archived EPUBs need JSZip. The page normally loads both libraries
      // from jsDelivr in <head>; these alternate CDNs are a lazy fallback
      // for iOS/Safari/content blockers when that primary request fails.
      if (typeof window.JSZip === 'undefined') {
        try {
          await loadReaderScript_(
            'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
            () => typeof window.JSZip !== 'undefined'
          );
        } catch (_) {
          await loadReaderScript_(
            'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
            () => typeof window.JSZip !== 'undefined'
          );
        }
      }

      try {
        await loadReaderScript_(
          'https://unpkg.com/epubjs@0.3.93/dist/epub.min.js',
          () => typeof window.ePub === 'function'
        );
      } catch (_) {
        await loadReaderScript_(
          'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
          () => typeof window.ePub === 'function'
        );
      }

      installEpubReaderCompatibility_();
      return typeof window.ePub === 'function';
    } catch (_) {
      return false;
    }
  }

  function scheduleEpubReaderCompatibility_() {
    // Start the fallback immediately instead of only polling for a library
    // that may never arrive. This fixes the misleading READ alert on iOS
    // where an existing EPUB looked like "no reading access" solely because
    // window.ePub was missing.
    ensureEpubReaderRuntime_();
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
    libraryFilter: 'all',
    librarySearch: '',
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
    audio: null,
    playbackRate: (() => {
      try {
        const stored = Number(localStorage.getItem('ajk_audio_playback_rate') || 1);
        return Number.isFinite(stored) ? Math.min(2, Math.max(.5, stored)) : 1;
      } catch (_) {
        return 1;
      }
    })()
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
      factorySession: isAdmin ? String(localStorage.getItem('ajk_factory_session') || '') : '',
      isAdmin
    };
  }

  function isEligible() {
    const c = credentials();
    return !!(c.adminToken || c.code || c.factorySession);
  }

  async function api(payload, options = {}) {
    const c = credentials();
    const res = await fetch(AUDIO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      keepalive: !!options.keepalive,
      body: JSON.stringify({ ...payload, code: c.code, adminToken: c.adminToken, factorySession: c.factorySession })
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
      #${ROOT_ID}{position:fixed; inset:0; z-index:100000; display:none}
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
      .ajka-speed-control{display:grid; grid-template-columns:auto minmax(150px,1fr) 58px; align-items:center; gap:12px; margin:12px 0 16px; font-size:13px}
      .ajka-speed-slider{width:100%; height:36px; margin:0; padding:0; accent-color:var(--gold,#9F7A34); touch-action:pan-y}
      .ajka-speed-slider::-webkit-slider-runnable-track{height:6px; border-radius:999px; background:rgba(159,122,52,.22)}
      .ajka-speed-slider::-webkit-slider-thumb{-webkit-appearance:none; width:26px; height:26px; margin-top:-10px; border-radius:50%; background:var(--gold,#9F7A34); border:0; box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .ajka-speed-slider{-webkit-appearance:none; appearance:none; background:transparent}
      .ajka-speed-slider::-moz-range-track{height:6px; border-radius:999px; background:rgba(159,122,52,.22)}
      .ajka-speed-slider::-moz-range-thumb{width:26px; height:26px; border:0; border-radius:50%; background:var(--gold,#9F7A34)}
      .ajka-speed-value{text-align:right; font-variant-numeric:tabular-nums; font-weight:600}
      .ajka-time{display:flex; justify-content:space-between; font-family:'Archivo',sans-serif; font-size:10px; color:var(--ink-3,#7A7263); margin-top:4px}
      .ajka-select{width:100%; margin-top:14px; padding:10px; background:transparent; border:1px solid var(--rule,#CBC1A6); color:var(--ink,#16140F); font:14px 'Newsreader',serif}
      .ajka-admin-person{border-top:1px solid var(--rule,#CBC1A6); padding:15px 0}
      .ajka-admin-name{font-family:'Cormorant Garamond',serif; font-size:21px; margin-bottom:10px}
      .ajka-checks{display:grid; grid-template-columns:1fr; gap:8px}
      .ajka-check{display:flex; align-items:flex-start; gap:9px; font-size:13px; line-height:1.35}
      .ajka-check input{margin-top:2px}
      .ajka-saved{font-family:'Archivo',sans-serif; font-size:10px; color:#4f6d45; margin-left:8px}
      .ajka-spinner{padding:34px 0; text-align:center; color:var(--ink-3,#7A7263)}
      .ajka-library-controls{margin:0 0 26px}
      .ajka-filter-row{display:flex; gap:7px; overflow-x:auto; padding:1px 0 9px; -webkit-overflow-scrolling:touch; scrollbar-width:none}
      .ajka-filter-row::-webkit-scrollbar{display:none}
      .ajka-filter-chip{flex:0 0 auto; border:1px solid var(--rule,#CBC1A6); background:rgba(255,255,255,.08); color:var(--ink,#16140F); font-family:'Archivo',sans-serif; font-size:10px; letter-spacing:.07em; text-transform:uppercase; padding:9px 12px; cursor:pointer; border-radius:999px}
      .ajka-filter-chip.active{background:var(--ink,#16140F); color:var(--bone,#E6E2D7); border-color:var(--ink,#16140F)}
      .ajka-search-row{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px}
      .ajka-search{min-width:0; border:1px solid var(--rule,#CBC1A6); background:rgba(255,255,255,.12); color:var(--ink,#16140F); padding:10px 12px; font:14px 'Newsreader',serif; border-radius:0; -webkit-appearance:none}
      .ajka-search::placeholder{color:var(--ink-3,#7A7263)}
      .ajka-library-section{margin:0 0 34px}
      .ajka-section-title{font-family:'Cormorant Garamond','Newsreader',serif; font-size:27px; line-height:1.05; font-weight:400; margin:0 0 14px}
      .ajka-series-shelf{border:1px solid var(--rule,#CBC1A6); background:rgba(255,255,255,.09); padding:18px 16px 15px; margin:0 0 16px; border-radius:14px; overflow:hidden}
      .ajka-series-head{display:flex; align-items:flex-end; justify-content:space-between; gap:14px; margin:0 2px 15px}
      .ajka-series-title{font-family:'Cormorant Garamond','Newsreader',serif; font-size:26px; line-height:1; font-weight:500; margin:4px 0 0; letter-spacing:.01em}
      .ajka-series-count{font-family:'Archivo',sans-serif; font-size:9px; line-height:1.35; letter-spacing:.07em; text-transform:uppercase; color:var(--ink-3,#7A7263); text-align:right}
      .ajka-series-rail{display:flex; gap:16px; overflow-x:auto; padding:3px 2px 9px; position:relative; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; scrollbar-width:thin}
      .ajka-series-rail::before{content:''; position:absolute; left:16px; right:16px; top:77px; height:1px; background:linear-gradient(90deg,transparent,var(--gold,#9F7A34) 9%,var(--gold,#9F7A34) 91%,transparent); opacity:.35; pointer-events:none}
      .ajka-series-book{flex:0 0 122px; position:relative; z-index:1; scroll-snap-align:start}
      .ajka-series-cover-button{display:block; width:112px; margin:0 auto; padding:0; border:0; background:transparent; color:inherit; cursor:pointer; text-align:left}
      .ajka-series-cover-wrap{display:block; width:112px; height:158px; position:relative; background:var(--bone-deep,#D9D4C4); box-shadow:0 7px 18px rgba(22,20,15,.15)}
      .ajka-series-cover{display:block; width:112px; height:158px; object-fit:cover; border:1px solid var(--rule,#CBC1A6); background:var(--bone-deep,#D9D4C4)}
      .ajka-series-cover-fallback{display:flex; align-items:center; justify-content:center; padding:9px; text-align:center; font-family:'Cormorant Garamond',serif; font-size:14px}
      .ajka-volume-badge{position:absolute; top:7px; left:7px; min-width:42px; padding:5px 7px; border-radius:999px; background:rgba(22,20,15,.87); color:var(--bone,#E6E2D7); font-family:'Archivo',sans-serif; font-size:9px; line-height:1; letter-spacing:.08em; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .ajka-series-progress-dot{position:absolute; right:8px; bottom:8px; width:9px; height:9px; border-radius:50%; background:var(--gold,#9F7A34); border:2px solid rgba(230,226,215,.92); box-sizing:content-box}
      .ajka-series-book-title{font-family:'Cormorant Garamond','Newsreader',serif; font-size:18px; line-height:1.05; font-weight:500; margin:10px 5px 4px}
      .ajka-series-book-meta{font-family:'Archivo',sans-serif; font-size:8px; line-height:1.3; letter-spacing:.05em; text-transform:uppercase; color:var(--ink-3,#7A7263); margin:0 5px 8px; min-height:20px}
      .ajka-series-listen{margin:0 5px; padding:0 0 3px; border:0; border-bottom:1px solid var(--gold,#9F7A34); background:transparent; color:var(--ink,#16140F); font-family:'Archivo',sans-serif; font-size:9px; letter-spacing:.08em; text-transform:uppercase; cursor:pointer}
      .ajka-player-voice{font-family:'Archivo',sans-serif; font-size:9px; letter-spacing:.07em; text-transform:uppercase; color:var(--ink-3,#7A7263); margin:1px 0 12px}
      .ajka-voice-control{display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; align-items:center; margin:4px 0 13px; font-family:'Archivo',sans-serif; font-size:9px; letter-spacing:.07em; text-transform:uppercase; color:var(--ink-3,#7A7263)}
      .ajka-voice-control .ajka-select{margin:0; font-size:13px; text-transform:none; letter-spacing:0}
      .ajka-empty-filter{border-top:1px solid var(--rule,#CBC1A6); padding-top:18px}

      @media(max-width:600px){
        #ajk-audio-launch{right:14px; bottom:calc(14px + env(safe-area-inset-bottom)); padding:11px 13px}
        .ajka-panel{width:100vw; padding-left:18px; padding-right:18px}
        .ajka-title{font-size:33px}
        .ajka-book{grid-template-columns:58px 1fr; gap:12px}
        .ajka-cover,.ajka-cover-fallback{width:58px;height:82px}
        .ajka-book .ajka-action{grid-column:2; justify-self:start}
        .ajka-series-shelf{margin-left:-4px; margin-right:-4px; padding-left:12px; padding-right:12px}
        .ajka-series-book{flex-basis:112px}
        .ajka-series-cover-button,.ajka-series-cover-wrap,.ajka-series-cover{width:104px}
        .ajka-series-cover-wrap,.ajka-series-cover{height:147px}
        .ajka-series-rail::before{top:72px}
        .ajka-search-row{grid-template-columns:1fr}
        .ajka-search-row .ajka-smallbtn{justify-self:start}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureShell() {
    ensureStyles();
    const oldLaunch = document.getElementById('ajk-audio-launch');
    if (oldLaunch) oldLaunch.remove();

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = '<div class="ajka-backdrop" data-close></div><section class="ajka-panel" role="dialog" aria-modal="true" aria-label="Audiobooks"></section>';
      root.querySelector('[data-close]').addEventListener('click', close);
      document.body.appendChild(root);
    }
    return root;
  }

  const normAudioTitle_ = (v) => String(v || '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();

  function audioBooksFor_(siteBookId, title, languageCode) {
    const id = String(siteBookId || '').trim();
    const lang = String(languageCode || '').toUpperCase();
    let matches = id ? state.catalog.filter((b) => String(b.site_book_id || '') === id) : [];
    if (!matches.length) {
      const wanted = normAudioTitle_(title);
      matches = state.catalog.filter((b) => normAudioTitle_(b.title) === wanted);
    }
    if (lang) matches = matches.filter((b) => String(b.language_code || '').toUpperCase() === lang);
    return matches.slice().sort((x, y) => String(x.narrator_name || '').localeCompare(String(y.narrator_name || '')));
  }

  function audioBookFor_(siteBookId, title, languageCode) {
    return audioBooksFor_(siteBookId, title, languageCode)[0] || null;
  }

  function audioBookForTitle_(title, languageCode) {
    return audioBookFor_('', title, languageCode);
  }

  function publishAudioCatalog_() {
    try {
      window.__ajkAudioCatalog = state.catalog.slice();
      window.dispatchEvent(new CustomEvent('ajk-audio-catalog-updated', {
        detail: { books: state.catalog.slice() }
      }));
    } catch (_) {}
  }

  async function loadCatalog(options = {}) {
    const silent = options && options.silent === true;
    state.loading = true;
    state.error = '';
    if (!silent && state.open) render();
    try {
      const data = await api({ op: 'catalog' });
      state.catalog = data.books || [];
      state.listenerName = data.listenerName || '';
      if (state.activeBook) {
        state.activeBook = state.catalog.find((b) => b.id === state.activeBook.id) || null;
      }
      publishAudioCatalog_();
    } catch (err) {
      state.error = friendlyError(err);
      if (!silent) publishAudioCatalog_();
    } finally {
      state.loading = false;
      if (!silent && state.open) render();
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

  function libraryGroupKey_(book) {
    const siteId = String(book && book.site_book_id || '').trim();
    if (siteId) return siteId;
    return normAudioTitle_(book && book.title) + '|' + String(book && book.language_code || '').toUpperCase();
  }

  function groupedLibraryBooks_() {
    const byKey = new Map();
    for (const book of state.catalog) {
      const key = libraryGroupKey_(book);
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          site_book_id: String(book.site_book_id || ''),
          title: String(book.title || ''),
          language_code: String(book.language_code || ''),
          cover_url: String(book.cover_url || ''),
          series_key: String(book.series_key || ''),
          series_title: String(book.series_title || ''),
          series_number: Number(book.series_number || 0) || 0,
          series_total: Number(book.series_total || 0) || 0,
          editions: []
        };
        byKey.set(key, group);
      }
      group.editions.push(book);
      if (!group.cover_url && book.cover_url) group.cover_url = String(book.cover_url);
      if (!group.series_key && book.series_key) group.series_key = String(book.series_key);
      if (!group.series_title && book.series_title) group.series_title = String(book.series_title);
      if (!group.series_number && Number(book.series_number)) group.series_number = Number(book.series_number);
      if (!group.series_total && Number(book.series_total)) group.series_total = Number(book.series_total);
    }

    const groups = Array.from(byKey.values());
    groups.forEach((group) => {
      group.editions.sort((a, b) => String(a.narrator_name || '').localeCompare(String(b.narrator_name || '')));
    });
    return groups;
  }

  function preferredEdition_(group) {
    const unfinished = (group.editions || []).filter((book) =>
      book.progress && book.progress.chapter_id && book.progress.completed !== true
    ).sort((a, b) => String(b.progress && b.progress.updated_at || '').localeCompare(String(a.progress && a.progress.updated_at || '')));
    return unfinished[0] || (group.editions || [])[0] || null;
  }

  function voiceSummary_(group) {
    const editions = group.editions || [];
    if (editions.length > 1) return editions.length + ' ' + tr('Stimmen', 'voices');
    const book = editions[0];
    return book && book.narrator_name ? String(book.narrator_name) : '';
  }

  function seriesShortTitle_(group) {
    const title = String(group.title || '');
    if (!group.series_title) return title;
    const parts = title.split(/\s+[—–]\s+|\s+:\s+/);
    if (parts.length > 1 && normAudioTitle_(parts[0]) === normAudioTitle_(group.series_title)) {
      return parts.slice(1).join(' — ').trim() || title;
    }
    return title;
  }

  function groupMatchesQuery_(group) {
    const q = normAudioTitle_(state.librarySearch || '');
    if (!q) return true;
    const narrators = (group.editions || []).map((book) => book.narrator_name || '').join(' ');
    return normAudioTitle_([
      group.title,
      group.series_title,
      group.language_code,
      narrators
    ].join(' ')).includes(q);
  }

  function groupMatchesFilter_(group) {
    if (!groupMatchesQuery_(group)) return false;
    const filter = String(state.libraryFilter || 'all');
    if (filter === 'series') return !!group.series_key;
    if (filter === 'single') return !group.series_key;
    if (filter === 'DE' || filter === 'EN') return String(group.language_code || '').toUpperCase() === filter;
    return true;
  }

  function renderCoverForGroup_(group, compact) {
    if (group.cover_url) {
      return '<img class="' + (compact ? 'ajka-series-cover' : 'ajka-cover') + '" src="' + esc(group.cover_url) + '" alt="">';
    }
    return '<div class="' + (compact ? 'ajka-series-cover ajka-series-cover-fallback' : 'ajka-cover-fallback') + '">' + esc(seriesShortTitle_(group)) + '</div>';
  }

  function renderListBook_(group) {
    const book = preferredEdition_(group);
    if (!book) return '';
    const ptxt = progressText(book);
    const voice = voiceSummary_(group);
    return '<article class="ajka-book">' +
      renderCoverForGroup_(group, false) +
      '<div><h3 class="ajka-book-title">' + esc(group.title) + '</h3>' +
      '<div class="ajka-meta">' + esc(group.language_code || '') +
      (book.total_duration_seconds ? ' · ' + esc(formatTime(book.total_duration_seconds)) : '') +
      (voice ? ' · ' + esc(voice) : '') + '</div>' +
      (ptxt ? '<div class="ajka-continue">' + ptxt + '</div>' : '') +
      '</div>' +
      '<button class="ajka-action primary" data-book="' + esc(book.id) + '">' +
        esc(ptxt ? tr('Weiterhören', 'Continue') : tr('Hören', 'Listen')) +
      '</button></article>';
  }

  function renderSeriesBook_(group) {
    const book = preferredEdition_(group);
    if (!book) return '';
    const n = Number(group.series_number || 0);
    const total = Number(group.series_total || 0);
    const badge = n
      ? String(n).padStart(2, '0') + (total ? ' · ' + String(total).padStart(2, '0') : '')
      : '';
    const ptxt = progressText(book);
    const voice = voiceSummary_(group);
    return '<article class="ajka-series-book">' +
      '<button class="ajka-series-cover-button" data-book="' + esc(book.id) + '" aria-label="' + esc(group.title + ' — ' + tr('Hören', 'Listen')) + '">' +
        '<span class="ajka-series-cover-wrap">' +
          renderCoverForGroup_(group, true) +
          (badge ? '<span class="ajka-volume-badge">' + esc(badge) + '</span>' : '') +
          (ptxt ? '<span class="ajka-series-progress-dot" aria-hidden="true"></span>' : '') +
        '</span>' +
      '</button>' +
      '<h4 class="ajka-series-book-title">' + esc(seriesShortTitle_(group)) + '</h4>' +
      '<div class="ajka-series-book-meta">' + esc(voice || group.language_code || '') + '</div>' +
      '<button class="ajka-series-listen" data-book="' + esc(book.id) + '">' +
        esc(ptxt ? tr('Weiterhören', 'Continue') : tr('Hören', 'Listen')) +
      '</button>' +
    '</article>';
  }

  function renderSeriesShelf_(title, groups) {
    const sorted = groups.slice().sort((a, b) => {
      const an = Number(a.series_number || 0);
      const bn = Number(b.series_number || 0);
      if (an && bn && an !== bn) return an - bn;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
    const total = Math.max(...sorted.map((g) => Number(g.series_total || 0)), sorted.length);
    const available = sorted.length;
    const countText = total + ' ' + tr(total === 1 ? 'Band' : 'Bände', total === 1 ? 'volume' : 'volumes') +
      (available < total ? ' · ' + available + ' ' + tr('verfügbar', 'available') : '');
    return '<section class="ajka-series-shelf">' +
      '<div class="ajka-series-head"><div><div class="ajka-label">' + esc(tr('Reihe', 'Series')) + '</div>' +
      '<h3 class="ajka-series-title">' + esc(title) + '</h3></div>' +
      '<div class="ajka-series-count">' + esc(countText) + '</div></div>' +
      '<div class="ajka-series-rail">' + sorted.map(renderSeriesBook_).join('') + '</div>' +
    '</section>';
  }

  function renderLibraryControls_() {
    const filters = [
      ['all', tr('Alle', 'All')],
      ['series', tr('Reihen', 'Series')],
      ['single', tr('Einzelbände', 'Standalone')],
      ['DE', 'Deutsch'],
      ['EN', 'English']
    ];
    const buttons = filters.map(([key, label]) =>
      '<button class="ajka-filter-chip' + (state.libraryFilter === key ? ' active' : '') + '" data-audio-filter="' + esc(key) + '">' + esc(label) + '</button>'
    ).join('');
    return '<div class="ajka-library-controls">' +
      '<div class="ajka-filter-row">' + buttons + '</div>' +
      '<div class="ajka-search-row">' +
        '<input id="ajka-library-search" class="ajka-search" type="search" value="' + esc(state.librarySearch || '') + '" placeholder="' + esc(tr('Titel, Reihe oder Stimme', 'Title, series or voice')) + '">' +
        '<button class="ajka-smallbtn" id="ajka-search-go">' + esc(tr('Suchen', 'Search')) + '</button>' +
      '</div>' +
    '</div>';
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
      const allGroups = groupedLibraryBooks_();
      const groups = allGroups.filter(groupMatchesFilter_);
      const continuing = groups.filter((group) => {
        const book = preferredEdition_(group);
        return !!(book && book.progress && book.progress.chapter_id && book.progress.completed !== true);
      }).sort((a, b) => {
        const ap = preferredEdition_(a);
        const bp = preferredEdition_(b);
        return String(bp && bp.progress && bp.progress.updated_at || '').localeCompare(String(ap && ap.progress && ap.progress.updated_at || ''));
      });

      const seriesMap = new Map();
      const singles = [];
      groups.forEach((group) => {
        if (group.series_key) {
          const key = group.series_key;
          if (!seriesMap.has(key)) seriesMap.set(key, { title: group.series_title || key, groups: [] });
          seriesMap.get(key).groups.push(group);
        } else {
          singles.push(group);
        }
      });

      const seriesShelves = Array.from(seriesMap.values())
        .sort((a, b) => String(a.title).localeCompare(String(b.title)))
        .map((entry) => renderSeriesShelf_(entry.title, entry.groups))
        .join('');

      singles.sort((a, b) => String(a.title).localeCompare(String(b.title)));

      const continueBlock = continuing.length
        ? '<section class="ajka-library-section"><h3 class="ajka-section-title">' + esc(tr('Weiterhören', 'Continue listening')) + '</h3>' +
          continuing.map(renderListBook_).join('') + '</section>'
        : '';

      const seriesBlock = seriesShelves
        ? '<section class="ajka-library-section"><h3 class="ajka-section-title">' + esc(tr('Meine Reihen', 'My series')) + '</h3>' + seriesShelves + '</section>'
        : '';

      const singlesBlock = singles.length
        ? '<section class="ajka-library-section"><h3 class="ajka-section-title">' + esc(tr('Einzelromane', 'Standalone novels')) + '</h3>' +
          singles.map(renderListBook_).join('') + '</section>'
        : '';

      list = renderLibraryControls_() + continueBlock + seriesBlock + singlesBlock;
      if (!groups.length) {
        list += '<p class="ajka-muted ajka-empty-filter">' + esc(tr('Für diesen Filter wurden keine Hörbücher gefunden.', 'No audiobooks match this filter.')) + '</p>';
      }
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

    panel.querySelectorAll('[data-audio-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.libraryFilter = btn.getAttribute('data-audio-filter') || 'all';
        render();
      });
    });

    const search = panel.querySelector('#ajka-library-search');
    const searchGo = panel.querySelector('#ajka-search-go');
    const applySearch = () => {
      if (!search) return;
      state.librarySearch = String(search.value || '').trim();
      render();
    };
    if (searchGo) searchGo.addEventListener('click', applySearch);
    if (search) {
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applySearch();
        }
      });
      search.addEventListener('search', applySearch);
    }

    wirePlayer(panel);
  }

  function playerHtml() {
    const b = state.activeBook;
    const ch = state.activeChapter || {};
    const chapters = b.chapters || [];
    const opts = chapters.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === ch.id ? ' selected' : '') + '>' + esc((Number(x.chapter_index) + 1) + '. ' + x.title) + '</option>').join('');
    const editions = audioBooksFor_(b.site_book_id, b.title, b.language_code);
    const voicePicker = editions.length > 1
      ? '<div class="ajka-voice-control"><label for="ajka-voice-select">' + esc(tr('Stimme', 'Voice')) + '</label>' +
        '<select class="ajka-select ajka-voice-select" id="ajka-voice-select">' +
        editions.map((edition) => '<option value="' + esc(edition.id) + '"' + (edition.id === b.id ? ' selected' : '') + '>' + esc(edition.narrator_name || edition.voice_key || tr('Stimme', 'Voice')) + '</option>').join('') +
        '</select></div>'
      : (b.narrator_name ? '<div class="ajka-player-voice">' + esc(tr('Stimme', 'Voice')) + ': ' + esc(b.narrator_name) + '</div>' : '');

    return '<section class="ajka-player">' +
      '<div class="ajka-label">' + esc(tr('Jetzt hören', 'Now listening')) + '</div>' +
      '<h3 class="ajka-player-title">' + esc(b.title) + '</h3>' +
      voicePicker +
      '<p class="ajka-chapter" id="ajka-current-chapter">' + esc(ch.title || tr('Kapitel wählen', 'Choose a chapter')) + '</p>' +
      '<input class="ajka-seek" id="ajka-seek" type="range" min="0" max="1000" value="0" aria-label="' + esc(tr('Position', 'Position')) + '">' +
      '<div class="ajka-time"><span id="ajka-now">0:00</span><span id="ajka-duration">' + esc(formatTime(ch.duration_seconds || 0)) + '</span></div>' +
      '<div class="ajka-controls">' +
        '<button class="ajka-round" id="ajka-back" aria-label="-15 Sekunden">−15</button>' +
        '<button class="ajka-round play" id="ajka-play" aria-label="' + esc(tr('Wiedergabe', 'Play')) + '">▶</button>' +
        '<button class="ajka-round" id="ajka-forward" aria-label="+15 Sekunden">+15</button>' +
      '</div>' +
      '<div class="ajka-speed-control">' +
        '<label for="ajka-speed">' + esc(tr('Tempo', 'Speed')) + '</label>' +
        '<input class="ajka-speed-slider" id="ajka-speed" type="range" min="50" max="200" step="1" value="' + Math.round(state.playbackRate * 100) + '" aria-label="' + esc(tr('Wiedergabegeschwindigkeit', 'Playback speed')) + '">' +
        '<span class="ajka-speed-value" id="ajka-speed-value">' + Math.round(state.playbackRate * 100) + '%</span>' +
      '</div>' +
      '<select class="ajka-select" id="ajka-chapter-select" aria-label="' + esc(tr('Kapitel', 'Chapter')) + '">' + opts + '</select>' +
      '</section>';
  }

  function wirePlayer(panel) {
    if (!state.activeBook) return;
    const play = panel.querySelector('#ajka-play');
    const seek = panel.querySelector('#ajka-seek');
    const select = panel.querySelector('#ajka-chapter-select');
    const voice = panel.querySelector('#ajka-voice-select');
    if (!play || !seek || !select) return;

    if (voice) {
      voice.addEventListener('change', async () => {
        if (state.audio && !state.audio.paused) state.audio.pause();
        await saveProgress(false, false, true);
        await startBook(voice.value);
      });
    }

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
    const speed = panel.querySelector('#ajka-speed');
    if (speed) {
      speed.addEventListener('input', () => {
        const audio = ensureAudio();
        const rate = Math.min(2, Math.max(.5, Number(speed.value) / 100 || 1));
        state.playbackRate = rate;
        audio.defaultPlaybackRate = rate;
        audio.playbackRate = rate;
        try { localStorage.setItem('ajk_audio_playback_rate', String(rate)); } catch (_) {}
        const speedValue = panel.querySelector('#ajka-speed-value');
        if (speedValue) speedValue.textContent = Math.round(rate * 100) + '%';
      });
      speed.addEventListener('change', () => saveProgress(false, false, true));
    }

    seek.addEventListener('input', () => {
      if (!state.audio || !Number.isFinite(state.audio.duration) || state.audio.duration <= 0) return;
      state.audio.currentTime = (Number(seek.value) / 1000) * state.audio.duration;
    });

    select.addEventListener('change', () => {
      const ch = (state.activeBook.chapters || []).find((x) => x.id === select.value);
      if (ch) loadChapter(state.activeBook, ch, 0, true, state.playbackRate);
    });

    updatePlayerUi();
  }

  async function openAudioBook(bookId) {
    if (!isEligible()) return false;
    if (!state.catalog.length) await loadCatalog({ silent: true });
    const book = state.catalog.find((b) => String(b.id) === String(bookId));
    if (!book) return false;

    state.open = true;
    state.adminMode = false;
    const root = ensureShell();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    await startBook(book.id);
    return true;
  }

  async function openBook(siteBookId, title, languageCode) {
    if (!state.catalog.length) await loadCatalog({ silent: true });
    const book = audioBookFor_(siteBookId, title, languageCode);
    return book ? openAudioBook(book.id) : false;
  }

  async function openBookByTitle(title, languageCode) {
    return openBook('', title, languageCode);
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
    const savedRate = Number(book.progress && book.progress.playback_rate);
    if (Number.isFinite(savedRate) && savedRate >= .5 && savedRate <= 2) state.playbackRate = savedRate;
    await loadChapter(book, chapter, seek, true, state.playbackRate);
  }

  function ensureAudio() {
    if (state.audio) return state.audio;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.defaultPlaybackRate = state.playbackRate;
    audio.playbackRate = state.playbackRate;
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
      audio.defaultPlaybackRate = state.playbackRate;
      audio.playbackRate = state.playbackRate;
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
      const nextRate = rate != null
        ? Math.min(2, Math.max(.5, Number(rate) || 1))
        : state.playbackRate;
      state.playbackRate = nextRate;
      try { localStorage.setItem('ajk_audio_playback_rate', String(nextRate)); } catch (_) {}
      audio.src = data.url;
      audio.defaultPlaybackRate = nextRate;
      audio.playbackRate = nextRate;
      audio.load();
      audio.defaultPlaybackRate = nextRate;
      audio.playbackRate = nextRate;
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
    const speedValue = root.querySelector('#ajka-speed-value');
    if (play) play.textContent = audio && !audio.paused ? '❚❚' : '▶';
    if (audio && seek && Number.isFinite(audio.duration) && audio.duration > 0) seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    if (now) now.textContent = formatTime(audio ? audio.currentTime : 0);
    if (duration) duration.textContent = formatTime(audio && Number.isFinite(audio.duration) ? audio.duration : (state.activeChapter && state.activeChapter.duration_seconds || 0));
    const rate = audio ? audio.playbackRate : state.playbackRate;
    if (speed) speed.value = String(Math.round(rate * 100));
    if (speedValue) speedValue.textContent = Math.round(rate * 100) + '%';
  }

  async function onEnded() {
    if (!state.activeBook || !state.activeChapter) return;
    const chapters = state.activeBook.chapters || [];
    const idx = chapters.findIndex((x) => x.id === state.activeChapter.id);
    const last = idx < 0 || idx >= chapters.length - 1;
    await saveProgress(last, false);
    if (!last) {
      await loadChapter(state.activeBook, chapters[idx + 1], 0, true, state.playbackRate);
    } else {
      await loadCatalog();
    }
  }

  async function saveProgress(completed = false, keepalive = false, force = false) {
    if (!state.activeBook || !state.activeChapter || !state.audio) return;
    const pos = Math.max(0, Number(state.audio.currentTime) || 0);
    if (!force && !completed && Math.abs(pos - state.lastSavedPosition) < 1 && Date.now() - state.lastSavedAt < 30000) return;
    state.lastSavedAt = Date.now();
    state.lastSavedPosition = pos;
    try {
      await api({
        op: 'saveProgress',
        chapterId: state.activeChapter.id,
        positionSeconds: pos,
        playbackRate: state.playbackRate || state.audio.playbackRate || 1,
        completed: !!completed
      }, { keepalive });
      if (state.activeBook.progress) {
        state.activeBook.progress.chapter_id = state.activeChapter.id;
        state.activeBook.progress.position_seconds = pos;
        state.activeBook.progress.playback_rate = state.playbackRate || state.audio.playbackRate || 1;
        state.activeBook.progress.completed = !!completed;
      } else {
        state.activeBook.progress = {
          chapter_id: state.activeChapter.id,
          position_seconds: pos,
          playback_rate: state.playbackRate || state.audio.playbackRate || 1,
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
    const epubReaderOpen = !!document.getElementById('epub-reader-viewport');
    if (!epubReaderOpen) {
      document.querySelectorAll('[data-ajk-page-nav]').forEach((el) => el.remove());
    }
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

    const observer = new MutationObserver(() => window.requestAnimationFrame(() => {
      scan();
      try { syncVisibility(); } catch (_) {}
    }));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();
    // epub.js may recycle iframe contents without replacing the iframe node.
    // A light periodic re-check catches those navigations without touching data.
    setInterval(scan, 1200);
  }

  installEpubReaderCompatibility();

  window.addEventListener('pagehide', () => saveProgress(false, true));
  window.addEventListener('beforeunload', () => saveProgress(false, true));
  window.addEventListener('storage', () => {
    syncVisibility();
    if (isEligible()) loadCatalog({ silent: true });
  });

  async function openRightsPanel() {
    const creds = credentials();
    if (!creds.isAdmin || !creds.adminToken) {
      window.alert(tr('Admin-Sitzung fehlt. Bitte die Autorenseite neu als Admin öffnen.', 'Admin session missing. Please reopen the author site as admin.'));
      return false;
    }
    state.open = true;
    state.adminMode = true;
    const root = ensureShell();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    render();
    await openAdmin();
    return true;
  }

  window.addEventListener('ajk-open-audio-rights', (event) => {
    try {
      if (event && event.detail && typeof event.detail === 'object') event.detail.handled = true;
      Promise.resolve(openRightsPanel()).catch((err) => {
        state.error = friendlyError(err);
        state.open = true;
        state.adminMode = true;
        const root = ensureShell();
        root.classList.add('open');
        root.setAttribute('aria-hidden', 'false');
        render();
      });
    } catch (err) {
      window.alert(friendlyError(err));
    }
  });

  window.AJKAudioLibrary = {
    refresh: () => loadCatalog({ silent: true }),
    getCatalog: () => state.catalog.slice(),
    findByTitle: (title, languageCode) => audioBookForTitle_(title, languageCode),
    findByBook: (siteBookId, title, languageCode) => audioBookFor_(siteBookId, title, languageCode),
    findAllByBook: (siteBookId, title, languageCode) => audioBooksFor_(siteBookId, title, languageCode),
    openAudioBook,
    openBook,
    openBookByTitle,
    openRights: openRightsPanel
  };

  // data-ajk-audio-rights-capture-v2
  // iOS Safari can occasionally suppress the synthetic click after a tap in
  // a dynamically inserted admin header. Handle pointerup as an additional
  // native path, then swallow the follow-up click with a short debounce.
  let lastRightsLaunchAt_ = 0;
  function launchRightsFromControl_(event) {
    const raw = event && event.target;
    const el = raw && raw.closest ? raw.closest('[data-ajk-audio-rights-launch]') : null;
    if (!el) return;

    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }

    const now = Date.now();
    if (now - lastRightsLaunchAt_ < 450) return;
    lastRightsLaunchAt_ = now;

    Promise.resolve(openRightsPanel()).catch((err) => {
      state.error = friendlyError(err);
      state.open = true;
      state.adminMode = true;
      const root = ensureShell();
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      render();
    });
  }

  document.addEventListener('pointerup', launchRightsFromControl_, true);
  document.addEventListener('click', launchRightsFromControl_, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureShell();
      syncVisibility();
      if (isEligible()) loadCatalog({ silent: true });
      setInterval(syncVisibility, 2000);
    });
  } else {
    ensureShell();
    syncVisibility();
    if (isEligible()) loadCatalog({ silent: true });
    setInterval(syncVisibility, 2000);
  }
})();


/* A. J. Khan · Admin-panel Audiobook Factory launcher */
(() => {
  'use strict';
  const FLAG = 'data-ajk-audiobook-factory-launch';

  function installFactoryLink() {
    try {
      if (localStorage.getItem('ajk_author_admin') !== '1') return;
      if (!localStorage.getItem('ajk_admin_token')) return;
      if (document.querySelector('[' + FLAG + ']')) return;

      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'));
      const heading = headings.find((el) => String(el.textContent || '').trim() === 'Manage site');
      if (!heading || !heading.parentElement) return;

      const header = heading.parentElement;
      let actions = Array.from(header.children).find((el) =>
        el !== heading && el.tagName === 'DIV'
      );

      if (!actions) {
        actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
        const close = Array.from(header.querySelectorAll('button')).find((b) =>
          String(b.textContent || '').trim().toLowerCase() === 'close'
        );
        if (close) {
          actions.appendChild(close);
          header.appendChild(actions);
        } else {
          header.appendChild(actions);
        }
      }

      const a = document.createElement('a');
      a.setAttribute(FLAG, '1');
      a.href = './audiobook-factory.html?v=20261006b';
      a.textContent = 'Audiobook Factory';
      a.style.cssText = [
        'display:inline-block',
        'background:#9F7A34',
        'border:1px solid #9F7A34',
        'color:#E6E2D7',
        'font:600 11px/1.2 Archivo,sans-serif',
        'letter-spacing:.06em',
        'text-transform:uppercase',
        'text-decoration:none',
        'padding:8px 14px',
        'cursor:pointer'
      ].join(';');

      const rights = document.createElement('button');
      rights.type = 'button';
      rights.setAttribute('data-ajk-audio-rights-launch', '1');
      rights.textContent = 'Audio-Rechte';
      rights.style.cssText = [
        'display:inline-block',
        'background:transparent',
        'border:1px solid #9F7A34',
        'color:#9F7A34',
        'font:600 11px/1.2 Archivo,sans-serif',
        'letter-spacing:.06em',
        'text-transform:uppercase',
        'padding:8px 14px',
        'cursor:pointer',
        'position:relative',
        'z-index:3',
        'touch-action:manipulation',
        '-webkit-tap-highlight-color:transparent'
      ].join(';');
      rights.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const detail = { handled: false };
        window.dispatchEvent(new CustomEvent('ajk-open-audio-rights', { detail }));
        if (!detail.handled && window.AJKAudioLibrary && typeof window.AJKAudioLibrary.openRights === 'function') {
          Promise.resolve(window.AJKAudioLibrary.openRights()).catch((err) => {
            window.alert(String((err && err.message) || err || 'Audio-Rechte konnten nicht geöffnet werden.'));
          });
        } else if (!detail.handled) {
          window.alert('Audio-Rechte konnten nicht geöffnet werden. Bitte die Seite einmal neu laden.');
        }
      });

      actions.insertBefore(rights, actions.firstChild);
      actions.insertBefore(a, rights);
    } catch (_) {}
  }

  const observer = new MutationObserver(installFactoryLink);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installFactoryLink);
  } else {
    installFactoryLink();
  }
  window.addEventListener('storage', installFactoryLink);
})();
