/* ==========================================================================
   MATERIALHUNT — community challenges
   Any verified member can design their own challenge. They must first pass it themselves in the
   Forge (so it is known to be solvable), then it goes to an admin for approval. Each live
   challenge has its own leaderboard. A creator may offer Pro days to the top 3; MaterialHunt
   never moves money between members, so those prizes only count once an admin has confirmed
   the creator paid for them (the "funded" flag).
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const db = () => window.MH_FIREBASE?.db;
  const FV = () => window.firebase.firestore.FieldValue;
  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  const ENVS = ['Air / Industrial', 'Marine / Salt Spray', 'Acidic / Chemical', 'Oxidising / Steam'];

  let live = [];
  let mine = [];
  let openBoard = '';
  const boards = {};
  let busy = false;

  /* ------------------------------------------------------------------ */
  /* Challenge -> benchmark the Forge understands                         */
  /* ------------------------------------------------------------------ */
  function toBench(c, extra) {
    const banned = String(c.banned || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    return {
      id: 'custom', tag: 'COMMUNITY CHALLENGE', title: c.title, brief: c.brief,
      targetTempC: c.temp, minBurstMPa: c.burst, loadMpa: c.load, maxDensity: c.max_density, maxCostINR: c.max_cost, minSafety: c.min_sf,
      bannedElements: banned, metalsOnly: Boolean(c.metals_only), environment: c.environment,
      rules: [
        `Survive ${Number(c.temp).toLocaleString('en-IN')} °C`, `Hold ${c.burst} MPa (${c.load} MPa wall stress)`, `Density ≤ ${c.max_density} g/cm³`,
        `Raw cost ≤ ${inr(c.max_cost)}/kg`, `Safety factor ≥ ${Number(c.min_sf).toFixed(2)}`,
        c.metals_only ? 'Metals only' : 'Any element', ...(banned.length ? [`Banned: ${banned.join(', ')}`] : []),
      ],
      standards: `Set by ${c.owner_name || 'a member'}`,
      ...extra,
    };
  }

  const scoreOf = (b, sf, d) => Math.min(600, Math.round(100 + Math.min(sf, 3) * 10 + Math.max(0, b.maxDensity - d.density_gcm3) * 5 + Math.max(0, (b.maxCostINR - d.cost_per_kg) / 100)));

  /* ------------------------------------------------------------------ */
  /* Loading                                                              */
  /* ------------------------------------------------------------------ */
  async function ready() {
    try { await window.MH_FIREBASE.initFirebase(); return Boolean(db()); } catch { return false; }
  }

  async function loadLive() {
    if (!(await ready())) { render(); return; }
    try {
      const snap = await db().collection('community_challenges').where('status', '==', 'live').limit(30).get();
      live = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => ms(c.ends_at) > Date.now()).sort((a, b) => ms(a.ends_at) - ms(b.ends_at));
    } catch { live = []; }
    render();
  }

  async function loadMine() {
    mine = [];
    const u = window.MH_FIREBASE?.auth?.currentUser;
    if (!u || !(await ready())) return;
    try {
      const snap = await db().collection('community_challenges').where('owner', '==', u.uid).limit(20).get();
      mine = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.created_at) - ms(a.created_at));
    } catch { mine = []; }
    render();
  }

  async function loadBoard(id) {
    boards[id] = null;
    render();
    try {
      const snap = await db().collection('community_entries').where('challenge', '==', id).limit(60).get();
      boards[id] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.score - a.score);
    } catch { boards[id] = []; }
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Panel                                                                */
  /* ------------------------------------------------------------------ */
  const left = (c) => { const t = ms(c.ends_at) - Date.now(); const d = Math.floor(t / 86400000); const h = Math.floor((t % 86400000) / 3600000); return d > 0 ? `${d}d ${h}h left` : `${h}h left`; };

  function prizeLine(c) {
    if (!c.prize_days) return '';
    return c.funded
      ? `<span class="pill pill-emerald">Prize: ${c.prize_days} days of Pro for each of the top 3 (paid for by the creator)</span>`
      : `<span class="pill pill-cyan">Prize pending: the creator is arranging payment</span>`;
  }

  function boardHtml(c) {
    const rows = boards[c.id];
    if (rows === undefined) return '';
    if (rows === null) return '<div class="empty-state"><span>Loading…</span></div>';
    if (!rows.length) return '<div class="empty-state"><strong>No entries yet</strong><span>Be the first on this board.</span></div>';
    const me = window.MH_FIREBASE?.auth?.currentUser?.uid;
    return `<div class="lb-head"><span>#</span><span>Name</span><span>Alloy</span><span>SF</span><span>₹/kg</span><span>Score</span></div>${rows.slice(0, 10).map((r, i) => `
      <div class="lb-row${r.user_id === me ? ' me' : ''}"><span class="lb-rank">${i + 1}</span>
        <span class="lb-name"><span class="lb-av" data-av="${esc(r.user_id)}" data-nm="${esc(r.name)}"></span><button class="lb-person" data-person="${esc(r.user_id)}">${esc(r.name)}</button></span>
        <span class="lb-alloy">${esc(r.formula)}</span><span>${Number(r.sf).toFixed(2)}</span><span>${inr(r.cost)}</span><b>${r.score}</b></div>`).join('')}`;
  }

  function cardHtml(c) {
    return `<div class="cm-card">
      <div class="cm-head"><div><b>${esc(c.title)}</b><small>by ${esc(c.owner_name || 'a member')} · ${esc(left(c))}</small></div>
        <div class="cm-actions"><button class="btn btn-primary small" data-cm-play="${esc(c.id)}">Play</button><button class="btn btn-glass small" data-cm-board="${esc(c.id)}">${openBoard === c.id ? 'Hide' : 'Leaderboard'}</button></div></div>
      <p>${esc(c.brief)}</p>
      <div class="cm-chips"><span>${Number(c.temp).toLocaleString('en-IN')} °C</span><span>SF ≥ ${Number(c.min_sf).toFixed(2)}</span><span>≤ ${c.max_density} g/cm³</span><span>≤ ${inr(c.max_cost)}/kg</span>${c.metals_only ? '<span>Metals only</span>' : ''}</div>
      ${prizeLine(c)}
      ${openBoard === c.id ? `<div class="lb-body">${boardHtml(c)}</div>` : ''}
    </div>`;
  }

  const STATUS = { pending: 'Waiting for review', live: 'Live', closed: 'Finished', rejected: 'Not approved' };

  function render() {
    const root = q('#cmPanel');
    if (!root) return;
    const mineHtml = mine.length
      ? `<h4 class="cm-sub">Your challenges</h4>${mine.map((c) => `<div class="cm-mine"><b>${esc(c.title)}</b><span class="admin-status">${esc(STATUS[c.status] || c.status)}${c.status === 'live' ? ` · ${esc(left(c))}` : ''}</span>${c.prize_days && !c.funded && c.status !== 'rejected' ? '<small>Prize needs payment before it counts. We will contact you by email.</small>' : ''}${c.admin_note ? `<small>${esc(c.admin_note)}</small>` : ''}${c.status === 'pending' ? `<button class="text-btn" data-cm-del="${esc(c.id)}">Withdraw</button>` : ''}</div>`).join('')}`
      : '';
    root.innerHTML = `<div class="panel-title-row"><div><span class="panel-kicker">COMMUNITY</span><h3>Community challenges</h3></div><button class="btn btn-glass small" id="cmNew">Start a challenge</button></div>
      <p class="micro-note">Members can set their own problem. A challenge goes live after a quick review, and it has to be solvable: its creator must pass it first. Anyone can play. If a creator offers Pro time as a prize, the creator pays for it; MaterialHunt never handles money between members.</p>
      ${live.length ? live.map(cardHtml).join('') : '<div class="empty-state"><strong>No community challenges live right now</strong><span>Start one and be the first.</span></div>'}
      ${mineHtml}`;
    window.MH_PROFILE?.decorate?.(root);
  }

  function mount() {
    if (q('#cmPanel')) return true;
    const layout = q('#view-challenge .challenge-layout');
    if (!layout) return false;
    const panel = document.createElement('article');
    panel.id = 'cmPanel';
    panel.className = 'glass cm-panel';
    layout.insertAdjacentElement('afterend', panel);
    panel.addEventListener('click', onClick);
    render();
    loadLive();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Create                                                               */
  /* ------------------------------------------------------------------ */
  function modal() {
    let m = q('#cmModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'cmModal';
      m.className = 'modal-backdrop hidden';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    }
    return m;
  }

  function openCreate() {
    if (!state.user) { notify('Create a free account to start a challenge.', 'info', 4000); openAuth('register'); return; }
    if (!state.user.email_verified) { notify('Verify your email first, then you can start a challenge.', 'warning', 4500); return; }
    const m = modal();
    const per = Math.round(((window.MH_CONFIG?.prices?.pro?.month) || 1499) / 30);
    m.innerHTML = `<div class="auth-modal glass tool-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="cmTitle">
      <button class="modal-close" data-x aria-label="Close">×</button>
      <span class="panel-kicker">START A CHALLENGE</span><h2 id="cmTitle">Design a challenge</h2>
      <form class="auth-form" id="cmForm">
        <label class="field-label" for="cmName">Title</label><input id="cmName" type="text" maxlength="50" placeholder="e.g. Lightest drone motor shaft" required />
        <label class="field-label" for="cmBrief">The problem (what must the alloy do?)</label><textarea id="cmBrief" rows="3" maxlength="240" required></textarea>
        <div class="two-col">
          <div><label class="field-label" for="cmTemp">Service temperature (°C)</label><input id="cmTemp" type="number" min="-273" max="4500" step="any" value="800" /></div>
          <div><label class="field-label" for="cmEnv">Environment</label><select id="cmEnv" class="field-select">${ENVS.map((e) => `<option>${esc(e)}</option>`).join('')}</select></div>
          <div><label class="field-label" for="cmBurst">Pressure to hold (MPa)</label><input id="cmBurst" type="number" min="0" max="1000" step="any" value="20" /></div>
          <div><label class="field-label" for="cmLoad">Wall stress (MPa)</label><input id="cmLoad" type="number" min="1" max="2000" step="any" value="150" /></div>
          <div><label class="field-label" for="cmDens">Max density (g/cm³)</label><input id="cmDens" type="number" min="1" max="25" step="any" value="9" /></div>
          <div><label class="field-label" for="cmCost">Max cost (₹/kg)</label><input id="cmCost" type="number" min="50" max="100000" step="any" value="4000" /></div>
          <div><label class="field-label" for="cmSf">Minimum safety factor</label><input id="cmSf" type="number" min="1" max="5" step="any" value="1.3" /></div>
          <div><label class="field-label" for="cmBan">Banned elements (optional)</label><input id="cmBan" type="text" maxlength="40" placeholder="e.g. Co, Be" /></div>
        </div>
        <label class="guardrail-check"><input type="checkbox" id="cmMetals" checked /><span><strong>Metals only</strong><small>Blocks carbon, boron, silicon and other non-metals.</small></span></label>
        <label class="field-label" for="cmPrize">Prize for the top 3 (optional)</label>
        <select id="cmPrize" class="field-select"><option value="0">No prize</option><option value="3">3 days of Pro each</option><option value="7">7 days of Pro each</option><option value="14">14 days of Pro each</option></select>
        <div id="cmPrizeBox" class="hidden"><p class="micro-note" id="cmPrizeNote"></p>
          <label class="guardrail-check"><input type="checkbox" id="cmAdult" /><span><strong>I am 18 or older, or a parent or guardian is paying</strong><small>Prizes only go live after payment is confirmed by us. We will contact you by email. Nothing is charged here.</small></span></label></div>
        <p class="micro-note">Next, you test the challenge in the Forge and must pass it yourself. Then you can send it for review.</p>
        <button class="btn btn-primary full" type="submit">Test it in the Forge</button>
        <p class="form-error" id="cmError"></p>
      </form></div>`;
    m.classList.remove('hidden');
    q('[data-x]', m).addEventListener('click', () => m.classList.add('hidden'));
    q('#cmPrize', m).addEventListener('change', (e) => {
      const d = Number(e.target.value);
      q('#cmPrizeBox', m).classList.toggle('hidden', !d);
      q('#cmPrizeNote', m).textContent = d ? `You cover the Pro time for 3 winners: about ${inr(d * 3 * per)} at the Pro price. The prize is shown as pending until payment is confirmed.` : '';
    });
    q('#cmForm', m).addEventListener('submit', (e) => { e.preventDefault(); startDraft(m); });
  }

  function startDraft(m) {
    const err = q('#cmError', m);
    err.textContent = '';
    const num = (id) => Number(q(id, m).value);
    const prize = Number(q('#cmPrize', m).value);
    const draft = {
      title: q('#cmName', m).value.trim(), brief: q('#cmBrief', m).value.trim(),
      temp: num('#cmTemp'), burst: num('#cmBurst'), load: num('#cmLoad'), max_density: num('#cmDens'), max_cost: num('#cmCost'), min_sf: num('#cmSf'),
      banned: q('#cmBan', m).value.replace(/[^A-Za-z, ]/g, '').trim().slice(0, 40), metals_only: q('#cmMetals', m).checked,
      environment: q('#cmEnv', m).value, prize_days: prize,
    };
    const bad = [draft.title.length < 3 && 'Add a title.', draft.brief.length < 10 && 'Describe the problem in a sentence or two.',
      !(draft.temp >= -273 && draft.temp <= 4500) && 'Temperature must be between -273 and 4500 °C.',
      !(draft.burst >= 0 && draft.burst <= 1000) && 'Pressure must be 0 to 1000 MPa.', !(draft.load >= 1 && draft.load <= 2000) && 'Wall stress must be 1 to 2000 MPa.',
      !(draft.max_density >= 1 && draft.max_density <= 25) && 'Density limit must be 1 to 25 g/cm³.', !(draft.max_cost >= 50) && 'Cost limit must be at least ₹50/kg.',
      !(draft.min_sf >= 1 && draft.min_sf <= 5) && 'Safety factor must be between 1 and 5.',
      prize && !q('#cmAdult', m).checked && 'Please confirm the prize will be paid by an adult.'].filter(Boolean);
    if (bad.length) { err.textContent = bad[0]; return; }
    state.communityDraft = draft;
    state.customBenchmark = toBench({ ...draft, owner_name: 'you' }, { communityDraft: true });
    m.classList.add('hidden');
    applyBenchmark('custom', { silent: true });
    setView('simulator');
    setTimeout(() => q('#forgePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    notify('Find an alloy that passes, then press "Submit challenge for review".', 'success', 6500);
  }

  async function publishDraft() {
    const draft = state.communityDraft;
    const r = state.forgeResult;
    if (!draft || !r || r.verdict !== 'PASS') { notify('Pass your own challenge first. Run the stress test.', 'warning', 4500); return; }
    if (busy) return;
    busy = true;
    try {
      if (!(await ready())) throw new Error('offline');
      const u = window.MH_FIREBASE.auth.currentUser;
      const comp = Object.fromEntries(Object.entries(normalisedComposition()).map(([k, v]) => [k, Number(Number(v).toFixed(2))]));
      const name = (window.MH_PROFILE?.displayName?.() || state.user.organization_name || 'A member').toString().slice(0, 40);
      await db().collection('community_challenges').add({
        ...draft, owner: u.uid, owner_name: name, funded: false, status: 'pending',
        ref_formula: String(humanFormula(comp, 4)).slice(0, 60), ref_sf: Number(Number(r.sf).toFixed(2)), created_at: FV().serverTimestamp(),
      });
      state.communityDraft = null;
      notify('Sent for review. It goes live once an admin approves it.', 'success', 6000);
      window.MH_GROWTH?.track?.('community_challenge_created');
      setView('challenge');
      loadMine();
    } catch { notify('Could not send it. Check your connection and try again.', 'error', 5000); }
    busy = false;
  }

  /* ------------------------------------------------------------------ */
  /* Play + submit                                                        */
  /* ------------------------------------------------------------------ */
  function play(id) {
    const c = live.find((x) => x.id === id);
    if (!c) return;
    state.communityDraft = null;
    state.customBenchmark = toBench(c, { communityId: c.id });
    applyBenchmark('custom', { silent: true });
    setView('simulator');
    setTimeout(() => q('#forgePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    notify(`"${c.title}" loaded. Mix your alloy, press Run Stress Test, then submit.`, 'success', 5500);
  }

  async function submitEntry() {
    const b = state.benchmark;
    const r = state.forgeResult;
    const sim = state.simulation;
    if (!r || r.verdict !== 'PASS' || !sim) { notify('Only passing designs can be submitted. Run the stress test first.', 'warning', 4000); return; }
    if (!state.user) { notify('Create a free account to enter.', 'info', 4000); openAuth('register'); return; }
    if (!state.user.email_verified) { notify('Verify your email first, then you can enter.', 'warning', 4500); return; }
    if (busy) return;
    busy = true;
    try {
      if (!(await ready())) throw new Error('offline');
      const u = window.MH_FIREBASE.auth.currentUser;
      const comp = Object.fromEntries(Object.entries(normalisedComposition()).map(([k, v]) => [k, Number(Number(v).toFixed(2))]));
      const entry = {
        challenge: b.communityId, user_id: u.uid, name: (window.MH_PROFILE?.displayName?.() || state.user.organization_name || 'Anonymous').toString().slice(0, 40),
        formula: String(humanFormula(comp, 4)).slice(0, 60), composition: comp, sf: Number(Number(r.sf).toFixed(2)), cost: Math.round(sim.derived.cost_per_kg),
        density: Number(Number(sim.derived.density_gcm3).toFixed(2)), score: scoreOf(b, r.sf, sim.derived),
      };
      const ref = db().collection('community_entries').doc(`${b.communityId}_${u.uid}`);
      const old = await ref.get();
      if (old.exists && old.data().score > entry.score && !window.confirm(`Your current entry scores ${old.data().score}. This design scores ${entry.score}. Replace it anyway?`)) { busy = false; return; }
      await ref.set({ ...entry, created_at: FV().serverTimestamp() });
      notify(`Entered with a score of ${entry.score}.`, 'success', 5000);
      openBoard = b.communityId;
      setView('challenge');
      loadBoard(b.communityId);
    } catch { notify('Could not submit. The challenge may have ended.', 'error', 5000); }
    busy = false;
  }

  /* called by tools.js when the Submit button is pressed in the Forge */
  function handle() {
    if (state.benchmark?.communityDraft) { publishDraft(); return true; }
    if (state.benchmark?.communityId) { submitEntry(); return true; }
    return false;
  }

  /* keep the Forge's submit button honest about what it does */
  const originalApply = window.applyBenchmark;
  window.applyBenchmark = function applyBenchmarkCommunity(id, options) {
    originalApply(id, options);
    const btn = q('#benchmarkPublish');
    if (btn) btn.textContent = state.benchmark?.communityDraft ? 'Submit challenge for review' : state.benchmark?.communityId ? 'Submit to this challenge' : 'Submit to leaderboard';
  };

  async function onClick(e) {
    const t = e.target.closest('[data-cm-play],[data-cm-board],[data-cm-del],#cmNew');
    if (!t) return;
    if (t.id === 'cmNew') openCreate();
    else if (t.dataset.cmPlay) play(t.dataset.cmPlay);
    else if (t.dataset.cmBoard) {
      const id = t.dataset.cmBoard;
      if (openBoard === id) { openBoard = ''; render(); } else { openBoard = id; loadBoard(id); }
    } else if (t.dataset.cmDel) {
      try { await db().collection('community_challenges').doc(t.dataset.cmDel).delete(); mine = mine.filter((c) => c.id !== t.dataset.cmDel); render(); notify('Withdrawn.', 'info', 2500); }
      catch { notify('Could not withdraw it.', 'error', 4000); }
    }
  }

  window.addEventListener('mh:session', (e) => { if (e.detail.user) loadMine(); else { mine = []; render(); } });
  window.addEventListener('mh:view', (e) => { if (e.detail?.view === 'challenge') { mount(); loadLive(); if (state.user) loadMine(); } });
  const boot = () => { let n = 0; const t = setInterval(() => { if (mount() || n++ > 40) clearInterval(t); }, 250); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_COMMUNITY = { handle, reload: loadLive };
})();
