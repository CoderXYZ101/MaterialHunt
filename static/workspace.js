/* ==========================================================================
   MATERIALHUNT — plan features: model workspace and team shelf
   - caps(): what each plan allows (own-data rows, saved models, compare, test-error report).
   - "My models" panel in the ML Lab: save trained models (kept on this device in IndexedDB), reuse them,
     compare them side by side (Max and up), download a test-error report (Ultra).
   - Team shelf (team plans): share designs, and trained models on Team Max and Team Ultra, with the
     people your team ID was given to. Plans and team IDs are set by an admin after a request is confirmed.
   The limits are enforced in this page (the data lives on the member's own device), which is honest for
   features that are not secrets; the shared shelf and AI limits are enforced by the database rules.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (m, t = 'info', ms) => { if (typeof toast === 'function') toast(m, t, ms); };
  const db = () => window.MH_FIREBASE?.db;
  const FV = () => window.firebase.firestore.FieldValue;
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  const f0 = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : Number(v).toFixed(1));

  /* ------------------------------------------------------------------ */
  /* What each plan allows                                                */
  /* ------------------------------------------------------------------ */
  const BASE = { free: 'free', guest: 'free', pro: 'pro', team: 'pro', max: 'max', team_max: 'max', ultra: 'ultra', team_ultra: 'ultra', enterprise: 'ultra' };
  const CAPS = {
    free: { name: 'Free', rows: 300, models: 1, compare: false, report: false, next: 'Pro' },
    pro: { name: 'Pro', rows: 1000, models: 3, compare: false, report: false, next: 'Max' },
    max: { name: 'Max', rows: 5000, models: 10, compare: true, report: false, next: 'Ultra' },
    ultra: { name: 'Ultra', rows: 50000, models: 50, compare: true, report: true, next: '' },
  };
  const tier = () => window.MH_PLAN?.tier?.() || 'guest';
  const caps = () => CAPS[BASE[tier()] || 'free'];
  const isTeam = () => ['team', 'team_max', 'team_ultra'].includes(tier());
  const canShareModels = () => ['team_max', 'team_ultra'].includes(tier());
  const myTeam = () => String(state.user?.team || '');
  const upgrade = () => { const n = caps().next; if (n) window.openUpgrade?.(n.toLowerCase()); };

  /* ------------------------------------------------------------------ */
  /* Saved models: IndexedDB                                              */
  /* ------------------------------------------------------------------ */
  const owner = () => state.user?.id || 'guest';
  const idb = () => new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('Saving is not available in this browser.')); return; }
    const r = indexedDB.open('mh_models', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('models', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('Could not open storage.'));
  });
  const run = async (mode, fn) => {
    const d = await idb();
    return new Promise((res, rej) => { const tx = d.transaction('models', mode); const req = fn(tx.objectStore('models')); tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); });
  };
  const listModels = async () => ((await run('readonly', (s) => s.getAll())) || []).filter((m) => m.owner === owner()).sort((a, b) => b.savedAt - a.savedAt);
  const putModel = (m) => run('readwrite', (s) => s.put(m));
  const delModel = (id) => run('readwrite', (s) => s.delete(id));

  let saved = [];
  let picked = new Set();

  const download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  const slug = (s) => String(s || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';

  function reportCsv(m) {
    const lab = m.model;
    const lines = [
      `# MaterialHunt test-error report`,
      `# Model: ${m.name}`,
      `# Property: ${lab.targetLabel} (${lab.unit || 'no unit'})`,
      `# Samples: ${lab.n}`,
      `# Test method: ${lab.evalMethod}. Every row below was predicted by a model that had not seen that sample.`,
      `# Average error: ${lab.cv.mae.toFixed(2)}   Average % error: ${lab.cv.mape.toFixed(1)}   R2: ${lab.cv.r2.toFixed(3)}`,
      `# Guessing the average would give an average error of ${lab.baseline.mae.toFixed(2)} (R2 ${lab.baseline.r2.toFixed(3)})`,
      'sample,actual,predicted,error,error_percent',
    ];
    lab.points.forEach((p) => lines.push([`"${String(p.name).replace(/"/g, '""')}"`, p.actual, Number(p.pred).toFixed(3), Number(p.pred - p.actual).toFixed(3), p.actual ? (Math.abs(p.pred - p.actual) / Math.abs(p.actual) * 100).toFixed(1) : ''].join(',')));
    return lines.join('\n');
  }

  async function refreshSaved() {
    try { saved = await listModels(); } catch { saved = []; }
    renderModels();
  }

  function renderModels() {
    const host = q('#mlModelsBody');
    if (!host) return;
    const c = caps();
    const lab = window.MH_ML?.lab;
    const left = c.models - saved.length;
    const rows = saved.map((m) => `<tr>
        <td>${c.compare ? `<input type="checkbox" data-pick="${esc(m.id)}" ${picked.has(m.id) ? 'checked' : ''} aria-label="Compare ${esc(m.name)}" />` : ''}</td>
        <td><b>${esc(m.name)}</b><br><small>${esc(m.model.targetLabel)} · ${m.model.n} samples</small></td>
        <td>${f0(m.model.cv.mae)} ${esc(m.model.unit || '')}<br><small>R² ${m.model.cv.r2.toFixed(2)}</small></td>
        <td class="ml-model-actions">
          <button class="btn btn-glass small" data-m="use" data-id="${esc(m.id)}">Use as My ML</button>
          <button class="btn btn-ghost small" data-m="file" data-id="${esc(m.id)}">Model file</button>
          ${c.report ? `<button class="btn btn-ghost small" data-m="report" data-id="${esc(m.id)}">Test report</button>` : ''}
          ${canShareModels() && myTeam() ? `<button class="btn btn-ghost small" data-m="share" data-id="${esc(m.id)}">Share with team</button>` : ''}
          <button class="btn btn-ghost small" data-m="del" data-id="${esc(m.id)}">Delete</button></td></tr>`).join('');
    const chosen = saved.filter((m) => picked.has(m.id));
    const cmp = c.compare && chosen.length >= 2 ? `<h4>Side by side</h4><div class="admin-table-wrap"><table class="ml-table"><thead><tr><th>Model</th><th>Predicts</th><th>Samples</th><th>Average error</th><th>Average % error</th><th>R²</th><th>Guess-the-average error</th></tr></thead><tbody>
        ${chosen.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.model.targetLabel)}</td><td>${m.model.n}</td><td>${f0(m.model.cv.mae)} ${esc(m.model.unit || '')}</td><td>${m.model.cv.mape.toFixed(0)}%</td><td>${m.model.cv.r2.toFixed(2)}</td><td>${f0(m.model.baseline.mae)}</td></tr>`).join('')}</tbody></table></div>
        <p class="micro-note">Compare models only when they predict the same property. A lower error and a higher R² mean a better test result on that model's own data.</p>` : '';
    host.innerHTML = `<p class="micro-note">Your plan: <b>${esc(c.name)}</b> · ${saved.length} of ${c.models} saved models · own-data tables up to ${c.rows.toLocaleString('en-IN')} rows. Models are saved on this device, in this browser.${c.compare ? '' : ` Comparing models side by side starts on Max.`}${c.report ? '' : ' Downloadable test-error reports are on Ultra.'}</p>
      <div class="ml-save-row"><input id="mlModelName" type="text" maxlength="60" placeholder="Name for the model you just trained" ${lab ? `value="${esc(`${lab.targetLabel} (${lab.n} samples)`)}"` : 'disabled'} />
        <button class="btn btn-primary small" id="mlModelSave" ${lab ? '' : 'disabled'}>Save current model</button>
        ${left <= 0 && c.next ? `<button class="btn btn-glass small" id="mlModelUp">Upgrade to ${esc(c.next)} for more</button>` : ''}</div>
      ${lab ? '' : '<p class="micro-note">Train a model above, then save it here.</p>'}
      ${saved.length ? `<div class="admin-table-wrap"><table class="ml-table"><thead><tr><th></th><th>Model</th><th>Test error</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="micro-note">No saved models yet.</p>'}${cmp}`;
  }

  async function onModelClick(e) {
    const t = e.target.closest('[data-m],#mlModelSave,#mlModelUp,[data-pick]');
    if (!t) return;
    if (t.dataset.pick) { if (t.checked) picked.add(t.dataset.pick); else picked.delete(t.dataset.pick); renderModels(); return; }
    if (t.id === 'mlModelUp') { upgrade(); return; }
    if (t.id === 'mlModelSave') {
      const lab = window.MH_ML?.lab;
      const c = caps();
      if (!lab) return;
      if (!state.user) { notify('Create a free account to keep your models.', 'info', 3500); openAuth('register'); return; }
      if (saved.length >= c.models) { notify(`Your ${c.name} plan keeps up to ${c.models} saved model${c.models === 1 ? '' : 's'}. Delete one or upgrade.`, 'warning', 5000); return; }
      const name = (q('#mlModelName').value || '').trim().slice(0, 60) || `${lab.targetLabel} (${lab.n} samples)`;
      try {
        await putModel({ id: `${owner()}:${Date.now()}`, owner: owner(), name, prop: q('#mlUseProp')?.value || 'y', savedAt: Date.now(), model: JSON.parse(JSON.stringify(lab)) });
        notify('Model saved on this device.', 'success', 2500);
      } catch { notify('Could not save it. The browser may have blocked storage.', 'error', 4000); }
      await refreshSaved();
      return;
    }
    const m = saved.find((x) => x.id === t.dataset.id);
    if (!m) return;
    const act = t.dataset.m;
    if (act === 'use') {
      window.MH_ENGINE?.setCustom(m.model, m.prop || 'y');
      window.MH_ENGINE?.setMode('custom');
      notify('The other tabs now use this model for that property.', 'success', 3500);
    } else if (act === 'file') {
      download(`materialhunt-model-${slug(m.name)}.json`, JSON.stringify({ format: 'materialhunt-ml-1', prop: m.prop || 'y', savedAt: new Date(m.savedAt).toISOString(), model: m.model }), 'application/json');
    } else if (act === 'report') {
      if (!caps().report) { upgrade(); return; }
      download(`materialhunt-test-report-${slug(m.name)}.csv`, reportCsv(m), 'text/csv');
    } else if (act === 'share') {
      await shareModel(m);
    } else if (act === 'del') {
      if (!t.dataset.sure) { t.dataset.sure = '1'; t.textContent = 'Sure?'; setTimeout(() => { if (t.isConnected) { delete t.dataset.sure; t.textContent = 'Delete'; } }, 3000); return; }
      await delModel(m.id); picked.delete(m.id); await refreshSaved();
    }
  }

  function mountModels() {
    const sec = q('#view-ml');
    if (!sec) return false;
    if (q('#mlModels')) return true;
    const a = document.createElement('article');
    a.id = 'mlModels';
    a.className = 'glass ml-models';
    a.innerHTML = '<span class="pv-kicker">YOUR WORKSPACE</span><h3>My models</h3><div id="mlModelsBody"></div>';
    sec.appendChild(a);
    a.addEventListener('click', onModelClick);
    a.addEventListener('change', (e) => { if (e.target.matches('[data-pick]')) onModelClick(e); });
    refreshSaved();
    // refresh the "current model" state when a model is trained or loaded
    if (q('#mlResult')) new MutationObserver(() => renderModels()).observe(q('#mlResult'), { childList: true });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Team shelf                                                           */
  /* ------------------------------------------------------------------ */
  let items = [];
  let shelfLoaded = false;
  const who = () => (window.MH_PROFILE?.displayName?.() || state.user?.organization_name || 'Member').slice(0, 40);
  const ago = (t) => { const m = Math.max(0, (Date.now() - ms(t)) / 60000); if (!ms(t)) return 'just now'; if (m < 60) return `${Math.max(1, Math.round(m))} min ago`; if (m < 1440) return `${Math.round(m / 60)} h ago`; return `${Math.round(m / 1440)} d ago`; };

  /* ---- team names: like a user name, first come first served ---- */
  let teamInfo = null;
  const TEAM_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
  const slugTeam = (raw) => String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const uidNow = () => window.MH_FIREBASE?.auth?.currentUser?.uid || '';
  const newCode = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const r = new Uint32Array(10); (window.crypto || {}).getRandomValues?.(r); return Array.from(r, (n) => a[(n || Math.floor(Math.random() * 1e6)) % a.length]).join(''); };

  async function loadTeamInfo() {
    teamInfo = null;
    if (!myTeam()) return;
    try {
      await window.MH_FIREBASE.initFirebase();
      const n = await db().collection('team_names').doc(myTeam()).get();
      if (n.exists) {
        teamInfo = { id: myTeam(), ...n.data() };
        if (teamInfo.owner === uidNow()) { const c = await db().collection('team_codes').doc(myTeam()).get(); teamInfo.code = c.exists ? c.data().code : ''; }
      }
    } catch { teamInfo = null; }
  }

  function renderHead() {
    const h = q('#teamHead');
    if (!h) return;
    if (myTeam()) {
      const owner = teamInfo && teamInfo.owner === uidNow();
      h.innerHTML = `<div class="glass team-head"><p><b>${esc(teamInfo?.display || myTeam())}</b> <small>(team name: <code>${esc(myTeam())}</code>)</small></p>
        ${owner ? `<p class="micro-note">Share this join code with your teammates. They need a team plan on their account, then they press "Join a team" and enter the name and this code.</p>
          <p><code class="team-code">${esc(teamInfo.code || '')}</code> <button class="btn btn-ghost small" data-t="copy">Copy code</button> <button class="btn btn-ghost small" data-t="newcode">Make a new code</button></p>` : ''}
        <button class="btn btn-ghost small" data-t="leave">Leave this team</button></div>`;
      return;
    }
    h.innerHTML = `<div class="glass team-head"><div class="team-two"><div><h3>Create a team</h3>
        <p class="micro-note">Pick a name. It works like a user name: the first person to take it keeps it, and if it is taken you pick another.</p>
        <div class="ml-save-row"><input id="teamNew" type="text" maxlength="40" placeholder="e.g. SEA Robotics Club" /><button class="btn btn-glass small" data-t="check">Check name</button><button class="btn btn-primary small" data-t="create">Create team</button></div></div>
        <div><h3>Join a team</h3>
        <p class="micro-note">Your team owner gives you the name and a join code.</p>
        <div class="ml-save-row"><input id="teamJoinName" type="text" maxlength="40" placeholder="Team name" /><input id="teamJoinCode" type="text" maxlength="12" placeholder="Join code" /><button class="btn btn-primary small" data-t="join">Join a team</button></div></div></div>
        <p class="micro-note" id="teamMsg" aria-live="polite"></p></div>`;
  }
  const say = (m) => { const e = q('#teamMsg'); if (e) e.textContent = m; };

  async function afterTeamChange(teamId) {
    state.user.team = teamId;
    shelfLoaded = false; items = [];
    await loadShelf();
  }

  async function teamAction(t) {
    const a = t.dataset.t;
    if (!state.user?.email_verified) { notify('Please verify your email first.', 'warning', 4000); return; }
    await window.MH_FIREBASE.initFirebase();
    if (a === 'copy') { navigator.clipboard?.writeText(teamInfo?.code || ''); notify('Code copied.', 'success', 2000); return; }
    if (a === 'newcode') {
      const code = newCode();
      try { await db().collection('team_codes').doc(myTeam()).set({ code }); teamInfo.code = code; renderHead(); notify('New code made. The old one no longer works.', 'success', 3000); } catch { notify('Could not make a new code.', 'error', 3500); }
      return;
    }
    if (a === 'leave') {
      if (!t.dataset.sure) { t.dataset.sure = '1'; t.textContent = 'Sure? Press again'; setTimeout(() => { if (t.isConnected) { delete t.dataset.sure; t.textContent = 'Leave this team'; } }, 3000); return; }
      try { await db().collection('users').doc(uidNow()).update({ team: '' }); await afterTeamChange(''); } catch { notify('Could not leave the team.', 'error', 3500); }
      return;
    }
    if (a === 'check' || a === 'create') {
      const raw = (q('#teamNew')?.value || '').trim();
      const id = slugTeam(raw);
      if (!TEAM_RE.test(id)) { say('Use 3 to 40 letters or numbers. Spaces become dashes.'); return; }
      let taken = false;
      try { taken = (await db().collection('team_names').doc(id).get()).exists; } catch { say('Could not check. Are you online?'); return; }
      if (taken) { say(`"${id}" is taken. Try another name.`); return; }
      if (a === 'check') { say(`"${id}" is free. Press "Create team" to take it.`); return; }
      try {
        await db().collection('team_names').doc(id).set({ owner: uidNow(), display: raw.slice(0, 40), created_at: FV().serverTimestamp() });
        await db().collection('team_codes').doc(id).set({ code: newCode() });
        await db().collection('users').doc(uidNow()).update({ team: id });
        notify(`Team "${raw}" created. Share the join code with your teammates.`, 'success', 5000);
        await afterTeamChange(id);
      } catch { say('Could not create the team. Your account needs an active team plan and a verified email, or someone just took that name.'); }
      return;
    }
    if (a === 'join') {
      const id = slugTeam(q('#teamJoinName')?.value || '');
      const code = (q('#teamJoinCode')?.value || '').trim().toLowerCase();
      if (!TEAM_RE.test(id) || code.length < 8) { say('Enter the team name and the join code.'); return; }
      try {
        await db().collection('team_joins').doc(uidNow()).set({ team: id, code });
        await db().collection('users').doc(uidNow()).update({ team: id });
        notify('You joined the team.', 'success', 4000);
        await afterTeamChange(id);
      } catch { say('Could not join. Check the name and code, and that your account is on a team plan.'); }
      try { await db().collection('team_joins').doc(uidNow()).delete(); } catch { /* ignore */ }
    }
  }

  async function loadShelf() {
    const host = q('#teamList');
    await loadTeamInfo();
    renderHead();
    if (!myTeam()) { shelfLoaded = true; renderShelf(); return; }
    try {
      await window.MH_FIREBASE.initFirebase();
      const s = await db().collection('team_items').where('team', '==', myTeam()).limit(100).get();
      items = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.created_at) - ms(a.created_at));
      shelfLoaded = true;
    } catch {
      if (host) host.innerHTML = '<div class="empty-state"><strong>The team shelf could not load</strong><span>It needs an internet connection and an active team plan.</span></div>';
      return;
    }
    renderShelf();
  }

  function renderShelf() {
    const host = q('#teamList');
    if (!host) return;
    if (!myTeam()) {
      host.innerHTML = '<div class="empty-state"><strong>You are not in a team yet</strong><span>Create a team or join one with a code, above.</span></div>';
      return;
    }
    host.innerHTML = items.length ? items.map((i) => `<article class="forum-thread glass"><div class="forum-body" style="padding-top:14px">
        <span class="forum-cat">${i.kind === 'model' ? 'Trained model' : 'Design'}</span>
        <p><b>${esc(i.name)}</b><br><small>${esc(i.owner_name || 'Member')} · ${esc(ago(i.created_at))}</small></p>
        <div class="admin-actions"><button class="btn btn-primary small" data-ti="open" data-id="${esc(i.id)}">${i.kind === 'model' ? 'Open in ML Lab' : 'Open in Simulator'}</button>
          ${i.owner === state.user?.id ? `<button class="btn btn-ghost small" data-ti="del" data-id="${esc(i.id)}">Remove</button>` : ''}</div></div></article>`).join('')
      : `<div class="empty-state"><strong>${shelfLoaded ? 'Nothing shared yet' : 'Loading…'}</strong><span>${shelfLoaded ? 'Share a design from the Simulator, or a trained model from the ML Lab, so your team can use it.' : ''}</span></div>`;
  }

  async function put(kind, name, payload) {
    if (!myTeam()) { notify('Your team is not set up yet.', 'warning', 4000); return false; }
    if (!state.user?.email_verified) { notify('Please verify your email first.', 'warning', 4000); return false; }
    const text = JSON.stringify(payload);
    if (text.length > 900000) { notify('That is too big to share. Train it with fewer trees and try again.', 'warning', 5000); return false; }
    try {
      await window.MH_FIREBASE.initFirebase();
      await db().collection('team_items').add({ team: myTeam(), kind, name: String(name).slice(0, 80), owner: window.MH_FIREBASE.auth.currentUser.uid, owner_name: who(), payload: text, created_at: FV().serverTimestamp() });
      notify('Shared with your team.', 'success', 3000);
      await loadShelf();
      return true;
    } catch { notify('Could not share it. Your team plan may have ended.', 'error', 4500); return false; }
  }

  async function shareDesign() {
    const snap = window.MH_DESIGNS?.snapshot?.();
    if (!snap) { notify('Run a simulation first, then share it.', 'info', 3500); return; }
    const name = (q('#teamName')?.value || '').trim() || 'Untitled design';
    await put('design', name, snap);
  }
  async function shareModel(m) {
    if (!canShareModels()) { notify('Sharing models needs Team Max or Team Ultra.', 'info', 4000); return; }
    await put('model', m.name, { format: 'materialhunt-ml-1', prop: m.prop || 'y', model: m.model });
  }

  async function onShelfClick(e) {
    if (e.target.closest('#teamShare')) { await shareDesign(); return; }
    if (e.target.closest('#teamRefresh')) { await loadShelf(); return; }
    const t = e.target.closest('[data-ti]');
    if (!t) return;
    const it = items.find((x) => x.id === t.dataset.id);
    if (!it) return;
    if (t.dataset.ti === 'del') {
      if (!t.dataset.sure) { t.dataset.sure = '1'; t.textContent = 'Sure?'; setTimeout(() => { if (t.isConnected) { delete t.dataset.sure; t.textContent = 'Remove'; } }, 3000); return; }
      await db().collection('team_items').doc(it.id).delete(); items = items.filter((x) => x.id !== it.id); renderShelf(); return;
    }
    let data;
    try { data = JSON.parse(it.payload); } catch { notify('That item is damaged.', 'error', 3000); return; }
    if (it.kind === 'design') { window.MH_DESIGNS?.open?.({ ...data, name: it.name }); }
    else {
      setView('ml');
      if (window.MH_ML?.loadLab?.(data.model, data.prop)) notify('Model loaded in the ML Lab. Press "Use as My ML" to use it in the other tabs.', 'success', 5000);
      else notify('That model could not be loaded.', 'error', 3500);
    }
  }

  function mountShelf() {
    const main = q('main');
    if (!main) return;
    const nav = q('.main-nav');
    const want = isTeam();
    if (want && nav && !q('[data-view="team"]', nav)) {
      const b = document.createElement('button');
      b.className = 'nav-link'; b.dataset.view = 'team'; b.title = 'Designs and models shared with your team'; b.textContent = 'Team';
      b.addEventListener('click', () => setView('team'));
      nav.insertBefore(b, q('[data-view="pricing"]', nav));
    }
    if (!want) { q('[data-view="team"]', nav)?.remove(); return; }
    if (q('#view-team')) return;
    const sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'view-team';
    sec.innerHTML = `<div class="section-head"><div><span class="panel-kicker">TEAM SHELF</span><h2>Shared with your team</h2>
        <p>Designs${canShareModels() ? ' and trained models' : ''} that people on your team have shared. Only your team can see them.</p></div></div>
      <div id="teamHead"></div>
      <div class="ml-save-row"><input id="teamName" type="text" maxlength="80" placeholder="Name for the design you want to share" /><button class="btn btn-primary small" id="teamShare" type="button">Share current design</button><button class="btn btn-ghost small" id="teamRefresh" type="button">Refresh</button></div>
      ${canShareModels() ? '<p class="micro-note">To share a trained model, save it in the ML Lab under My models, then press "Share with team".</p>' : '<p class="micro-note">Sharing trained models is part of Team Max and Team Ultra.</p>'}
      <div id="teamList"><div class="empty-state"><strong>Loading…</strong></div></div>`;
    main.appendChild(sec);
    sec.addEventListener('click', (e) => { const t = e.target.closest('[data-t]'); if (t) { teamAction(t); return; } onShelfClick(e); });
    let first = true;
    const check = () => { if (sec.classList.contains('active') && first) { first = false; loadShelf(); } };
    new MutationObserver(check).observe(sec, { attributes: true, attributeFilter: ['class'] });
    check();
  }

  /* ------------------------------------------------------------------ */
  function boot() {
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (mountModels() || tries > 60) clearInterval(t); }, 500);
    mountShelf();
    window.addEventListener('mh:session', () => { setTimeout(() => { mountShelf(); refreshSaved(); }, 600); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.MH_PLANS = { caps, tier, isTeam, canShareModels };
})();
