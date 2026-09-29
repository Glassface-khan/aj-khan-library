(function () {
  'use strict';

  var STORAGE_KEY = 'ajk_text_contrast';
  var CONTROL_ID = 'ajk-text-contrast-control';
  var STYLE_ID = 'ajk-text-contrast-style';

  function lang_() {
    try { return (localStorage.getItem('ajk_ui_lang') || 'de').toLowerCase(); }
    catch (_) { return 'de'; }
  }

  function t_(de, en) {
    return lang_() === 'en' ? en : de;
  }

  function readMode_() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === 'dark' ? 'dark' : 'soft';
    } catch (_) {
      return 'soft';
    }
  }

  function injectStyle_() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      'html.ajk-text-contrast-dark{--ink:#181511!important;--ink-2:#463e34!important;--muted:#5a5145!important;--text-muted:#5a5145!important;}' +
      'html.ajk-text-contrast-dark body{color:var(--ink,#181511)!important;}' +
      'html.ajk-text-contrast-dark #books input,html.ajk-text-contrast-dark #books textarea,html.ajk-text-contrast-dark #books select{color:#241f19!important;}' +
      'html.ajk-text-contrast-dark #books input::placeholder,html.ajk-text-contrast-dark #books textarea::placeholder{color:#5a5145!important;opacity:1!important;}' +
      'html.ajk-text-contrast-dark #books .book-card p,html.ajk-text-contrast-dark #books .book-card li,html.ajk-text-contrast-dark #books .book-card span{color:inherit;}' +
      '#' + CONTROL_ID + '{display:flex;align-items:center;justify-content:flex-end;gap:9px;margin:8px 0 0 auto;font-family:"Archivo",sans-serif;}' +
      '#' + CONTROL_ID + ' label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2,#555);}' +
      '#' + CONTROL_ID + ' select{height:38px;min-width:112px;padding:0 10px;border:1px solid var(--rule,#cfc6b5);background:var(--bone,#f5f0e6);color:var(--ink,#2b2924);font:11px "Archivo",sans-serif;}' +
      '@media(max-width:640px){#' + CONTROL_ID + '{grid-column:1/-1!important;width:100%;margin:2px 0 0!important;justify-content:flex-end;}#' + CONTROL_ID + ' select{height:44px;min-width:122px;}}';
    document.head.appendChild(style);
  }

  function applyMode_(mode, persist) {
    var dark = mode === 'dark';
    document.documentElement.classList.toggle('ajk-text-contrast-dark', dark);
    document.documentElement.setAttribute('data-ajk-text-contrast', dark ? 'dark' : 'soft');
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'soft'); } catch (_) {}
    }
    var select = document.querySelector('#' + CONTROL_ID + ' select');
    if (select && select.value !== (dark ? 'dark' : 'soft')) select.value = dark ? 'dark' : 'soft';
  }

  function ensureControl_() {
    if (document.getElementById(CONTROL_ID)) return true;
    var toolbar = document.querySelector('.ajk-book-toolbar') || document.querySelector('.ajk-book-tools');
    if (!toolbar) return false;

    var wrap = document.createElement('div');
    wrap.id = CONTROL_ID;

    var label = document.createElement('label');
    label.setAttribute('for', CONTROL_ID + '-select');
    label.textContent = t_('Textkontrast', 'Text contrast');

    var select = document.createElement('select');
    select.id = CONTROL_ID + '-select';
    select.setAttribute('aria-label', t_('Textkontrast', 'Text contrast'));

    var soft = document.createElement('option');
    soft.value = 'soft';
    soft.textContent = t_('Weich', 'Soft');
    select.appendChild(soft);

    var dark = document.createElement('option');
    dark.value = 'dark';
    dark.textContent = t_('Dunkel', 'Dark');
    select.appendChild(dark);

    select.value = readMode_();
    select.addEventListener('change', function () {
      applyMode_(select.value, true);
    });

    wrap.appendChild(label);
    wrap.appendChild(select);
    toolbar.appendChild(wrap);
    return true;
  }

  function start_() {
    injectStyle_();
    applyMode_(readMode_(), false);

    if (ensureControl_()) return;

    var observer = new MutationObserver(function () {
      if (ensureControl_()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(function () {
      try { observer.disconnect(); } catch (_) {}
    }, 20000);
  }

  window.addEventListener('storage', function (event) {
    if (event && event.key === STORAGE_KEY) applyMode_(readMode_(), false);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start_, { once: true });
  } else {
    start_();
  }
})();
