/* ==========================================================================
   MATERIALHUNT — hints
   Every little "?" on the site explains itself. Hover it, tab to it, or tap it and a short
   explanation appears. If the hint has a question attached (data-ask), a button under the text
   sends it to the assistant, which answers it on this device. Works with the keyboard and on touch.
   Mark up a hint as:  <i class="term-hint" data-hint="What it means" data-ask="Optional question">?</i>
   ========================================================================== */
'use strict';

(function () {
  let tip = null;
  let owner = null;
  let sticky = false;
  let hideTimer = 0;

  function ensure() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'mh-tip hidden';
    tip.id = 'mhTip';
    tip.setAttribute('role', 'tooltip');
    tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tip.addEventListener('mouseleave', () => { if (!sticky) scheduleHide(); });
    document.body.appendChild(tip);
    return tip;
  }

  function upgrade(root) {
    (root || document).querySelectorAll('.term-hint, [data-hint]').forEach((el) => {
      if (el.dataset.hintReady) return;
      if (el.getAttribute('title') && !el.dataset.hint) el.dataset.hint = el.getAttribute('title');
      el.removeAttribute('title');
      if (!el.dataset.hint) return;
      el.dataset.hintReady = '1';
      if (el.tagName !== 'BUTTON') { el.tabIndex = 0; el.setAttribute('role', 'button'); }
      el.setAttribute('aria-label', `What is this? ${el.dataset.hint}`);
      el.setAttribute('aria-describedby', 'mhTip');
    });
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const t = ensure();
    t.style.left = '0px'; t.style.top = '0px';
    const w = Math.min(320, window.innerWidth - 24);
    t.style.width = `${w}px`;
    const h = t.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8 && r.top - h - 8 > 8) top = r.top - h - 8;
    t.style.left = `${left}px`;
    t.style.top = `${Math.max(8, top)}px`;
  }

  function show(el, makeSticky) {
    if (!el.dataset.hint) return;
    clearTimeout(hideTimer);
    const t = ensure();
    owner = el;
    sticky = Boolean(makeSticky);
    t.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = el.dataset.hint;
    t.appendChild(p);
    if (el.dataset.ask) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mh-tip-ask';
      b.textContent = 'Ask the assistant to explain';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const question = el.dataset.ask;
        hide();
        if (typeof window.copilotOpen === 'function') window.copilotOpen();
        if (typeof window.copilotAsk === 'function') window.copilotAsk(question);
      });
      t.appendChild(b);
    }
    t.classList.remove('hidden');
    place(el);
  }

  function hide() {
    clearTimeout(hideTimer);
    if (tip) tip.classList.add('hidden');
    owner = null;
    sticky = false;
  }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 260); }

  const target = (e) => (e.target && e.target.closest ? e.target.closest('[data-hint-ready]') : null);

  document.addEventListener('mouseover', (e) => { const el = target(e); if (el && !sticky) show(el, false); });
  document.addEventListener('mouseout', (e) => { const el = target(e); if (el && !sticky) scheduleHide(); });
  document.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el, true); });
  document.addEventListener('focusout', (e) => { if (target(e) && !(tip && tip.contains(e.relatedTarget))) scheduleHide(); });
  document.addEventListener('click', (e) => {
    const el = target(e);
    if (el) {
      e.preventDefault();
      e.stopPropagation();
      if (owner === el && sticky) hide(); else show(el, true);
      return;
    }
    if (tip && !tip.contains(e.target)) hide();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', () => { if (owner && !sticky) hide(); else if (owner) place(owner); }, true);
  window.addEventListener('resize', () => { if (owner) place(owner); });

  let pending = 0;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => { pending = 0; upgrade(document); }, 120);
  });

  function boot() {
    upgrade(document);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_HINTS = { upgrade, show, hide };
})();
