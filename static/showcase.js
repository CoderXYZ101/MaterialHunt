/* ==========================================================================
   MATERIALHUNT — showcase tools
   1) Stall display: a full-screen, live leaderboard for a projector or TV (open the Challenge page
      and press "Stall display", or add ?stall=1 to the address). Works without signing in.
   2) Share card: after a passing design, make a picture of the result to post or send.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const SITE = 'materialhunt-2026.web.app';
  const MEDAL = { GOLD: ['#f5c451', '#b8860b', 'GOLD'], SILVER: ['#d7dce3', '#8a93a0', 'SILVER'], BRONZE: ['#d89462', '#8a5527', 'BRONZE'] };

  /* ------------------------------------------------------------------ */
  /* Stall display                                                        */
  /* ------------------------------------------------------------------ */
  let stallTimer = null;
  let stallUnsub = null;

  function closeStall() {
    q('#stall')?.remove();
    if (stallUnsub) { stallUnsub(); stallUnsub = null; }
    clearInterval(stallTimer);
    document.removeEventListener('keydown', onEsc);
    if (document.fullscreenElement) document.exitFullscreen?.();
  }
  const onEsc = (e) => { if (e.key === 'Escape') closeStall(); };

  async function openStall() {
    const C = window.MH_CHALLENGE;
    if (!C || q('#stall')) return;
    const period = C.currentPeriod();
    const bench = C.currentBench();
    const el = document.createElement('div');
    el.id = 'stall';
    el.className = 'stall';
    el.innerHTML = `<button class="btn btn-glass small stall-x" id="stallX">Close (Esc)</button>
      <h1>MaterialHunt Challenge: ${esc(bench.title)}</h1>
      <div class="stall-sub"><span id="stallLeft"></span> · Top 3 each week win Pro · Play at <b>${SITE}</b></div>
      <div id="stallRows"><div class="stall-row"><span></span><span>Waiting for the first entry…</span></div></div>
      <div class="stall-foot"><span id="stallStats"></span><span>Scan or type: ${SITE}</span></div>`;
    document.body.appendChild(el);
    document.addEventListener('keydown', onEsc);
    q('#stallX', el).addEventListener('click', closeStall);
    el.requestFullscreen?.().catch(() => {});
    const tick = () => {
      const t = Math.max(0, period.endMs - Date.now());
      const d = Math.floor(t / 86400000); const h = Math.floor((t % 86400000) / 3600000); const m = Math.floor((t % 3600000) / 60000);
      const left = q('#stallLeft', el);
      if (left) left.textContent = d > 0 ? `${d}d ${h}h left` : `${h}h ${m}m left`;
    };
    tick();
    stallTimer = setInterval(tick, 30000);
    try {
      await window.MH_FIREBASE.initFirebase();
      const db = window.MH_FIREBASE.db;
      stallUnsub = db.collection('challenge_entries').where('period', '==', period.id).limit(100).onSnapshot((snap) => {
        const rows = snap.docs.map((d) => d.data()).sort(window.MH_RANK.sort).slice(0, 10);
        const box = q('#stallRows', el);
        if (!box) return;
        box.innerHTML = rows.length
          ? rows.map((r, i) => `<div class="stall-row"><span>${i + 1}</span><span>${esc(r.name)} ${r.medal === 'GOLD' ? '🥇' : r.medal === 'SILVER' ? '🥈' : '🥉'}</span><span>${esc(r.formula)}</span><b>${r.score}</b></div>`).join('')
          : '<div class="stall-row"><span></span><span>No entries yet. Be the first!</span></div>';
      });
      const st = await db.collection('stats').doc('public').get();
      if (st.exists && st.data().verified_users) q('#stallStats', el).textContent = `${st.data().verified_users} verified members`;
    } catch { /* leaderboard unavailable */ }
  }

  /* ------------------------------------------------------------------ */
  /* Share card                                                           */
  /* ------------------------------------------------------------------ */
  function drawCard() {
    const r = state.forgeResult;
    const sim = state.simulation;
    const b = state.benchmark;
    if (!r || r.verdict !== 'PASS' || !sim || !b) return null;
    const medal = MEDAL[r.tier] || ['#38e8c6', '#0f7f6b', 'PASS'];
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1080;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 1080, 1080);
    bg.addColorStop(0, '#0b1626'); bg.addColorStop(1, '#13324a');
    g.fillStyle = bg; g.fillRect(0, 0, 1080, 1080);
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 6; i += 1) g.fillRect(0, 140 + i * 160, 1080, 1);
    g.fillStyle = '#9fb3c8'; g.font = '600 34px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText('MATERIALHUNT', 70, 100);
    const ring = g.createRadialGradient(540, 360, 20, 540, 360, 170);
    ring.addColorStop(0, medal[0]); ring.addColorStop(1, medal[1]);
    g.fillStyle = ring; g.beginPath(); g.arc(540, 360, 160, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(540, 360, 120, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 54px system-ui, sans-serif';
    g.fillText(medal[2], 540, 378);
    g.font = '700 58px system-ui, sans-serif';
    g.fillText(b.title.length > 30 ? `${b.title.slice(0, 29)}…` : b.title, 540, 620);
    g.fillStyle = '#9fb3c8'; g.font = '500 36px system-ui, sans-serif';
    g.fillText('My alloy', 540, 690);
    g.fillStyle = '#fff'; g.font = '700 46px ui-monospace, monospace';
    const formula = String(humanFormula(normalisedComposition(), 4));
    g.fillText(formula.length > 34 ? `${formula.slice(0, 33)}…` : formula, 540, 750);
    const d = sim.derived;
    const stats = [['Safety factor', `${Number(r.sf).toFixed(2)}×`], ['Cost', `₹${Math.round(d.cost_per_kg).toLocaleString('en-IN')}/kg`], ['Density', `${Number(d.density_gcm3).toFixed(2)} g/cm³`]];
    stats.forEach(([k, v], i) => {
      const x = 220 + i * 320;
      g.fillStyle = '#9fb3c8'; g.font = '500 28px system-ui, sans-serif'; g.fillText(k, x, 860);
      g.fillStyle = '#fff'; g.font = '700 40px system-ui, sans-serif'; g.fillText(v, x, 910);
    });
    g.fillStyle = '#38e8c6'; g.font = '600 36px system-ui, sans-serif';
    g.fillText(`Can you beat it? ${SITE}`, 540, 1010);
    return c;
  }

  async function shareResult() {
    const c = drawCard();
    if (!c) { notify('Pass a challenge first, then share your result.', 'warning', 3500); return; }
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], 'materialhunt-result.png', { type: 'image/png' });
    const text = `I just earned a ${(state.forgeResult.tier || 'PASS').toLowerCase()} result on the MaterialHunt challenge. Can you beat it? https://${SITE}`;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch { /* cancelled: fall back to download */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'materialhunt-result.png';
    document.body.appendChild(a); a.click(); a.remove();
    notify('Result picture saved. Post it anywhere!', 'success', 4500);
  }

  /* show the Share button only while a design passes */
  const originalRender = window.renderBenchmarkResult;
  if (typeof originalRender === 'function') {
    window.renderBenchmarkResult = function renderWithShare(benchmark, sim) {
      originalRender(benchmark, sim);
      let btn = q('#benchmarkShare');
      if (!btn) {
        const anchor = q('#benchmarkPublish');
        if (!anchor) return;
        btn = document.createElement('button');
        btn.id = 'benchmarkShare';
        btn.className = 'btn btn-ghost full small';
        btn.textContent = 'Share my result';
        btn.addEventListener('click', shareResult);
        anchor.insertAdjacentElement('afterend', btn);
      }
      btn.classList.toggle('hidden', state.forgeResult?.verdict !== 'PASS');
    };
  }

  /* stall button on the challenge page, and ?stall=1 */
  function addStallButton() {
    const head = q('#view-challenge .section-head');
    if (!head || q('#stallOpen')) return Boolean(q('#stallOpen'));
    const b = document.createElement('button');
    b.id = 'stallOpen'; b.className = 'btn btn-glass'; b.textContent = 'Stall display';
    b.addEventListener('click', openStall);
    head.appendChild(b);
    return true;
  }
  function boot() {
    let n = 0;
    const t = setInterval(() => { if (addStallButton() || n++ > 40) clearInterval(t); }, 250);
    if (new URLSearchParams(location.search).get('stall') === '1') setTimeout(openStall, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_SHOWCASE = { openStall, shareResult, drawCard };
})();
