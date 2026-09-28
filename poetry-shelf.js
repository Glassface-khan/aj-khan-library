(function () {
  'use strict';

  var SECTION_ID = 'poems';
  var STYLE_ID = 'ajk-poetry-shelf-style';
  var TOOLBAR_ID = 'ajk-poetry-shelf-toolbar';
  var expanded = false;

  function lang() {
    try { return (localStorage.getItem('ajk_ui_lang') || 'de').toLowerCase(); }
    catch (_) { return 'de'; }
  }

  function t(de, en) { return lang() === 'en' ? en : de; }

  function directChildContaining(container, selector) {
    if (!container) return null;
    var node = container.querySelector(selector);
    while (node && node.parentElement !== container) node = node.parentElement;
    return node && node.parentElement === container ? node : null;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '#'+SECTION_ID+'.ajk-poetry-shelf{padding:52px 0 46px!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-intro{margin-bottom:24px!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-intro>img{width:108px!important}' +
      '#'+TOOLBAR_ID+'{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 0 22px;padding:14px 0;border-top:1px solid rgba(217,186,124,.25);border-bottom:1px solid rgba(217,186,124,.18)}' +
      '#'+TOOLBAR_ID+' .ajk-poetry-count{font-family:"Archivo",sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#BFB6A0}' +
      '#'+TOOLBAR_ID+' button{appearance:none;background:transparent;border:1px solid rgba(217,186,124,.55);color:var(--gold-lit,#d9ba7c);font-family:"Archivo",sans-serif;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;padding:10px 15px;cursor:pointer;white-space:nowrap}' +
      '#'+TOOLBAR_ID+' button:focus-visible{outline:2px solid var(--gold-lit,#d9ba7c);outline-offset:3px}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-toc{display:flex!important;grid-template-columns:none!important;gap:12px!important;overflow-x:auto!important;overflow-y:visible!important;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;margin-bottom:0!important;padding:0 0 8px!important;border-top:0!important;scrollbar-width:thin}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-toc>.poem-toc-card{flex:0 0 238px!important;min-width:0;scroll-snap-align:start;padding:18px 18px 20px!important;border:1px solid rgba(217,186,124,.20)!important;background:rgba(255,255,255,.018)}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-toc>.poem-toc-card h3{font-size:22px!important;margin:6px 0 7px!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-toc>.poem-toc-card p{font-size:14px!important;line-height:1.45!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-full{display:none!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded{padding:96px 0 90px!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-intro{margin-bottom:50px!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-intro>img{width:150px!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-toc{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))!important;gap:0!important;overflow:visible!important;scroll-snap-type:none;margin-bottom:60px!important;padding:0!important;border-top:1px solid rgba(217,186,124,.25)!important}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-toc>.poem-toc-card{display:block;min-width:0;max-width:none;flex:auto!important;scroll-snap-align:none;padding:24px 22px 26px!important;border-top:0!important;border-left:0!important;border-bottom:0!important;background:transparent}' +
      '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-full{display:grid!important}' +
      '@media(max-width:640px){' +
        '#'+SECTION_ID+'.ajk-poetry-shelf{padding:38px 0 36px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf>div{padding-left:20px!important;padding-right:20px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-intro{grid-template-columns:76px minmax(0,1fr)!important;gap:18px!important;margin-bottom:20px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-intro>img{width:76px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-intro h2{font-size:30px!important;line-height:1.04!important;margin-bottom:10px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-intro p{font-size:14.5px!important;line-height:1.5!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-intro span{margin-bottom:9px!important}' +
        '#'+TOOLBAR_ID+'{margin-bottom:16px;padding:11px 0;gap:10px}' +
        '#'+TOOLBAR_ID+' button{min-height:44px;padding:10px 13px}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf .ajk-poetry-toc>.poem-toc-card{flex-basis:min(76vw,270px)!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded{padding:58px 0 54px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-intro{grid-template-columns:92px minmax(0,1fr)!important;margin-bottom:34px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-intro>img{width:92px!important}' +
        '#'+SECTION_ID+'.ajk-poetry-shelf.ajk-poetry-expanded .ajk-poetry-toc{grid-template-columns:1fr!important;margin-bottom:42px!important}' +
      '}' +
      '@media(max-width:390px){' +
        '#'+TOOLBAR_ID+'{align-items:stretch;flex-direction:column}' +
        '#'+TOOLBAR_ID+' button{width:100%}' +
      '}';
    document.head.appendChild(style);
  }

  function poemCount(toc) {
    if (!toc) return 0;
    var titles = {};
    Array.prototype.forEach.call(toc.querySelectorAll('.poem-toc-panel button'), function (button) {
      var title = (button.textContent || '').trim();
      if (title) titles[title] = true;
    });
    return Object.keys(titles).length;
  }

  function setExpanded(section, button, on) {
    expanded = !!on;
    section.classList.toggle('ajk-poetry-expanded', expanded);
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.textContent = expanded
      ? t('Kompakt anzeigen', 'Compact view')
      : t('Alle Gedichte', 'View all poems');
  }

  function enhance() {
    var section = document.getElementById(SECTION_ID);
    if (!section || section.dataset.ajkPoetryShelf === '1') return !!section;

    var container = section.firstElementChild;
    if (!container) return false;

    var intro = directChildContaining(container, 'h2');
    var toc = directChildContaining(container, '.poem-toc-card');
    var full = directChildContaining(container, '.poem-scroll-area');
    if (!intro || !toc || !full) return false;

    section.dataset.ajkPoetryShelf = '1';
    section.classList.add('ajk-poetry-shelf');
    intro.classList.add('ajk-poetry-intro');
    toc.classList.add('ajk-poetry-toc');
    full.classList.add('ajk-poetry-full');
    injectStyles();

    var toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;

    var count = document.createElement('span');
    count.className = 'ajk-poetry-count';
    var total = poemCount(toc);
    count.textContent = total
      ? total + ' ' + t('Gedichte · vier Teile', 'poems · four movements')
      : t('Vier Teile · ausgewählte Gedichte', 'Four movements · selected poems');

    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-controls', SECTION_ID);
    button.setAttribute('aria-expanded', 'false');
    button.textContent = t('Alle Gedichte', 'View all poems');
    button.addEventListener('click', function () {
      setExpanded(section, button, !expanded);
      if (!expanded) {
        try { section.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
      }
    });

    toolbar.appendChild(count);
    toolbar.appendChild(button);
    container.insertBefore(toolbar, toc);

    // Selecting a poem from one of the four movement cards should reveal the
    // existing full reader immediately. Nothing about poem data or permissions
    // is replaced; this script only changes presentation.
    toc.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('.poem-toc-panel button')) {
        setExpanded(section, button, true);
      }
    }, true);

    return true;
  }

  function start() {
    if (enhance()) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (enhance() || tries > 80) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
