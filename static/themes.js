/* ==========================================================================
   MATERIALHUNT — colour themes
   Each theme is a "skin" on top of the dark or light base, so everything that already
   supports dark and light keeps working. The choice is remembered on this device.
   ========================================================================== */
'use strict';

(function () {
  const THEMES = [
    // id, name, base, background, accent, second accent
    ['midnight', 'Midnight', 'dark', '#070b14', '#22d3ee', '#10b981'],
    ['ocean', 'Ocean', 'dark', '#031620', '#2dd4bf', '#38bdf8'],
    ['royal', 'Royal', 'dark', '#0c0b26', '#818cf8', '#c084fc'],
    ['cyber', 'Cyber', 'dark', '#0e0619', '#e879f9', '#22d3ee'],
    ['sunset', 'Sunset', 'dark', '#190a14', '#fb923c', '#f472b6'],
    ['forest', 'Forest', 'dark', '#06150e', '#4ade80', '#bef264'],
    ['daylight', 'Daylight', 'light', '#f4f7fb', '#0891b2', '#059669'],
    ['sky', 'Sky', 'light', '#ebf4ff', '#2563eb', '#0891b2'],
    ['mint', 'Mint', 'light', '#ecfaf4', '#0f766e', '#4d7c0f'],
    ['lavender', 'Lavender', 'light', '#f4f0ff', '#7c3aed', '#be185d'],
    ['peach', 'Peach', 'light', '#fff3ec', '#c2410c', '#be185d'],
    ['contrast', 'High contrast', 'dark', '#000000', '#ffd400', '#00e5ff'],
  ];
  const KEY = 'mh_skin';
  const byId = (id) => THEMES.find((t) => t[0] === id);
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
  let current = byId(read(KEY)) ? read(KEY) : (read('mh_theme') === 'light' || document.documentElement.dataset.theme === 'light' ? 'daylight' : 'midnight');

  function apply(id, redraw) {
    const t = byId(id) || THEMES[0];
    current = t[0];
    const root = document.documentElement;
    root.dataset.skin = t[0];
    if (typeof applyTheme === 'function') applyTheme(t[2]); else root.dataset.theme = t[2];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t[3]);
    write(KEY, t[0]);
    if (redraw) {
      try { if (typeof renderAllCharts === 'function') renderAllCharts(); } catch { /* charts redraw on the next run */ }
      try { if (typeof state !== 'undefined' && state.scene) state.scene.setTheme(t[2]); } catch { /* 3D keeps its colours */ }
    }
    document.querySelectorAll('.theme-swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.skin === current)));
  }

  function panel() {
    let p = document.getElementById('themePanel');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'themePanel';
    p.className = 'theme-panel hidden';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Choose a colour theme');
    const group = (label, base) => `<h4>${label}</h4><div class="theme-grid">${THEMES.filter((t) => t[2] === base).map((t) => `
      <button type="button" class="theme-swatch" data-skin="${t[0]}" aria-pressed="${t[0] === current}">
        <i style="background:linear-gradient(135deg, ${t[3]} 0 46%, ${t[4]} 46% 73%, ${t[5]} 73%)"></i><span>${t[1]}</span>
      </button>`).join('')}</div>`;
    p.innerHTML = group('Dark', 'dark') + group('Light', 'light');
    document.body.appendChild(p);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('.theme-swatch');
      if (b) apply(b.dataset.skin, true);
    });
    return p;
  }

  function place(p, btn) {
    const r = btn.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 24);
    p.style.width = `${w}px`;
    p.style.top = `${Math.round(r.bottom + 10)}px`;
    p.style.left = `${Math.round(Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)))}px`;
  }

  // capture phase, so the old dark/light switch on this button does not also run
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#themeToggle');
    const p = document.getElementById('themePanel');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const el = panel();
      const opening = el.classList.contains('hidden');
      el.classList.toggle('hidden', !opening);
      if (opening) place(el, btn);
      return;
    }
    if (p && !p.contains(e.target)) p.classList.add('hidden');
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('themePanel')?.classList.add('hidden'); });
  window.addEventListener('scroll', () => document.getElementById('themePanel')?.classList.add('hidden'), { passive: true });

  const boot = () => {
    apply(current, false);
    const btn = document.getElementById('themeToggle');
    if (btn) { btn.title = 'Choose a colour theme'; btn.setAttribute('aria-label', 'Choose a colour theme'); btn.classList.add('theme-btn'); }
  };
  document.documentElement.dataset.skin = current;
  document.documentElement.dataset.theme = byId(current)[2];
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', boot);
  window.MH_THEMES = { list: THEMES.map((t) => t[0]), apply: (id) => apply(id, true) };
})();
