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
  // demo mode: the QR code opens /demo, which comes here with ?demo=1. Tools work with daily limits, then sign-in is asked.
  const DEMO_KEY = 'mh_demo';
  const setDemo = (on) => { try { if (on) localStorage.setItem(DEMO_KEY, '1'); else localStorage.removeItem(DEMO_KEY); } catch { /* private window */ } demoNow = on; };
  let demoNow = (() => { try { return new URLSearchParams(location.search).get('demo') === '1' || localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } })();
  if (new URLSearchParams(location.search).get('demo') === '1') setDemo(true);
  const allowed = () => signedIn() || demoNow;
  const remembered = () => { try { return Boolean(localStorage.getItem(typeof STORAGE !== 'undefined' ? STORAGE.token : 'mh_token')); } catch { return false; } };
  const signedIn = () => booth || Boolean(typeof state !== 'undefined' && state.user) || remembered();
  let last = null;

  function ask() {
    if (typeof openAuth === 'function') openAuth('register');
    if (typeof toast === 'function') toast('Create a free account or sign in to open the tools.', 'info', 4500);
  }

  function sync() {
    const now = signedIn() ? 'in' : (demoNow ? 'demo' : 'out');
    root.dataset.auth = now;
    const run = document.getElementById('heroRunSim');
    if (run) { const label = [...run.childNodes].reverse().find((n) => n.nodeType === 3 && n.textContent.trim()); if (label) label.textContent = now === 'out' ? ' Try the free demo ' : ' Run a live test '; }
    document.querySelectorAll('.mh-open').forEach((el) => { if (!el.dataset.in) el.dataset.in = el.textContent; el.textContent = now === 'out' ? 'Try in the demo →' : el.dataset.in; });
    document.getElementById('heroCreate')?.classList.toggle('hidden', now === 'in');
    bar(now);
    if (last === now) return;
    const before = last;
    last = now;
    if (typeof setView !== 'function' || typeof state === 'undefined') return;
    if (now === 'out' && !OPEN_VIEWS.has(state.view)) setView('simulator');
    // charts and the 3D view were hidden, so draw them again once they are visible
    if (before === 'out' && now !== 'out') setTimeout(() => { window.dispatchEvent(new Event('resize')); if (state.view === 'simulator') setView('simulator'); }, 120);
  }

  // every way of opening a view goes through setView, so one check covers menus, links and buttons
  if (typeof window.setView === 'function') {
    const open = window.setView;
    window.setView = function gatedSetView(view, scroll) {
      if (!allowed() && !OPEN_VIEWS.has(view)) { ask(); return open('simulator', false); }
      return open(view, scroll);
    };
  }

  // buttons on the landing page that would start a tool
  document.addEventListener('click', (e) => {
    const start = e.target.closest('#heroRunSim, [data-mh-top], #mhModules .mh-card');
    if (!start) return;
    if (!allowed()) {
      // first visit: any "try it" button starts the demo
      setDemo(true); sync();
      if (!start.matches('#mhModules .mh-card')) { e.preventDefault(); e.stopPropagation(); setTimeout(() => document.querySelector('.goal-section')?.scrollIntoView({ behavior: 'smooth' }), 250); }
      return; // a tool card carries on and opens its tool
    }
    if (start.matches('[data-mh-top]')) { e.preventDefault(); document.querySelector('.goal-section')?.scrollIntoView({ behavior: 'smooth' }); }
  }, true);

  /* count tool runs in the demo; when a limit is used up the sign-up box appears instead */
  const COUNTED = [['#runAIDesign', 'finder'], ['#drRun', 'doctor'], ['#runComparison', 'compare'], ['#mlTrain', 'ml']];
  document.addEventListener('click', (e) => {
    if (root.dataset.auth !== 'demo' || !window.MH_PLAN) return;
    const hit = COUNTED.find(([sel]) => e.target.closest(sel));
    if (hit && !window.MH_PLAN.use(hit[1])) { e.preventDefault(); e.stopImmediatePropagation(); }
    setTimeout(() => bar(root.dataset.auth), 150);
  }, true);

  /* the strip that says this is a demo and what is left */
  function bar(mode) {
    let el = document.getElementById('mhDemoBar');
    if (mode !== 'demo') { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'mhDemoBar';
      el.className = 'mh-demo-bar';
      el.setAttribute('role', 'status');
      document.querySelector('main')?.insertAdjacentElement('beforebegin', el);
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-demo-up]') && typeof openAuth === 'function') openAuth('register');
        if (e.target.closest('[data-demo-in]') && typeof openAuth === 'function') openAuth('login');
        if (e.target.closest('[data-demo-exit]')) { setDemo(false); sync(); window.scrollTo(0, 0); }
      });
    }
    const left = (k) => (window.MH_PLAN ? window.MH_PLAN.remaining(k) : '…');
    el.innerHTML = `<div><b>DEMO MODE</b><span>Left today: <i>${left('sim')}</i> test runs · <i>${left('finder')}</i> searches · <i>${left('doctor')}</i> diagnoses · <i>${left('compare')}</i> comparisons</span></div>
      <div><button type="button" class="btn btn-primary small" data-demo-up>Sign up free: no limit on runs</button><button type="button" class="btn btn-glass small" data-demo-in>Sign in</button><button type="button" class="text-btn" data-demo-exit>Exit demo</button></div>`;
  }
  document.addEventListener('click', () => { if (root.dataset.auth === 'demo') setTimeout(() => bar('demo'), 400); });

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
