/* ==========================================================================
   MATERIALHUNT — My designs
   Save the current alloy and conditions to your account, reopen them later, share a link,
   rename or delete. Stored in Firestore (collection "designs"), visible only to the owner.
   Free accounts can keep FREE_LIMIT designs; paid plans are unlimited.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const FREE_LIMIT = 5;

  let designs = [];
  let loaded = false;

  const db = () => window.MH_FIREBASE?.db;
  const uid = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const FV = () => window.firebase.firestore.FieldValue;
  const when = (ts) => { try { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); } catch { return ''; } };
  const limit = () => (window.MH_PLAN?.isPaid() ? Infinity : FREE_LIMIT);

  async function ready() {
    await window.MH_FIREBASE?.initFirebase?.();
    return Boolean(db() && uid());
  }

  async function load() {
    if (!(await ready())) return;
    const snap = await db().collection('designs').where('user_id', '==', uid()).get();
    designs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const ta = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
      const tb = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
      return tb - ta;
    });
    loaded = true;
  }

  /* ------------------------------------------------------------------ */
  /* Save                                                                */
  /* ------------------------------------------------------------------ */
  function snapshot() {
    const sim = state.simulation;
    if (!sim) return null;
    const d = sim.derived;
    const req = collectSimulationRequest();
    const comp = Object.fromEntries(Object.entries(typeof normalisedComposition === 'function' ? normalisedComposition() : req.elements).map(([k, v]) => [k, Number(Number(v).toFixed(3))]));
    const match = window.MH_TOOLS?.lastMatch;
    return {
      composition: comp,
      conditions: {
        temperature_c: req.temperature_c, load_mpa: req.load_mpa, safety_factor: req.safety_factor, environment: String(req.environment || ''),
        velocity_kmh: req.velocity_kmh || 0, structure: String(req.structure || ''),
      },
      result: {
        verdict: String(d.verdict || ''), utilization: Number(Number(d.utilization_ratio || 0).toFixed(3)),
        strength_mpa: Math.round(d.operating_strength_mpa || 0), density: Number(Number(d.density_gcm3 || 0).toFixed(2)), cost_per_kg: Math.round(d.cost_per_kg || 0),
      },
      grade: match ? String(match.best.grade.name).slice(0, 80) : '',
    };
  }

  async function save(nameArg) {
    if (!state.user) { notify('Create a free account to save designs.', 'info', 3500); openAuth('register'); return false; }
    const snap = snapshot();
    if (!snap) { notify('Run a simulation first, then save it.', 'warning', 3500); return false; }
    if (!(await ready())) { notify('Saving is not available right now. Please try again in a moment.', 'error', 4000); return false; }
    if (!loaded) await load();
    if (designs.length >= limit()) {
      notify(`Free accounts can keep ${FREE_LIMIT} designs. Delete one or upgrade for unlimited.`, 'warning', 5000);
      window.openUpgrade?.('pro');
      return false;
    }
    const name = String(nameArg || '').trim().slice(0, 80) || `${snap.grade || 'Custom alloy'} · ${Math.round(snap.conditions.temperature_c)}°C`;
    try {
      const doc = { user_id: uid(), name, ...snap, created_at: FV().serverTimestamp() };
      const ref = await db().collection('designs').add(doc);
      designs.unshift({ id: ref.id, ...doc, created_at: { toMillis: () => Date.now(), toDate: () => new Date() } });
      notify('Design saved.', 'success', 2500);
      window.MH_GROWTH?.track?.('design_save');
      renderList();
      return true;
    } catch (err) {
      notify(err.message || 'Could not save the design.', 'error', 5000);
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Open / share / rename / delete                                      */
  /* ------------------------------------------------------------------ */
  function open(design) {
    const c = design.conditions || {};
    state.composition = { ...design.composition };
    if (typeof renderElementSliders === 'function') renderElementSliders();
    const setSlider = (id, value) => { const el = q(id); if (el && value !== undefined && value !== null && value !== '') { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    setSlider('#temperatureSlider', c.temperature_c);
    setSlider('#loadSlider', c.load_mpa);
    setSlider('#safetySlider', c.safety_factor);
    setSlider('#velocitySlider', c.velocity_kmh);
    if (c.environment && q('#environmentSelect')) { const opt = qa('#environmentSelect option').find((o) => o.value === c.environment); if (opt) q('#environmentSelect').value = opt.value; }
    if (c.structure && q('#structureSelect')) { q('#structureSelect').value = c.structure; q('#structureSelect').dispatchEvent(new Event('change', { bubbles: true })); }
    if (typeof updateCompositionUI === 'function') updateCompositionUI();
    closeModal();
    setView('simulator');
    if (typeof runSimulation === 'function') runSimulation();
    notify(`Opened "${design.name}".`, 'success', 2500);
  }

  function shareLink(design) {
    const formula = Object.entries(design.composition).map(([k, v]) => `${k}:${v}`).join(',');
    const url = `${location.origin}${location.pathname}?formula=${encodeURIComponent(formula)}`;
    navigator.clipboard?.writeText(url).then(() => notify('Link copied. Anyone with it can open this alloy.', 'success', 3500));
  }

  async function rename(id, name) {
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) return;
    await db().collection('designs').doc(id).update({ name: clean });
    const d = designs.find((x) => x.id === id);
    if (d) d.name = clean;
    renderList();
  }

  async function remove(id) {
    await db().collection('designs').doc(id).delete();
    designs = designs.filter((x) => x.id !== id);
    renderList();
    notify('Design deleted.', 'info', 2000);
  }

  /* ------------------------------------------------------------------ */
  /* Panel                                                               */
  /* ------------------------------------------------------------------ */
  function modal() {
    let m = q('#designsModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'designsModal';
      m.className = 'modal-backdrop hidden';
      m.innerHTML = `<div class="auth-modal glass tool-modal designs-modal" role="dialog" aria-modal="true" aria-labelledby="designsTitle">
        <button class="modal-close" data-x aria-label="Close">×</button>
        <span class="panel-kicker">MY DESIGNS</span><h2 id="designsTitle">Saved designs</h2>
        <p class="micro-note" id="designsNote"></p>
        <div class="rfq-actions"><button class="btn btn-primary small" id="designsSaveNow">Save current design</button></div>
        <div id="designsList" class="designs-list"></div></div>`;
      document.body.appendChild(m);
      q('[data-x]', m).addEventListener('click', closeModal);
      m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
      q('#designsSaveNow', m).addEventListener('click', async () => { await save(); });
      q('#designsList', m).addEventListener('click', onListClick);
    }
    return m;
  }
  const closeModal = () => q('#designsModal')?.classList.add('hidden');

  function renderList() {
    const m = q('#designsModal');
    if (!m) return;
    const lim = limit();
    q('#designsNote', m).textContent = lim === Infinity ? `${designs.length} saved. Your plan has no limit.` : `${designs.length} of ${lim} saved. Pro has no limit.`;
    const list = q('#designsList', m);
    if (!designs.length) { list.innerHTML = '<div class="empty-state"><strong>Nothing saved yet</strong><span>Run a simulation and press Save current design.</span></div>'; return; }
    list.innerHTML = designs.map((d) => {
      const r = d.result || {};
      const c = d.conditions || {};
      const top = Object.entries(d.composition || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}${v >= 10 ? Math.round(v) : v}`).join(' ');
      return `<article class="design-row" data-id="${esc(d.id)}">
        <div class="design-main">
          <b class="design-name">${esc(d.name)}</b>
          <span class="design-meta">${esc(top)} · ${Math.round(c.temperature_c ?? 25)}°C · ${esc(r.verdict || '')} · ${esc(when(d.created_at))}</span>
          ${d.grade ? `<span class="design-meta">Closest grade: ${esc(d.grade)}</span>` : ''}
        </div>
        <div class="design-actions">
          <button class="btn btn-primary small" data-act="open">Open</button>
          <button class="btn btn-glass small" data-act="share">Share</button>
          <button class="btn btn-ghost small" data-act="rename">Rename</button>
          <button class="btn btn-ghost small" data-act="delete">Delete</button>
        </div></article>`;
    }).join('');
  }

  async function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.design-row');
    const d = designs.find((x) => x.id === row?.dataset.id);
    if (!d) return;
    try {
      if (btn.dataset.act === 'open') open(d);
      else if (btn.dataset.act === 'share') shareLink(d);
      else if (btn.dataset.act === 'rename') {
        const nameEl = q('.design-name', row);
        const input = document.createElement('input');
        input.className = 'design-rename';
        input.value = d.name;
        input.maxLength = 80;
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        const finish = async (commit) => { if (commit) await rename(d.id, input.value); else renderList(); };
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
        input.addEventListener('blur', () => finish(true));
      } else if (btn.dataset.act === 'delete') {
        if (btn.dataset.sure) await remove(d.id);
        else { btn.dataset.sure = '1'; btn.textContent = 'Sure?'; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = 'Delete'; } }, 3000); }
      }
    } catch (err) { notify(err.message || 'That did not work.', 'error', 4000); }
  }

  async function openPanel() {
    if (!state.user) { notify('Create a free account to save designs.', 'info', 3500); openAuth('register'); return; }
    const m = modal();
    m.classList.remove('hidden');
    q('#designsList', m).innerHTML = '<div class="empty-state"><span>Loading…</span></div>';
    try { await load(); } catch (err) { q('#designsList', m).innerHTML = `<div class="empty-state"><strong>Could not load designs</strong><span>${esc(err.message)}</span></div>`; return; }
    renderList();
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */
  function mountButton() {
    const actions = q('.top-actions');
    if (!actions || q('#designsBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'designsBtn';
    btn.className = 'btn btn-glass small hidden';
    btn.textContent = 'Designs';
    btn.title = 'Your saved designs';
    btn.addEventListener('click', openPanel);
    const invite = q('#inviteBtn');
    if (invite) actions.insertBefore(btn, invite); else actions.insertBefore(btn, actions.firstChild);
  }

  window.addEventListener('mh:session', (e) => {
    q('#designsBtn')?.classList.toggle('hidden', !e.detail.user);
    designs = []; loaded = false;
  });

  function boot() { mountButton(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_DESIGNS = { save, openPanel, snapshot, open, _set: (d) => { designs = d; loaded = true; } };
})();
