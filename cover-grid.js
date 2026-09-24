(function () {
  'use strict';

  function installCoverGrid() {
    if (document.querySelector('[data-ajk-cover-grid-toggle]')) return;

    var list = document.querySelector('.book-list-wrap');
    if (!list) return;

    var cards = Array.prototype.slice.call(list.querySelectorAll('.book-card'));
    if (!cards.length) return;

    var toolbar = list.previousElementSibling;
    if (!toolbar) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-ajk-cover-grid-toggle', '1');
    button.textContent = 'Covers';
    button.style.cssText = "white-space:nowrap;background:none;border:1px solid var(--rule);color:var(--ink-2);font-family:'Archivo',sans-serif;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;cursor:pointer;margin-left:8px";

    var grid = document.createElement('div');
    grid.setAttribute('data-ajk-cover-grid', '1');
    grid.style.cssText = 'display:none;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:24px 16px;padding:24px 0 36px;align-items:start';

    cards.forEach(function (card) {
      var original = card.querySelector('a img') ? card.querySelector('a img').closest('a') : card.querySelector('a');
      if (!original) return;

      var titleNode = card.querySelector('h2,h3,h4');
      var title = titleNode ? titleNode.textContent.trim() : (original.getAttribute('aria-label') || 'Book');

      var thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.title = title;
      thumb.setAttribute('aria-label', title);
      thumb.style.cssText = 'display:block;width:100%;padding:0;border:0;background:none;cursor:pointer;text-align:left';

      var img = original.querySelector('img');
      if (img) {
        var frame = document.createElement('span');
        frame.style.cssText = 'display:block;width:100%;aspect-ratio:2/3;overflow:hidden;border:1px solid var(--rule);box-shadow:0 8px 24px rgba(43,36,28,.08)';
        var clone = img.cloneNode(true);
        clone.loading = 'lazy';
        clone.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover';
        frame.appendChild(clone);
        thumb.appendChild(frame);
      } else {
        var placeholder = document.createElement('span');
        placeholder.textContent = title;
        placeholder.style.cssText = "box-sizing:border-box;display:flex;width:100%;aspect-ratio:2/3;align-items:center;justify-content:center;padding:12px;border:1px solid var(--rule);background:var(--bone-deep);font-family:'Cormorant Garamond',serif;font-size:14px;line-height:1.25;color:var(--ink-3);text-align:center";
        thumb.appendChild(placeholder);
      }

      thumb.addEventListener('click', function () { original.click(); });
      grid.appendChild(thumb);
    });

    if (!grid.children.length) return;

    list.parentNode.insertBefore(grid, list);
    toolbar.appendChild(button);

    var active = false;
    button.addEventListener('click', function () {
      active = !active;
      grid.style.display = active ? 'grid' : 'none';
      list.style.display = active ? 'none' : '';
      button.style.borderColor = active ? 'var(--gold)' : 'var(--rule)';
      button.style.color = active ? 'var(--gold)' : 'var(--ink-2)';
    });

    var mq = window.matchMedia('(max-width: 640px)');
    function sizeGrid() {
      grid.style.gridTemplateColumns = mq.matches ? 'repeat(2,minmax(0,1fr))' : 'repeat(auto-fill,minmax(130px,1fr))';
    }
    sizeGrid();
    if (mq.addEventListener) mq.addEventListener('change', sizeGrid);
  }

  function boot() {
    installCoverGrid();
    var observer = new MutationObserver(function () { installCoverGrid(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 20000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();