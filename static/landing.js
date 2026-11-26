/* ==========================================================================
   MATERIALHUNT — signed-out landing page, tool access and entrance animation
   Signed out: the home view explains what the site does; the tools open after sign-in.
   Booth mode (?booth=1, for the stall device) keeps every tool open without an account.
   This is a front-page choice, not a security wall: the tools run in the browser.
   ========================================================================== */
'use strict';

(function () {
  const OPEN_VIEWS = new Set(['simulator', 'pricing', 'forum', 'about', 'admin', 'team']);
  const root = document.documentElement;
  const booth = (() => {
    const asked = new URLSearchParams(location.search).get('booth') === '1';
    try { if (asked) sessionStorage.setItem('mh_booth', '1'); return asked || sessionStorage.getItem('mh_booth') === '1'; } catch { return asked; }
  })();
  const remembered = () => { try { return Boolean(localStorage.getItem(typeof STORAGE !== 'undefined' ? STORAGE.token : 'mh_token')); } catch { return false; } };
  const signedIn = () => booth || Boolean(typeof state !== 'undefined' && state.user) || remembered();
  let last = null;

  function ask() {
    if (typeof openAuth === 'function') openAuth('register');
    if (typeof toast === 'function') toast('Create a free account or sign in to open the tools.', 'info', 4500);
  }

  function sync() {
    const now = signedIn() ? 'in' : 'out';
    root.dataset.auth = now;
    const run = document.getElementById('heroRunSim');
    if (run) { const label = [...run.childNodes].reverse().find((n) => n.nodeType === 3 && n.textContent.trim()); if (label) label.textContent = now === 'in' ? ' Run a live test ' : ' Get started free '; }
    document.querySelectorAll('.mh-open').forEach((el) => { if (!el.dataset.in) el.dataset.in = el.textContent; el.textContent = now === 'in' ? el.dataset.in : 'Sign in to open →'; });
    document.getElementById('heroCreate')?.classList.toggle('hidden', true);
    if (last === now) return;
    const before = last;
    last = now;
    if (typeof setView !== 'function' || typeof state === 'undefined') return;
    if (now === 'out' && !OPEN_VIEWS.has(state.view)) setView('simulator');
    // charts and the 3D view were hidden, so draw them again once they are visible
    if (before === 'out' && now === 'in') setTimeout(() => { window.dispatchEvent(new Event('resize')); if (state.view === 'simulator') setView('simulator'); }, 120);
  }

  // every way of opening a view goes through setView, so one check covers menus, links and buttons
  if (typeof window.setView === 'function') {
    const open = window.setView;
    window.setView = function gatedSetView(view, scroll) {
      if (!signedIn() && !OPEN_VIEWS.has(view)) { ask(); return open('simulator', false); }
      return open(view, scroll);
    };
  }

  // buttons on the landing page that would start a tool
  document.addEventListener('click', (e) => {
    const start = e.target.closest('#heroRunSim, [data-mh-top], #mhModules .mh-card');
    if (!start) return;
    if (!signedIn()) { e.preventDefault(); e.stopPropagation(); ask(); return; }
    if (start.matches('[data-mh-top]')) { e.preventDefault(); document.querySelector('.goal-section')?.scrollIntoView({ behavior: 'smooth' }); }
  }, true);

  window.addEventListener('mh:session', () => setTimeout(sync, 0));
  window.addEventListener('storage', sync);
  sync();
  window.addEventListener('load', () => { sync(); setTimeout(sync, 2500); });

  // entrance animation; without it everything is simply visible
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('mh-anim');
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.mh-reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 3) * 70}ms`; io.observe(el); });
    setTimeout(() => document.querySelectorAll('.mh-reveal:not(.in)').forEach((el) => { if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('in'); }), 1800);
  }
})();
